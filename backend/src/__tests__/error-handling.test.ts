import express, { Express, Router, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import 'express-async-errors';

describe('Async Route Error Handling', () => {
  it('should automatically forward thrown errors in async route handlers to global error handler', async () => {
    const app: Express = express();
    const router = Router();

    // An async route handler that throws an error
    router.get('/throw-async', async (_req: Request, _res: Response) => {
      throw new Error('Test async error');
    });

    app.use(router);

    // Global error handler registered AFTER the route
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status ?? 500;
      res.status(status).json({
        error: err.message || 'Internal server error',
        code: 'TEST_ERROR',
      });
    });

    const response = await request(app).get('/throw-async');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Test async error',
      code: 'TEST_ERROR',
    });
  });

  it('should support custom error status codes', async () => {
    const app: Express = express();
    const router = Router();

    router.get('/throw-custom', async (_req: Request, _res: Response) => {
      const error = new Error('Not Authorized') as any;
      error.status = 401;
      throw error;
    });

    app.use(router);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status ?? 500;
      res.status(status).json({
        error: err.message || 'Internal server error',
      });
    });

    const response = await request(app).get('/throw-custom');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'Not Authorized',
    });
  });
});
