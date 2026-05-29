import { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { ResponseUtil } from '../utils/response.utils';
import HealthService from '../services/health.service';
import { logger } from '../utils/logger.utils';

/**
 * Health Controller
 * Public endpoints for health checks and readiness probes.
 */
export const HealthController = {
  /**
   * GET /health/live
   * Liveness probe: returns 200 if process is running.
   */
  getLive: asyncHandler(async (_req: any, res: Response) => {
    if (HealthService.isLive()) {
      return res.status(200).json({ status: 'healthy' });
    }
    return res.status(503).json({ status: 'unhealthy' });
  }),

  /**
   * GET /health/ready
   * Readiness probe: checks critical dependencies.
   */
  getReady: asyncHandler(async (_req: any, res: Response) => {
    const healthStatus = await HealthService.checkReadiness();
    const statusCode = healthStatus.status === "unhealthy" ? 503 : 200;

    if (statusCode === 503) {
      logger.warn("Readiness check failed", {
        components: healthStatus.components,
      });
    }

    const simplified = await HealthService.getSimplifiedStatus();
    return res.status(statusCode).json(simplified);
  }),

  /**
   * GET /health/detailed
   * Admin only: returns full component-level status with latency and system info.
   */
  getDetailed: asyncHandler(async (_req: any, res: Response) => {
    const healthStatus = await HealthService.checkReadiness(); // Detail check
    
    ResponseUtil.success(res, healthStatus, 'Detailed health status', 200);
  }),
};

export default HealthController;
