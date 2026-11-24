import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

// ─── AsyncLocalStorage store for trace context propagation ───────────────────
export interface TraceContext {
  requestId: string;
  correlationId: string;
  startTime: number;
}

export const traceStore = new AsyncLocalStorage<TraceContext>();

const getHeaderValue = (value: string | string[] | undefined): string | undefined => {
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === 'string' && header.trim().length > 0 ? header : undefined;
};

/**
 * Retrieve the current request's trace context from anywhere in the
 * call stack without needing to thread `req` through every function.
 */
export function getTraceContext(): TraceContext | undefined {
  return traceStore.getStore();
}

/**
 * Tracing Middleware
 * 
 * 1. Generates or extracts X-Request-ID and X-Correlation-ID headers.
 * 2. Sets up AsyncLocalStorage context for end-to-end propagation.
 * 3. Adds X-Response-Time header to the final response.
 * 4. Ensures trace IDs are attached to the response.
 */
export const tracingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startTime = Date.now();

  // 1. X-Correlation-ID: from upstream gateway (if any), otherwise new UUID
  const correlationId =
    getHeaderValue(req.headers['x-correlation-id']) ||
    getHeaderValue(req.headers['x-request-id']) ||
    uuidv4();

  // 2. X-Request-ID: always a new UUID for this specific request if not present
  const requestId = getHeaderValue(req.headers['x-request-id']) || uuidv4();

  // 3. X-Trace-ID: preserve the upstream trace ID or start a new trace.
  const traceId = getHeaderValue(req.headers['x-trace-id']) || uuidv4();

  // 4. Attach to request object (optional but common)
  (req as any).requestId = requestId;
  (req as any).correlationId = correlationId;
  (req as any).traceId = traceId;

  // Also expose on res.locals so other middleware (e.g. pino-http) can read it
  if ((res as any).locals) {
    (res as any).locals.requestId = requestId;
    (res as any).locals.correlationId = correlationId;
    (res as any).locals.traceId = traceId;
  }

  // 5. Attach to response headers
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Trace-ID', traceId);
  res.setHeader('X-Correlation-Id', correlationId);

  // 6. Track response time and make it available for logging (do not set header in 'finish')
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    // store on res.locals so request logger middleware can include it in logs
    if ((res as any).locals) (res as any).locals.responseTimeMs = duration;
  });

  // 7. Run downstream logic within the trace context
  const context: TraceContext = {
    requestId,
    correlationId,
    startTime,
  };

  traceStore.run(context, () => next());
};
