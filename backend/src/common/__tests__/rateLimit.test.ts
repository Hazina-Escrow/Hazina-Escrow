import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimitMiddleware } from '../rateLimit';

describe('rateLimitMiddleware', () => {
  let app: express.Express;
  const originalEnv = {
    RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX,
  };

  beforeEach(() => {
    app = express();
    // Use the factory to create a middleware with small limits for testing
    const testMiddleware = createRateLimitMiddleware({
      maxRequests: 3,
      windowMs: 60000, // 1 minute
    });

    app.use(testMiddleware);
    app.get('/test', (req, res) => {
      res.status(200).json({ success: true });
    });
  });

  afterEach(() => {
    if (originalEnv.RATE_LIMIT_WINDOW_MS === undefined) {
      delete process.env.RATE_LIMIT_WINDOW_MS;
    } else {
      process.env.RATE_LIMIT_WINDOW_MS = originalEnv.RATE_LIMIT_WINDOW_MS;
    }

    if (originalEnv.RATE_LIMIT_MAX === undefined) {
      delete process.env.RATE_LIMIT_MAX;
    } else {
      process.env.RATE_LIMIT_MAX = originalEnv.RATE_LIMIT_MAX;
    }
  });

  it('should allow requests below the limit and set headers', async () => {
    const response = await request(app).get('/test');

    expect(response.status).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBe('3');
    expect(response.headers['x-ratelimit-remaining']).toBe('2');
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('should decrement remaining count on subsequent requests', async () => {
    await request(app).get('/test');
    const response = await request(app).get('/test');

    expect(response.status).toBe(200);
    expect(response.headers['x-ratelimit-remaining']).toBe('1');
  });

  it('should block requests exceeding the limit', async () => {
    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');

    const response = await request(app).get('/test');

    expect(response.status).toBe(429);
    expect(response.body.error).toBe('Too many requests');
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
    expect(response.headers['retry-after']).toBeDefined();
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('reads default values from environment variables', async () => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX = '2';

    const envApp = express();
    envApp.use(createRateLimitMiddleware());
    envApp.get('/test', (_req, res) => res.status(200).json({ success: true }));

    const first = await request(envApp).get('/test');
    const second = await request(envApp).get('/test');
    const third = await request(envApp).get('/test');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers['x-ratelimit-remaining']).toBe('0');
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
  });
});
