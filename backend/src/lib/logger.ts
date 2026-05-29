import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    // SECURITY: Any of these keys appearing anywhere in a structured log
    // object will be replaced with '[REDACTED]' before the record is shipped
    // to Datadog or written to stdout. Add new secret env-var names here.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      // Stellar / wallet secrets
      'AGENT_WALLET_SECRET',
      'ESCROW_SECRET',
      '*.AGENT_WALLET_SECRET',
      '*.ESCROW_SECRET',
      // API / auth secrets
      'API_KEY',
      'ADMIN_API_KEY',
      'SELLER_JWT_SECRET',
      '*.API_KEY',
      '*.ADMIN_API_KEY',
      '*.SELLER_JWT_SECRET',
      // Third-party service keys
      'ANTHROPIC_API_KEY',
      'DATADOG_API_KEY',
      'DATABASE_URL',
      '*.ANTHROPIC_API_KEY',
      '*.DATABASE_URL',
    ],
    censor: '[REDACTED]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
});
