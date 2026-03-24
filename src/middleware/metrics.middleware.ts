import monitoringConfig from '../config/monitoring.config';
import promClient, { Histogram, Counter } from 'prom-client';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.utils';
import process from 'node:process';

/**
 * Prometheus Metrics Middleware
 * Tracks HTTP request metrics: duration (histogram), total requests, errors.
 * Labels: method, path, status_code, outcome (success/client_error/error)
 * Applied early in middleware stack.
 * Skips if Prometheus disabled.
 */
let requestDuration: Histogram<string>;
let requestTotal: Counter<string>;
let requestErrors: Counter<string>;

function initializeRequestMetrics() {
  if (!monitoringConfig.prometheus.enabled || requestDuration) return;

  requestDuration = new promClient.Histogram({
    name: 'http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: ['method', 'path', 'status_code', 'outcome'],
    registers: [promClient.register],
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, Infinity], // ms buckets
  });

  requestTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'path', 'status_code', 'outcome'],
    registers: [promClient.register],
  });

  requestErrors = new promClient.Counter({
    name: 'http_request_errors_total',
    help: 'HTTP request errors (4xx/5xx)',
    labelNames: ['method', 'path', 'status_code', 'outcome'],
    registers: [promClient.register],
  });

  logger.info('Metrics middleware initialized');
}

function normalizePath(path: string): string {
  return path
    .split('?')[0] // remove query
    .replace(/\/+$/, '') // trim trailing /
    .substring(0, 100); // truncate long paths
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!monitoringConfig.prometheus.enabled) {
    return next();
  }

  initializeRequestMetrics();

  const labels = {
    method: req.method,
    path: normalizePath(req.route?.path || req.path),
    status_code: '0',
    outcome: 'pending',
  };

  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1_000_000; // ns to ms

    const statusCode = res.statusCode.toString();
    labels.status_code = statusCode;
    labels.outcome = statusCode.startsWith('5') ? 'error' 
                      : statusCode.startsWith('4') ? 'client_error' 
                      : 'success';

    requestDuration.observe(labels, durationMs);
    requestTotal.inc(labels);

    if (labels.outcome !== 'success') {
      requestErrors.inc(labels);
    }

    if (monitoringConfig.logging.logMetrics) {
      logger.debug('Request metrics recorded', { 
        ...labels, 
        durationMs: Math.round(durationMs * 10) / 10 
      });
    }
  });

  next();
}

export default metricsMiddleware;

