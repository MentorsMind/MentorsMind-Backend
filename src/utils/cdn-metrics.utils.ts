import { Gauge, Counter } from 'prom-client';
import { logger } from './logger.utils';

/**
 * Prometheus metrics for CDN health monitoring and invalidation tracking.
 */

// Health metrics per domain
export const cdnDomainHealthGauge = new Gauge({
  name: 'cdn_domain_health',
  help: 'CDN domain health status (1 = healthy, 0 = unhealthy)',
  labelNames: ['domain'],
});

export const cdnDomainLatencyGauge = new Gauge({
  name: 'cdn_domain_latency_ms',
  help: 'CDN domain response latency in milliseconds',
  labelNames: ['domain'],
});

export const cdnCircuitBreakerStateGauge = new Gauge({
  name: 'cdn_circuit_breaker_open',
  help: 'Circuit breaker state (1 = open, 0 = closed)',
  labelNames: ['domain'],
});

// Invalidation tracking
export const cdnInvalidationFailuresCounter = new Counter({
  name: 'cdn_invalidation_failures_total',
  help: 'Total number of failed CDN invalidations',
  labelNames: ['provider', 'reason'],
});

export const cdnInvalidationSuccessCounter = new Counter({
  name: 'cdn_invalidation_success_total',
  help: 'Total number of successful CDN invalidations',
  labelNames: ['provider'],
});

export const cdnInvalidationRetriesCounter = new Counter({
  name: 'cdn_invalidation_retries_total',
  help: 'Total number of CDN invalidation retries',
  labelNames: ['provider'],
});

// Queue metrics
export const cdnInvalidationQueueSizeGauge = new Gauge({
  name: 'cdn_invalidation_queue_size',
  help: 'Number of items in the CDN invalidation retry queue',
  labelNames: ['status'], // pending, completed, failed
});

/**
 * Update CDN domain health metrics.
 */
export function updateCDNHealthMetrics(domain: string, latencyMs: number, healthy: boolean, circuitOpen: boolean): void {
  try {
    cdnDomainHealthGauge.set({ domain }, healthy ? 1 : 0);
    cdnDomainLatencyGauge.set({ domain }, latencyMs);
    cdnCircuitBreakerStateGauge.set({ domain }, circuitOpen ? 1 : 0);
  } catch (error) {
    // Silently fail to avoid breaking metrics collection
    logger.warn('Failed to update CDN health metrics', { domain, error });
  }
}

/**
 * Record a failed invalidation.
 */
export function recordInvalidationFailure(provider: string, reason: string = 'unknown'): void {
  try {
    cdnInvalidationFailuresCounter.inc({
      provider,
      reason,
    });
  } catch (error) {
    logger.warn('Failed to record invalidation failure', { provider, error });
  }
}

/**
 * Record a successful invalidation.
 */
export function recordInvalidationSuccess(provider: string): void {
  try {
    cdnInvalidationSuccessCounter.inc({
      provider,
    });
  } catch (error) {
    logger.warn('Failed to record invalidation success', { provider, error });
  }
}

/**
 * Record an invalidation retry.
 */
export function recordInvalidationRetry(provider: string): void {
  try {
    cdnInvalidationRetriesCounter.inc({
      provider,
    });
  } catch (error) {
    logger.warn('Failed to record invalidation retry', { provider, error });
  }
}

/**
 * Update invalidation queue size.
 */
export function updateInvalidationQueueSize(status: 'pending' | 'completed' | 'failed', count: number): void {
  try {
    cdnInvalidationQueueSizeGauge.set({ status }, count);
  } catch (error) {
    logger.warn('Failed to update invalidation queue size', { status, error });
  }
}

export default {
  cdnDomainHealthGauge,
  cdnDomainLatencyGauge,
  cdnCircuitBreakerStateGauge,
  cdnInvalidationFailuresCounter,
  cdnInvalidationSuccessCounter,
  cdnInvalidationRetriesCounter,
  cdnInvalidationQueueSizeGauge,
  updateCDNHealthMetrics,
  recordInvalidationFailure,
  recordInvalidationSuccess,
  recordInvalidationRetry,
  updateInvalidationQueueSize,
};
