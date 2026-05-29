import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  createAgentRateLimitMiddleware,
  createGlobalRateLimitMiddleware,
  createPaymentsRateLimitMiddleware,
} from '../common/rateLimit';

function makeApp() {
  const app = express();

  app.use(express.json());
  app.use(createGlobalRateLimitMiddleware({ windowMs: 60_000, maxRequests: 2 }));
  app.use('/api/v1/payments', createPaymentsRateLimitMiddleware({ windowMs: 60_000, maxRequests: 1 }));
  app.use(
    '/api/v1/agent',
    createAgentRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/v1/payments/query/:id', (_req, res) => {
    res.status(402).json({ error: 'Payment Required', x402: true });
  });

  app.get('/api/v1/agent/info', (_req, res) => {
    res.json({ success: true });
  });

  app.post('/api/v1/agent/research/demo', (_req, res) => {
    res.json({ success: true, demo: true });
  });

  return app;
}

describe('rate limiting integration', () => {
  it('returns 429 with Retry-After after the global limit is exceeded', async () => {
    const app = makeApp();

    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/health')).status).toBe(200);

    const response = await request(app).get('/health');

    expect(response.status).toBe(429);
    expect(response.body.error).toBe('Too many requests');
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('applies the stricter payments limit', async () => {
    const app = makeApp();

    const first = await request(app).post('/api/v1/payments/query/ds-1').send({});
    const second = await request(app).post('/api/v1/payments/query/ds-1').send({});

    expect(first.status).not.toBe(429);
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('applies the strictest agent limit to AI routes', async () => {
    const app = makeApp();

    const first = await request(app).get('/api/v1/agent/info');
    const second = await request(app).get('/api/v1/agent/info');

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
  });
});
