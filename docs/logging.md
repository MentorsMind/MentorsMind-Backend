# Logging Guide

## Overview

MentorsMind-Backend uses [Winston](https://github.com/winstonjs/winston) for structured logging, with daily log rotation in production. Every request is automatically correlated with a unique **Correlation ID** (UUID v4) so that all log entries from the same HTTP request can be traced together.

---

## Log Levels

| Level | When to Use |
|-------|-------------|
| `error` | Unrecoverable errors, exceptions, failed operations |
| `warn` | Degraded behaviour, unexpected input, skipped operations |
| `info` | Normal application milestones (startup, request completed, etc.) |
| `debug` | Verbose diagnostic data, useful in development only |

Set the active level via the `LOG_LEVEL` environment variable (default: `info`).

---

## Importing the Logger

```typescript
import { logger } from './utils/logger';
// or, via the backward-compat alias:
import { logger } from './utils/logger.utils';
```

### Basic Usage

```typescript
logger.info('User registered', { userId: '123', email: 'user@example.com' });
logger.warn('Rate limit approaching', { userId: '123', remaining: 5 });
logger.error('Payment failed', { userId: '123', error: err.message });
logger.debug('Executing SQL query', { sql, params });
```

---

## Correlation IDs

Every HTTP request gets a **correlation ID** attached by `correlationIdMiddleware` (mounted first in `app.ts`).

- The ID is read from the `X-Correlation-Id` **request** header if present, otherwise a new UUID v4 is generated.
- It is echoed back in the `X-Correlation-Id` **response** header.
- It is available anywhere in the async call chain via `getCorrelationId()`.

### Retrieving the Correlation ID in Services

```typescript
import { getCorrelationId } from '../middleware/correlation-id.middleware';

async function doSomething() {
  const correlationId = getCorrelationId(); // works inside any request context
  logger.info('Doing something', { correlationId });
}
```

### Creating a Child Logger (pre-bound Correlation ID)

```typescript
import { withCorrelationId } from '../utils/logger';

const requestLogger = withCorrelationId(req.correlationId);
requestLogger.info('Processing request'); // always includes correlationId
```

---

## Log Formats

| Environment | Format | Notes |
|------------|--------|-------|
| `development` | Pretty-printed, colorized | `YYYY-MM-DD HH:mm:ss [corrId] LEVEL: message {meta}` |
| `production` | JSON | Machine-parseable, one JSON object per line |
| `test` | Suppressed | Console transport is disabled; spy on `logger` methods in tests |

---

## Sensitive Field Redaction

The following keys are **automatically replaced with `[REDACTED]`** anywhere in the log metadata (recursively):

`password`, `token`, `secret`, `secretKey`, `authorization`, `refreshToken`, `apiKey`, `privateKey`

You **never** need to redact these manually. However, **do not** use these key names for non-sensitive data.

---

## Log Files (Production Only)

When `NODE_ENV=production`, logs are written to rotating files:

| File | Content |
|------|---------|
| `logs/app-YYYY-MM-DD.log` | All levels |
| `logs/error-YYYY-MM-DD.log` | Errors only |

Configure via environment variables:

```
LOG_FILE_PATH=logs   # directory (default: "logs")
LOG_MAX_SIZE=20m     # max file size before rotation
LOG_MAX_FILES=14d    # retention period
```

---

## Request / Response Logging

`requestLoggerMiddleware` (in `request-logger.middleware.ts`) automatically logs:

- **Incoming request**: method, URL, IP, userAgent, correlationId
- **Outgoing response** (on `res.finish`): statusCode, durationMs, correlationId

Log level is selected by HTTP status:
- `2xx, 3xx` → `info`
- `4xx` → `warn`
- `5xx` → `error`

---

## Testing

Logger methods can be mocked in Jest:

```typescript
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
```

Run logging-related tests:

```bash
npx jest --testPathPattern="logger|correlation-id|request-logger" --verbose
```
