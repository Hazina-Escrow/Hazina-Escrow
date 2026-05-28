import express, { Express, Router, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import 'express-async-errors';

/**
 * Build a minimal Express app that mirrors the request-ID middleware wiring
 * in main.ts — middleware first, then routes, then global error handler.
 */
function makeApp(): Express {
  const app: Express = express();
  const router = Router();

  // Request correlation ID middleware (same logic as main.ts)
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.id = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });

  app.use(express.json());

  // Normal route
  router.get('/ping', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Route that echoes the request ID back in the body
  router.get('/echo-id', (req: Request, res: Response) => {
    res.json({ requestId: req.id });
  });

  // Async route that throws — tests that requestId is still in error responses
  router.get('/throw', async (_req: Request, _res: Response) => {
    throw new Error('Something went wrong');
  });

  app.use(router);

  // Global error handler (same shape as main.ts)
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    res.status(status).json({
      error: err.message || 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId: req.id,
    });
  });

  return app;
}

describe('Request Correlation ID Middleware', () => {
  it('generates a unique x-request-id header when none is provided', async () => {
    const app = makeApp();
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeDefined();
    // Should be a valid UUID v4
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('forwards the x-request-id provided by the client unchanged', async () => {
    const app = makeApp();
    const clientId = 'my-frontend-trace-abc123';

    const res = await request(app).get('/ping').set('x-request-id', clientId);

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe(clientId);
  });

  it('makes req.id available inside route handlers', async () => {
    const app = makeApp();
    const clientId = 'trace-id-xyz-789';

    const res = await request(app).get('/echo-id').set('x-request-id', clientId);

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(clientId);
  });

  it('each request without a client ID gets a different generated ID', async () => {
    const app = makeApp();

    const [res1, res2] = await Promise.all([
      request(app).get('/ping'),
      request(app).get('/ping'),
    ]);

    expect(res1.headers['x-request-id']).toBeDefined();
    expect(res2.headers['x-request-id']).toBeDefined();
    expect(res1.headers['x-request-id']).not.toBe(res2.headers['x-request-id']);
  });

  it('includes x-request-id in error responses when an async route throws', async () => {
    const app = makeApp();
    const clientId = 'error-trace-999';

    const res = await request(app).get('/throw').set('x-request-id', clientId);

    expect(res.status).toBe(500);
    // Header must be present
    expect(res.headers['x-request-id']).toBe(clientId);
    // Body must include requestId so the frontend can report it
    expect(res.body.requestId).toBe(clientId);
    expect(res.body.error).toBe('Something went wrong');
    expect(res.body.code).toBe('INTERNAL_ERROR');
  });

  it('auto-generates a requestId in error responses when no client ID was sent', async () => {
    const app = makeApp();

    const res = await request(app).get('/throw');

    expect(res.status).toBe(500);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.body.requestId).toBeDefined();
    // Header and body must agree
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
