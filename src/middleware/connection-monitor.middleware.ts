/**
 * Connection Monitor Middleware
 * Tracks connection usage and provides real-time monitoring
 */

import { Request, Response, NextFunction } from 'express';
import { Logger } from "../utils/logger.utils";

export class ConnectionMonitorMiddleware {
  private logger: Logger;
  private activeRequests: Map<string, { startTime: number; path: string }> = new Map();

  constructor() {
    this.logger = new Logger('ConnectionMonitor');
  }

  public monitor() {
    return (req: Request, res: Response, next: NextFunction) => {
      const requestId = req.headers['x-request-id'] as string || `req_${Date.now()}`;
      
      this.activeRequests.set(requestId, {
        startTime: Date.now(),
        path: req.path,
      });

      res.on('finish', () => {
        const request = this.activeRequests.get(requestId);
        if (request) {
          const duration = Date.now() - request.startTime;
          this.logger.debug(`Request ${requestId} to ${request.path} took ${duration}ms`);
          this.activeRequests.delete(requestId);
        }
      });

      next();
    };
  }

  public getActiveRequestsCount(): number {
    return this.activeRequests.size;
  }

  public getMetrics() {
    return {
      activeRequests: this.activeRequests.size,
      requests: Array.from(this.activeRequests.entries()).map(([id, data]) => ({
        id,
        path: data.path,
        duration: Date.now() - data.startTime,
      })),
    };
  }
}
