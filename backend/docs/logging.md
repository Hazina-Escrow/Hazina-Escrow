# Structured Logging

The Hazina-Escrow backend uses `pino` for production-ready, structured JSON logging. All logging should be done via the centralized logger utility.

## Using the Logger

Do not use `console.log`, `console.error`, `console.warn`, or `console.info`. Instead, import the logger from the library:

```typescript
import { logger } from '../lib/logger';

// Info level - general operations
logger.info('User authenticated successfully');

// Add contextual metadata
logger.info({ userId: 'user_123', escrowId: 'escrow_456' }, 'Escrow created');

// Error level - handling exceptions
try {
  // ...
} catch (err) {
  logger.error({ err, userId: 'user_123' }, 'Failed to create payment');
}
```

## Log Levels

- `trace`: Highly verbose, rarely used.
- `debug`: Verbose diagnostics (e.g., intermediate state dumps).
- `info`: Normal operations (e.g., successful webhooks, created escrows).
- `warn`: Recoverable issues or unexpected anomalies (e.g., rate limits hit, delayed backups).
- `error`: Failures and handled exceptions.
- `fatal`: Unrecoverable errors requiring immediate shutdown.

## Environment Configuration

The logger behaves differently based on the environment:

- **Local Development** (`NODE_ENV=development` or unset): Uses `pino-pretty` to output human-readable, colorized logs to the terminal.
- **Production** (`NODE_ENV=production`): Outputs highly efficient, structured JSON logs optimized for observability platforms like Datadog.
- **Log Level**: The base log level is determined by the `LOG_LEVEL` environment variable (defaults to `info`).

## Security & Privacy Guidelines

The logger is configured to automatically censor sensitive data before it is written. The configuration targets specific JSON paths and standard environment variables.

**Never log the following manually as plain strings:**
- Private keys or wallet secrets (`AGENT_WALLET_SECRET`, `ESCROW_SECRET`)
- Session tokens or JWT secrets
- Third-party service API keys (Datadog, Anthropic, etc.)

When logging error objects containing secrets, `pino` will sanitize the specified paths automatically. If you introduce new sensitive environment variables or payload fields, add them to the `paths` array in `src/lib/logger.ts`.
