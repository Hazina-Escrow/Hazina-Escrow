/**
 * express.d.ts — Global type augmentation for Express Request
 *
 * Extends the Express Request interface to include the `id` property
 * that is injected by the x-request-id correlation middleware in main.ts.
 */

declare global {
  namespace Express {
    interface Request {
      /** Unique correlation ID for this request (from x-request-id header or auto-generated UUID). */
      id: string;
    }
  }
}

export {};
