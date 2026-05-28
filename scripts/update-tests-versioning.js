const fs = require('fs');
const path = require('path');
const glob = require('glob');

const repoRoot = path.resolve(__dirname, '..');
const patterns = ['backend/src/**/*.test.ts', 'backend/src/**/__tests__/**/*.ts'];
const files = patterns.flatMap(p => glob.sync(path.join(repoRoot, p)));

const replacements = [
  // mounts
  { from: "app.use('/api', paymentsRouter)", to: "app.use('/api/v1/payments', paymentsRouter)" },
  { from: "app.use('/api', paymentsRouter);", to: "app.use('/api/v1/payments', paymentsRouter);" },
  { from: "app.use('/api/agent', agentRouter)", to: "app.use('/api/v1/agent', agentRouter)" },
  { from: "app.use('/api/agent', agentRouter);", to: "app.use('/api/v1/agent', agentRouter);" },
  {
    from: "app.use('/api/datasets', datasetsRouter)",
    to: "app.use('/api/v1/datasets', datasetsRouter)",
  },
  {
    from: "app.use('/api/datasets', datasetsRouter);",
    to: "app.use('/api/v1/datasets', datasetsRouter);",
  },
  {
    from: 'app.use("/api/webhooks", webhooksRouter)',
    to: "app.use('/api/v1/webhooks', webhooksRouter)",
  },
  {
    from: "app.use('/api/webhooks', webhooksRouter)",
    to: "app.use('/api/v1/webhooks', webhooksRouter)",
  },

  // request paths
  { from: '/api/query/', to: '/api/v1/payments/query/' },
  { from: "/api/query',", to: "/api/v1/payments/query'," },
  { from: '/api/verify/', to: '/api/v1/payments/verify/' },
  { from: "/api/verify',", to: "/api/v1/payments/verify'," },
  { from: '/api/verify/', to: '/api/v1/payments/verify/' },
  { from: '/api/verify/d', to: '/api/v1/payments/verify/d' },
  { from: '/api/verify/does-not-exist/demo', to: '/api/v1/payments/verify/does-not-exist/demo' },
  { from: '/api/verify/ds-test-1/demo', to: '/api/v1/payments/verify/ds-test-1/demo' },
  { from: '/api/admin/unpaid-sellers', to: '/api/v1/payments/admin/unpaid-sellers' },
  { from: '/api/agent/', to: '/api/v1/agent/' },
  { from: "/api/agent',", to: "/api/v1/agent'," },
  { from: '/api/datasets/', to: '/api/v1/datasets/' },
  { from: "/api/datasets',", to: "/api/v1/datasets'," },
  { from: '/api/datasets', to: '/api/v1/datasets' },
  { from: '/api/webhooks', to: '/api/v1/webhooks' },
  { from: '/api/webhooks/', to: '/api/v1/webhooks/' },
  { from: "'/api/webhooks/payment'", to: "'/api/v1/webhooks/payment'" },
  { from: '"/api/webhooks/payment"', to: '"/api/v1/webhooks/payment"' },
];

let changedFiles = [];
for (const file of new Set(files)) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;
    for (const r of replacements) {
      content = content.split(r.from).join(r.to);
    }
    if (content !== original) {
      fs.writeFileSync(file, content, 'utf8');
      changedFiles.push(file);
    }
  } catch (err) {
    console.error('Failed to process', file, err.message);
  }
}

console.log('Updated files:', changedFiles.length);
changedFiles.forEach(f => console.log(' -', path.relative(repoRoot, f)));
