import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireApiKey } from '../common/auth.middleware';

describe('state-mutating endpoint auth', () => {
  const originalApiKey = process.env.API_KEY;

  beforeEach(() => {
    process.env.API_KEY = 'test-api-key';
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
  });

  function makeApp() {
    const app = express();
    app.use(express.json());

    app.use('/api/v1/payments', requireApiKey, express.Router().post('/query/:id', (_req, res) => res.status(402).json({ ok: true })));
    app.use('/api/v1/agent', requireApiKey, express.Router().post('/research/demo', (_req, res) => res.json({ ok: true })));

    return app;
  }

  it('returns 401 on unauthenticated payments requests', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/v1/payments/query/ds-1').send({});

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Authorization header');
  });

  it('returns 401 on unauthenticated agent requests', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/v1/agent/research/demo').send({ query: 'hello world' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Authorization header');
  });

  it('allows authenticated payments and agent requests with the API key', async () => {
    const app = makeApp();

    const payments = await request(app)
      .post('/api/v1/payments/query/ds-1')
      .set('Authorization', 'Bearer test-api-key')
      .send({});

    const agent = await request(app)
      .post('/api/v1/agent/research/demo')
      .set('Authorization', 'Bearer test-api-key')
      .send({ query: 'hello world' });

    expect(payments.status).toBe(402);
    expect(agent.status).toBe(200);
  });
});
