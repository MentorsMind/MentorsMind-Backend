import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { CDNHealthService } from '../services/cdn-health.service';
import { CDNService } from '../services/cdn.service';
import { ResponseUtil } from '../utils/response.utils';
import { logger } from '../utils/logger';

/**
 * Admin controllers for CDN health monitoring and management.
 * All endpoints require admin authentication.
 */
export const CDNAdminController = {
  /**
   * GET /api/v1/admin/cdn/health
   * Get per-domain CDN health status and metrics.
   */
  async getHealthStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const config = CDNService.getConfig();
      if (!config) {
        ResponseUtil.error(res, 'CDN is not configured', 400);
        return;
      }

      const metrics = await CDNHealthService.getHealthStatus(config.domains);

      ResponseUtil.success(res, {
        ...metrics,
        provider: config.provider,
        domainCount: config.domains.length,
        healthyCount: Object.values(metrics).filter((m) => m.healthy).length,
        circuitOpenCount: Object.values(metrics).filter((m) => m.circuitOpen).length,
      }, 'CDN health status retrieved successfully', 200);
    } catch (error) {
      logger.error('Failed to get CDN health status', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      ResponseUtil.error(res, 'Failed to get CDN health status', 500);
    }
  },

  /**
   * POST /api/v1/admin/cdn/health/check/:domain
   * Manually trigger a health check for a specific domain.
   */
  async checkDomainHealth(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { domain } = req.params;
      if (!domain) {
        ResponseUtil.error(res, 'Domain is required', 400);
        return;
      }

      const health = await CDNHealthService.checkHealth(domain);

      ResponseUtil.success(res, health, 'Domain health check completed', 200);
    } catch (error) {
      logger.error('Failed to check domain health', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      ResponseUtil.error(res, 'Failed to check domain health', 500);
    }
  },

  /**
   * POST /api/v1/admin/cdn/health/clear/:domain
   * Manually clear circuit breaker and health status for a domain.
   * Useful for manual recovery after an outage.
   */
  async clearDomainHealth(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { domain } = req.params;
      if (!domain) {
        ResponseUtil.error(res, 'Domain is required', 400);
        return;
      }

      await CDNHealthService.clearHealth(domain);

      logger.info('Manually cleared CDN health status', {
        userId: req.user?.id,
        domain,
      });

      ResponseUtil.success(res, { domain, cleared: true }, 'Domain health status cleared', 200);
    } catch (error) {
      logger.error('Failed to clear domain health', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      ResponseUtil.error(res, 'Failed to clear domain health', 500);
    }
  },

  /**
   * GET /api/v1/admin/cdn/invalidation-queue/stats
   * Get statistics on the CDN invalidation retry queue.
   */
  async getInvalidationQueueStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { getCDNInvalidationQueueStats } = await import('../jobs/cdn-invalidation.job');
      const stats = await getCDNInvalidationQueueStats();

      ResponseUtil.success(res, stats, 'CDN invalidation queue statistics retrieved', 200);
    } catch (error) {
      logger.error('Failed to get CDN invalidation queue stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      ResponseUtil.error(res, 'Failed to get CDN invalidation queue stats', 500);
    }
  },
};

export default CDNAdminController;
