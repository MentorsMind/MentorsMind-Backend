import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Generate or catch existing IDs
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  const traceId = (req.headers['x-trace-id'] as string) || uuidv4();

  // Attach to request object for downstream use/forwarding
  req.headers['x-request-id'] = requestId;
  req.headers['x-trace-id'] = traceId;

  // 2. Set request start time
  const startHrTime = process.hrtime();

  // 3. Set response headers immediately
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Trace-ID', traceId);

  // 4. Track response time dynamically on finish
  res.on('finish', () => {
    const elapsedHrTime = process.hrtime(startHrTime);
    const elapsedTimeInMs = (elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6).toFixed(2);
    res.setHeader('X-Response-Time', `${elapsedTimeInMs}ms`);
  });

  next();
}
