import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';

const config = new pulumi.Config();
const projectName = 'hazina-escrow';
const environment = pulumi.getStack();
const corsAllowedOrigins = config.get('corsAllowedOrigins') || '';

// Store secrets in AWS Secrets Manager so their values never appear in the
// Pulumi state file. The task definition references them by ARN only.
const anthropicApiKeySecret = new aws.secretsmanager.Secret(
  `${projectName}-anthropic-api-key`,
  { name: `${projectName}/${environment}/anthropic-api-key` },
);
new aws.secretsmanager.SecretVersion(`${projectName}-anthropic-api-key-version`, {
  secretId: anthropicApiKeySecret.id,
  secretString: config.requireSecret('anthropicApiKey'),
});

const agentWalletSecretSm = new aws.secretsmanager.Secret(
  `${projectName}-agent-wallet-secret`,
  { name: `${projectName}/${environment}/agent-wallet-secret` },
);
new aws.secretsmanager.SecretVersion(`${projectName}-agent-wallet-secret-version`, {
  secretId: agentWalletSecretSm.id,
  secretString: config.requireSecret('agentWalletSecret'),
});

// 1. Networking (VPC)
const vpc = new awsx.ec2.Vpc(`${projectName}-vpc`, {
  numberOfAvailabilityZones: 2,
  tags: { Project: projectName, Environment: environment },
});

// 2. Storage (EFS)
const efsFileSystem = new aws.efs.FileSystem(`${projectName}-efs`, {
  encrypted: true,
  tags: { Name: `${projectName}-efs` },
});

const efsSg = new aws.ec2.SecurityGroup(`${projectName}-efs-sg`, {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: 'tcp',
      fromPort: 2049,
      toPort: 2049,
      cidrBlocks: ['0.0.0.0/0'], // Restrict to VPC CIDR in production
    },
  ],
  egress: [
    {
      protocol: '-1',
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ['0.0.0.0/0'],
    },
  ],
});

// Mount targets for EFS
void vpc.privateSubnetIds.then(ids =>
  ids.map(
    (id, index) =>
      new aws.efs.MountTarget(`${projectName}-mt-${index}`, {
        fileSystemId: efsFileSystem.id,
        subnetId: id,
        securityGroups: [efsSg.id],
      }),
  ),
);

// 3. Compute (ECS Fargate)
const cluster = new aws.ecs.Cluster(`${projectName}-cluster`);

const repo = new aws.ecr.Repository(`${projectName}-backend`, {
  forceDelete: true,
});

const logGroup = new aws.cloudwatch.LogGroup(`/ecs/${projectName}-backend`, {
  retentionInDays: 7,
});

const alb = new awsx.lb.ApplicationLoadBalancer(`${projectName}-alb`, {
  subnetIds: vpc.publicSubnetIds,
});

const targetGroup = alb.createTargetGroup(`${projectName}-tg`, {
  port: 3001,
  protocol: 'HTTP',
  targetType: 'ip',
  healthCheck: { path: '/health' },
});

const listener = alb.createListener(`${projectName}-listener`, {
  port: 80,
  defaultAction: {
    type: 'forward',
    targetGroupArn: targetGroup.targetGroup.arn,
  },
});

// ECS task execution role with permission to pull secrets from Secrets Manager.
// This replaces the hard-coded role ARN and grants only the minimum required access.
const executionRole = new aws.iam.Role(`${projectName}-exec-role`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'ecs-tasks.amazonaws.com' }),
});

new aws.iam.RolePolicyAttachment(`${projectName}-exec-role-policy`, {
  role: executionRole.name,
  policyArn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
});

// Allow the execution role to read only the two secrets it needs.
new aws.iam.RolePolicy(`${projectName}-exec-role-secrets-policy`, {
  role: executionRole.name,
  policy: pulumi
    .all([anthropicApiKeySecret.arn, agentWalletSecretSm.arn])
    .apply(([anthropicArn, walletArn]) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['secretsmanager:GetSecretValue'],
            Resource: [anthropicArn, walletArn],
          },
        ],
      }),
    ),
});

const taskDefinition = new aws.ecs.TaskDefinition(`${projectName}-task`, {
  family: `${projectName}-backend`,
  cpu: '256',
  memory: '512',
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  executionRoleArn: executionRole.arn,
  containerDefinitions: pulumi
    .all([repo.repositoryUrl, efsFileSystem.id, anthropicApiKeySecret.arn, agentWalletSecretSm.arn])
    .apply(([url, , anthropicArn, walletArn]) =>
      JSON.stringify([
        {
          name: 'backend',
          image: `${url}:latest`,
          portMappings: [{ containerPort: 3001 }],
          // Non-sensitive config goes in environment (plaintext is fine here).
          environment: [
            { name: 'PORT', value: '3001' },
            { name: 'ESCROW_WALLET', value: config.require('escrowWallet') },
            { name: 'ESCROW_CONTRACT_ID', value: config.get('escrowContractId') || '' },
            { name: 'CORS_ALLOWED_ORIGINS', value: corsAllowedOrigins },
            { name: 'STELLAR_NETWORK', value: 'testnet' },
          ],
          // Secrets are injected by ECS at runtime from Secrets Manager.
          // Their values are never written to the Pulumi state file.
          secrets: [
            { name: 'ANTHROPIC_API_KEY', valueFrom: anthropicArn },
            { name: 'AGENT_WALLET_SECRET', valueFrom: walletArn },
          ],
          mountPoints: [
            {
              sourceVolume: 'data',
              containerPath: '/app/data',
              readOnly: false,
            },
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': logGroup.name,
              'awslogs-region': 'us-east-1',
              'awslogs-stream-prefix': 'ecs',
            },
          },
        },
      ]),
    ),
  volumes: [
    {
      name: 'data',
      efsVolumeConfiguration: {
        fileSystemId: efsFileSystem.id,
        rootDirectory: '/',
      },
    },
  ],
});

const service = new aws.ecs.Service(`${projectName}-service`, {
  cluster: cluster.arn,
  taskDefinition: taskDefinition.arn,
  desiredCount: 1,
  launchType: 'FARGATE',
  networkConfiguration: {
    subnets: vpc.privateSubnetIds,
    securityGroups: [alb.loadBalancer.securityGroups[0]], // Simplification
    assignPublicIp: false,
  },
  loadBalancers: [
    {
      targetGroupArn: targetGroup.targetGroup.arn,
      containerName: 'backend',
      containerPort: 3001,
    },
  ],
});

// 4. Frontend (S3 + CloudFront)
const siteBucket = new aws.s3.Bucket(`${projectName}-frontend`, {
  forceDestroy: true,
});

const originAccessIdentity = new aws.cloudfront.OriginAccessIdentity(`${projectName}-oai`);

const siteBucketPolicy = new aws.s3.BucketPolicy(`${projectName}-bucket-policy`, {
  bucket: siteBucket.id,
  policy: pulumi.all([siteBucket.arn, originAccessIdentity.iamArn]).apply(([arn, iamArn]) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: iamArn },
          Action: 's3:GetObject',
          Resource: `${arn}/*`,
        },
      ],
    }),
  ),
});

const cdn = new aws.cloudfront.Distribution(`${projectName}-cdn`, {
  enabled: true,
  defaultRootObject: 'index.html',
  origins: [
    {
      domainName: siteBucket.bucketRegionalDomainName,
      originId: siteBucket.arn,
      s3OriginConfig: {
        originAccessIdentity: originAccessIdentity.cloudfrontAccessIdentityPath,
      },
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: siteBucket.arn,
    viewerProtocolPolicy: 'redirect-to-https',
    allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
    cachedMethods: ['GET', 'HEAD'],
    forwardedValues: {
      queryString: false,
      cookies: { forward: 'none' },
    },
    minTtl: 0,
    defaultTtl: 3600,
    maxTtl: 86400,
  },
  restrictions: {
    geoRestriction: { restrictionType: 'none' },
  },
  viewerCertificate: {
    cloudfrontDefaultCertificate: true,
  },
});

// Outputs
export const backendUrl = alb.loadBalancer.dnsName;
export const frontendUrl = cdn.domainName;
export const s3BucketName = siteBucket.id;
export const ecrRepoUrl = repo.repositoryUrl;
