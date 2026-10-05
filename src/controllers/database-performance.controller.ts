/**
 * database-performance.controller.ts
 *
 * Admin endpoints for database query performance monitoring (issue #742).
 *
 * Endpoints:
 *   GET /api/v1/admin/database/slow-queries   — paginated slow-query log
 *   GET /api/v1/admin/database/index-recommendations — automated index advice
 */

import { Request, Response } from "express";
import { ResponseUtil } from "../utils/response.utils";
import QueryMonitorService from "../services/query-monitor.service";
import { Logger } from "../utils/logger.utils";

export const DatabasePerformanceController = {
  /**
   * GET /api/v1/admin/database/slow-queries
   *
   * Query params:
   *   threshold  — minimum execution time in ms (default 500)
   *   limit      — max records to return (default 20, max 100)
   *   sort       — "frequency" | "max_time" (default "max_time")
   */
  async getSlowQueries(req: Request, res: Response): Promise<void> {
    try {
      const threshold = Math.max(0, parseInt(String(req.query.threshold ?? "500"), 10) || 500);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
      const sortBy = req.query.sort === "frequency" ? "frequency" : "max_time";

      const start = Date.now();
      const queries = await QueryMonitorService.getSlowQueries({ threshold, limit, sortBy });
      const responseTimeMs = Date.now() - start;

      ResponseUtil.success(
        res,
        {
          queries,
          meta: {
            threshold_ms: threshold,
            limit,
            sort: sortBy,
            count: queries.length,
            response_time_ms: responseTimeMs,
          },
        },
        "Slow query log retrieved",
      );
    } catch (error) {
      logger.error("DatabasePerformanceController.getSlowQueries failed", { error });
      ResponseUtil.error(res, "Failed to retrieve slow query log", 500);
    }
  },

  /**
   * GET /api/v1/admin/database/index-recommendations
   *
   * Analyses recent slow-query EXPLAIN plans and returns CREATE INDEX
   * suggestions for sequential scans on large tables.
   */
  async getIndexRecommendations(req: Request, res: Response): Promise<void> {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
      const recommendations = await QueryMonitorService.getAggregatedIndexRecommendations(limit);

      ResponseUtil.success(
        res,
        {
          recommendations,
          count: recommendations.length,
        },
        "Index recommendations generated",
      );
    } catch (error) {
      logger.error("DatabasePerformanceController.getIndexRecommendations failed", { error });
      ResponseUtil.error(res, "Failed to generate index recommendations", 500);
    }
  },
};
