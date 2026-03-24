import { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { ResponseUtil } from '../utils/response.utils';
import HealthService, { HealthStatus } from '../services/health.service';
import monitoringConfig from '../config/monitoring.config';
import { logger } from '../utils/logger.utils';

/**
 * Health Controller
 * Public endpoints for health checks and metrics.
 * /health - JSON health status (component level)
 * /metrics - Prometheus metrics (text/plain)
 */
export const HealthController = {
  /**
   * GET /health
   * Comprehensive component health status
   */
  getHealth: asyncHandler(async (_req: any, res: Response) => {
    const healthStatus: HealthStatus = await HealthService.checkHealth();
    
    if (monitoringConfig.logging.logHealthEvents) {
      logger.info('Health endpoint called', {
        overall: healthStatus.overall,
        clientIp: res.req.ip,
        userAgent: res.req.get('User-Agent'),
      });
    }

    // Use 503 for down, 200 otherwise (consistent with readiness)
    const statusCode = healthStatus.overall === 'down' ? 503 : 200;
    
    ResponseUtil.success(res, healthStatus, 'Health status', statusCode);
  }),

  /**
   * GET /metrics
   * Prometheus metrics endpoint
   */
  getMetrics: asyncHandler(async (_req: any, res: Response) => {
    if (!monitoringConfig.prometheus.enabled) {
      return ResponseUtil.error(res, 'Metrics disabled', 503);
    }

    const metrics = await HealthService.getMetrics();
    logger.debug('Metrics endpoint called', { bytes: metrics.length });
    
    res.set('Content-Type', promClient.register.contentType);
    res.status(200).send(metrics);
  }),
};

export default HealthController;

