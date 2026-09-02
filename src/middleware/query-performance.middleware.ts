/**
 * Per-request query performance attribution (issue #859).
 *
 * `queryLogger` instruments the pool globally, which tells you a query was
 * slow but not which endpoint caused it. This attaches a per-request budget so
 * a slow endpoint is identifiable by route, and surfaces pool saturation while
 * requests are still succeeding rather than after they start timing out.
 */

import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";
import databaseTuning from "../config/database-tuning";
import { poolHealth } from "../services/db-optimizer.service";

export interface RequestQueryStats {
  queries: number;
  totalDbMs: number;
  slowQueries: number;
}

declare module "express-serve-static-core" {
  interface Request {
    queryStats?: RequestQueryStats;
  }
}

/** Record a query against the in-flight request, if there is one. */
export function recordQuery(req: Request | undefined, durationMs: number): void {
  if (!req?.queryStats) return;
  req.queryStats.queries += 1;
  req.queryStats.totalDbMs += durationMs;
  if (durationMs >= databaseTuning.query.slowQueryMs) {
    req.queryStats.slowQueries += 1;
  }
}

/**
 * Attribute database time to the route that spent it.
 *
 * Logging happens on response finish so the numbers are complete, and it is
 * deliberately quiet: only requests that were actually slow are reported, or
 * the log becomes a per-request firehose that nobody reads.
 */
export function queryPerformanceMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    req.queryStats = { queries: 0, totalDbMs: 0, slowQueries: 0 };
    const startedAt = Date.now();

    res.on("finish", () => {
      const stats = req.queryStats;
      if (!stats) return;

      const totalMs = Date.now() - startedAt;
      const interesting =
        stats.slowQueries > 0 || stats.totalDbMs >= databaseTuning.query.slowQueryMs;
      if (!interesting) return;

      const health = poolHealth();

      logger.warn(
        {
          method: req.method,
          // `route.path` is the pattern (/users/:id), not the populated URL, so
          // this aggregates instead of producing one label per identifier.
          route: (req as { route?: { path?: string } }).route?.path ?? req.path,
          status: res.statusCode,
          totalMs,
          dbMs: stats.totalDbMs,
          queries: stats.queries,
          slowQueries: stats.slowQueries,
          dbShare: totalMs === 0 ? 0 : Number((stats.totalDbMs / totalMs).toFixed(2)),
          poolSaturated: health.saturated,
          poolUtilizationPercent: Number(health.utilizationPercent.toFixed(1)),
        },
        "Slow request database profile",
      );
    });

    next();
  };
}

export default queryPerformanceMiddleware;
