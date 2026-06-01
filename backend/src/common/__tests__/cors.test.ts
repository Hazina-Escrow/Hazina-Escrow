import { describe, expect, it } from 'vitest';
import { createCorsOptions, parseCorsAllowedOrigins } from '../cors';

describe('CORS configuration', () => {
  it('uses CORS_ALLOWED_ORIGINS as a comma-separated whitelist', () => {
    expect(
      parseCorsAllowedOrigins({
        CORS_ALLOWED_ORIGINS: 'https://app.hazina.example, https://admin.hazina.example ',
        FRONTEND_URL: '',
        NODE_ENV: 'development',
      }),
    ).toEqual(['https://app.hazina.example', 'https://admin.hazina.example']);
  });

  it('falls back to FRONTEND_URL for existing environments', () => {
    expect(
      parseCorsAllowedOrigins({
        FRONTEND_URL: 'https://frontend.hazina.example',
        CORS_ALLOWED_ORIGINS: '',
        NODE_ENV: 'development',
      }),
    ).toEqual(['https://frontend.hazina.example']);
  });

  it('keeps localhost as the default development origin', () => {
    expect(
      parseCorsAllowedOrigins({
        CORS_ALLOWED_ORIGINS: '',
        FRONTEND_URL: '',
        NODE_ENV: 'development',
      }),
    ).toEqual(['http://localhost:5173']);
  });

  it('throws in production when FRONTEND_URL is missing', () => {
    expect(() =>
      parseCorsAllowedOrigins({
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: '',
        FRONTEND_URL: '',
      }),
    ).toThrow('FRONTEND_URL must be set in production');
  });

  it('allows requests from whitelisted browser origins', () => {
    const options = createCorsOptions({
      CORS_ALLOWED_ORIGINS: 'https://app.hazina.example,https://admin.hazina.example',
      FRONTEND_URL: '',
      NODE_ENV: 'development',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (options.origin as any)?.(
      'https://admin.hazina.example',
      (error: Error | null, allow: boolean) => {
        expect(error).toBeNull();
        expect(allow).toBe(true);
      },
    );

    if (typeof options.origin === 'function') {
      options.origin('https://admin.hazina.example', (error: Error | null, origin?: unknown) => {
        expect(error).toBeNull();
        expect(origin).toBe(true);
      });
    }
  });

  it('allows requests without an Origin header', () => {
    const options = createCorsOptions({
      CORS_ALLOWED_ORIGINS: 'https://app.hazina.example',
      FRONTEND_URL: '',
      NODE_ENV: 'development',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (options.origin as any)?.(undefined, (error: Error | null, allow: boolean) => {
      expect(error).toBeNull();
      expect(allow).toBe(true);
    });
    if (typeof options.origin === 'function') {
      options.origin(undefined, (error: Error | null, origin?: unknown) => {
        expect(error).toBeNull();
        expect(origin).toBe(true);
      });
    }
  });

  it('rejects browser origins outside the whitelist', () => {
    const options = createCorsOptions({
      CORS_ALLOWED_ORIGINS: 'https://app.hazina.example',
      FRONTEND_URL: '',
      NODE_ENV: 'development',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (options.origin as any)?.('https://evil.example', (error: Error | null, allow: boolean) => {
      expect(error).toEqual(new Error('Origin https://evil.example is not allowed by CORS'));
      expect(allow).toBeUndefined();
    });
    if (typeof options.origin === 'function') {
      options.origin('https://evil.example', (error: Error | null, origin?: unknown) => {
        expect(error).toEqual(new Error('Origin https://evil.example is not allowed by CORS'));
        expect(origin).toBeUndefined();
      });
    }
  });

  it('strips localhost from production whitelists', () => {
    const origins = parseCorsAllowedOrigins({
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://app.hazina.example,http://localhost:5173',
      FRONTEND_URL: '',
    });

    expect(origins).toEqual(['https://app.hazina.example']);
  });

  it('rejects localhost origins in production when FRONTEND_URL is missing', () => {
    expect(() =>
      createCorsOptions({ NODE_ENV: 'production', FRONTEND_URL: '', CORS_ALLOWED_ORIGINS: '' }),
    ).toThrow('FRONTEND_URL must be set in production');
  });
});
