import cron from 'node-cron';
import { CDNHealthService } from '../services/cdn-health.service';
import { CDNService } from '../services/cdn.service';
import { Logger } from "../utils/logger.utils";

let healthCheckInterval: cron.ScheduledTask | null = null;

/**
 * Start background CDN health checks every 60 seconds.
 * This runs independently and stores results in Redis for getHealthiestDomain() to use.
 */
export function startCDNHealthChecks(): void {
  if (healthCheckInterval) {
    logger.info('CDN health checks already running');
    return;
  }

  logger.info('Starting CDN health checks (every 60 seconds)');

  // Run health checks every 60 seconds (cron expression: */1 * * * * for every minute is too frequent)
  // We'll use setInterval instead for precise 60-second timing
  const interval = setInterval(async () => {
    try {
      const config = CDNService.getConfig();
      if (!config) {
        logger.warn('CDN not configured, skipping health checks');
        return;
      }

      logger.debug('Running CDN health checks', { domains: config.domains });

      // Check all domains concurrently
      await Promise.all(
        config.domains.map((domain) =>
          CDNHealthService.checkHealth(domain).catch((error) => {
            logger.error(`Health check failed for ${domain}`, {
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }),
        ),
      );

      logger.debug('CDN health checks completed');
    } catch (error) {
      logger.error('CDN health check job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, 60000); // 60 seconds

  // Allow graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, stopping CDN health checks');
    clearInterval(interval);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, stopping CDN health checks');
    clearInterval(interval);
  });

  logger.info('CDN health checks started successfully');
}

/**
 * Stop CDN health checks.
 */
export function stopCDNHealthChecks(): void {
  if (healthCheckInterval) {
    healthCheckInterval.stop();
    healthCheckInterval = null;
    logger.info('CDN health checks stopped');
  }
}

export default {
  startCDNHealthChecks,
  stopCDNHealthChecks,
};
