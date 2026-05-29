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
  const correlationIdHeader = req.headers['x-correlation-id'] || req.headers['x-request-id'];
  const correlationId = Array.isArray(correlationIdHeader) 
    ? correlationIdHeader[0] 
    : (typeof correlationIdHeader === 'string' ? correlationIdHeader : uuidv4());

  // 2. X-Request-ID: always a new UUID for this specific request if not present
  const requestIdHeader = req.headers['x-request-id'];
  const requestId = Array.isArray(requestIdHeader)
    ? requestIdHeader[0]
    : (typeof requestIdHeader === 'string' ? requestIdHeader : uuidv4());

  // 3. Attach to request object (optional but common)
  (req as any).requestId = requestId;
  (req as any).correlationId = correlationId;

  // 4. Attach to response headers
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Correlation-Id', correlationId);

  // 5. Track response time
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    res.setHeader('X-Response-Time', `${duration}ms`);
  });

  // 6. Run downstream logic within the trace context
  const context: TraceContext = {
    requestId,
    correlationId,
    startTime,
  };

  traceStore.run(context, () => next());
};
