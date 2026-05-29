/**
 * metrics.middleware.ts
 *
 * Express middleware that records HTTP request metrics and exposes the
 * Prometheus scrape endpoint at GET /metrics (or the path configured by
 * PROMETHEUS_ENDPOINT).
 *
 * Applied globally in app.ts — order matters:
 *   correlationId → security → requestLogger → metricsMiddleware → routes
 *
 * The /metrics endpoint is intentionally mounted on a separate lightweight
 * server started in server.ts (via startMetricsServer()) so that it can be
 * restricted to the internal network without touching the public API port.
 * The metricsMiddleware here only instruments request timing.
 */

import http from 'node:http';
import { Request, Response, NextFunction, Application } from 'express';
import {
  metricsRegistry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
} from '../config/metrics';
import { monitoringConfig } from '../config/monitoring.config';
import { logger } from '../utils/logger.utils';

// ─── Path normalisation ───────────────────────────────────────────────────────

/**
 * Collapses dynamic path segments to their Express route pattern so that
 * cardinality stays low in Prometheus label sets.
 *
 * Examples:
 *   /api/v1/users/abc123        → /api/v1/users/:id
 *   /api/v1/bookings/99/reviews → /api/v1/bookings/:id/reviews
 */
function normalizePath(req: Request): string {
  const routePath: string | undefined =
    (req.route as { path?: string } | undefined)?.path;

  if (routePath) {
    const base = (req.baseUrl ?? '').replace(/\/+$/, '');
    return (base + routePath).replace(/\/+$/, '') || '/';
  }

  return req.path
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/+$/, '') || '/';
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Records http_requests_total and http_request_duration_seconds for every
 * request that passes through the Express stack.
 *
 * No-op when Prometheus is disabled (PROMETHEUS_ENABLED=false).
 */
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!monitoringConfig.prometheus.enabled) {
    next();
    return;
  }

  const startNs = process.hrtime.bigint();

  res.on('finish', () => {
    const durationSeconds =
      Number(process.hrtime.bigint() - startNs) / 1e9;

    const labels = {
      method: req.method,
      path: normalizePath(req),
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
  });

  next();
}

export default metricsMiddleware;

// ─── Scrape server ────────────────────────────────────────────────────────────

/**
 * Starts a minimal HTTP server on PROMETHEUS_PORT that serves GET /metrics.
 * Separated from the main Express app so it can be firewall-restricted to
 * the internal network (Prometheus scraper only).
 *
 * Call once from server.ts after the main server starts.
 */
export function startMetricsServer(): http.Server | null {
  if (!monitoringConfig.prometheus.enabled) {
    logger.info('Prometheus metrics disabled — scrape server not started');
    return null;
  }

  const port = monitoringConfig.prometheus.port;
  const endpoint = monitoringConfig.prometheus.endpoint || '/metrics';

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === endpoint) {
      try {
        const output = await metricsRegistry.metrics();
        res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
        res.end(output);
      } catch (err) {
        res.writeHead(500);
        res.end('Internal server error collecting metrics');
        logger.error('Failed to collect metrics', { error: err });
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    logger.info(
      `Prometheus scrape target: http://0.0.0.0:${port}${endpoint} (internal network only)`,
    );
  });

  return server;
}

/**
 * Registers GET /metrics directly on the Express app.
 * Use only in development when a separate scrape port is inconvenient.
 */
export function registerMetricsRoute(app: Application): void {
  const endpoint = monitoringConfig.prometheus.endpoint || '/metrics';
  app.get(endpoint, async (_req: Request, res: Response) => {
    try {
      const output = await metricsRegistry.metrics();
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.send(output);
    } catch (err) {
      res.status(500).send('Error collecting metrics');
    }
  });
  logger.info(`Metrics endpoint registered at ${endpoint}`);
}
