import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// AsyncLocalStorage store for correlation ID propagation
// ---------------------------------------------------------------------------
const correlationStore = new AsyncLocalStorage<Map<string, string>>();

/**
 * Retrieve the current request's correlation ID from anywhere in the
 * call stack without needing to thread `req` through every function.
 *
 * Returns `undefined` when called outside a request context (e.g. scripts).
 */
export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.get('correlationId');
}

// ---------------------------------------------------------------------------
// Extend Express Request type
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Correlation ID middleware.
 *
 * - Reads `X-Correlation-Id` from the incoming request header (allows
 *   upstream gateways / clients to pass their own trace ID through).
 * - Falls back to a newly generated UUID v4.
 * - Stores the ID on `req.correlationId`, responds with
 *   `X-Correlation-Id` header, and makes it available via
 *   `getCorrelationId()` anywhere in the same async call-chain.
 */
export const correlationIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incomingId = req.headers['x-correlation-id'];
  const correlationId =
    typeof incomingId === 'string' && incomingId.trim() !== ''
      ? incomingId.trim()
      : uuidv4();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  // Run the rest of the request inside the AsyncLocalStorage context
  const store = new Map<string, string>();
  store.set('correlationId', correlationId);
  correlationStore.run(store, () => next());
};
