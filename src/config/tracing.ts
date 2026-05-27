/**
 * tracing.ts
 *
 * OpenTelemetry distributed tracing for MentorsMind.
 *
 * ## Trace spans created
 *
 *   HTTP requests        — via @opentelemetry/instrumentation-http (auto)
 *   Express routing      — via @opentelemetry/instrumentation-express (auto)
 *   PostgreSQL queries   — via @opentelemetry/instrumentation-pg (auto)
 *   Redis calls (ioredis)— via @opentelemetry/instrumentation-ioredis (auto)
 *   BullMQ queue jobs    — via manual wrapWithSpan() helper
 *   Stellar API calls    — via manual wrapWithSpan() helper
 *
 * ## Exporters
 *
 *   Local dev  (OTEL_EXPORTER=jaeger) → Jaeger at http://localhost:14268/api/traces
 *   Production (OTEL_EXPORTER=datadog or OTEL_EXPORTER=otlp) →
 *               OTLP/gRPC at OTEL_EXPORTER_OTLP_ENDPOINT (Datadog Agent / collector)
 *
 * ## Activation
 *
 *   Call `initTracing()` as the very first statement in server.ts — before any
 *   other imports — so that auto-instrumentations can patch modules at load time:
 *
 *   ```ts
 *   // server.ts
 *   import { initTracing } from './config/tracing';
 *   initTracing();               // ← must be synchronous and first
 *   import express from 'express';
 *   // …
 *   ```
 *
 * ## Required packages (add to package.json):
 *
 *   @opentelemetry/sdk-node
 *   @opentelemetry/api
 *   @opentelemetry/auto-instrumentations-node
 *   @opentelemetry/exporter-jaeger          (for Jaeger dev export)
 *   @opentelemetry/exporter-trace-otlp-grpc (for Datadog / OTLP production)
 *   @opentelemetry/resources
 *   @opentelemetry/semantic-conventions
 */

// ─── Graceful no-op when OTel packages are not installed ─────────────────────
// The project may not yet have the OTel packages installed. We use dynamic
// requires and fall back to no-ops so that unrelated code paths are unaffected.

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { env } from './env';
import { logger } from '../utils/logger.utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SpanStatus = 'ok' | 'error';

export interface SpanOptions {
  /** Additional key-value attributes attached to the span. */
  attributes?: Record<string, string | number | boolean>;
}

// ─── SDK bootstrap ────────────────────────────────────────────────────────────

let tracingInitialized = false;

/**
 * Initialises the OpenTelemetry SDK and auto-instrumentations.
 * Safe to call multiple times — only runs once.
 */
export function initTracing(): void {
  if (tracingInitialized) return;
  if (env.NODE_ENV === 'test') return; // never trace in test runs

  const exporterType =
    (process.env.OTEL_EXPORTER ?? 'jaeger').toLowerCase();

  // Attempt to load OTel packages — skip gracefully if not installed
  let NodeSDK: any;
  let getNodeAutoInstrumentations: any;
  let Resource: any;
  let SEMRESATTRS_SERVICE_NAME: string;
  let SEMRESATTRS_SERVICE_VERSION: string;
  let SEMRESATTRS_DEPLOYMENT_ENVIRONMENT: string;
  let SpanExporter: any;

  try {
    ({ NodeSDK } = require('@opentelemetry/sdk-node'));
    ({ getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node'));
    ({ Resource } = require('@opentelemetry/resources'));
    const semconv = require('@opentelemetry/semantic-conventions');
    SEMRESATTRS_SERVICE_NAME = semconv.SEMRESATTRS_SERVICE_NAME ?? 'service.name';
    SEMRESATTRS_SERVICE_VERSION = semconv.SEMRESATTRS_SERVICE_VERSION ?? 'service.version';
    SEMRESATTRS_DEPLOYMENT_ENVIRONMENT = semconv.SEMRESATTRS_DEPLOYMENT_ENVIRONMENT ?? 'deployment.environment';
  } catch {
    logger.warn(
      '[Tracing] @opentelemetry packages not installed — tracing disabled. ' +
      'Run: npm install @opentelemetry/sdk-node @opentelemetry/api ' +
      '@opentelemetry/auto-instrumentations-node @opentelemetry/resources ' +
      '@opentelemetry/semantic-conventions',
    );
    return;
  }

  // Pick exporter
  try {
    if (exporterType === 'jaeger') {
      const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
      const jaegerEndpoint =
        process.env.JAEGER_ENDPOINT ?? 'http://localhost:14268/api/traces';
      SpanExporter = new JaegerExporter({ endpoint: jaegerEndpoint });
      logger.info(`[Tracing] Using Jaeger exporter → ${jaegerEndpoint}`);
    } else {
      // Datadog Agent or any OTLP collector (set OTEL_EXPORTER_OTLP_ENDPOINT)
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
      const otlpEndpoint =
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317';
      SpanExporter = new OTLPTraceExporter({ url: otlpEndpoint });
      logger.info(`[Tracing] Using OTLP exporter → ${otlpEndpoint}`);
    }
  } catch (err) {
    logger.warn(
      `[Tracing] Could not load exporter for "${exporterType}" — tracing disabled. ` +
      'Install the relevant @opentelemetry/exporter-* package.',
    );
    return;
  }

  const sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: 'mentorminds-backend',
      [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV,
    }),
    traceExporter: SpanExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // HTTP spans — capture incoming + outgoing (Stellar Horizon, external APIs)
        '@opentelemetry/instrumentation-http': { enabled: true },
        // Express routing spans (middleware, route handlers)
        '@opentelemetry/instrumentation-express': { enabled: true },
        // PostgreSQL pg Pool queries
        '@opentelemetry/instrumentation-pg': { enabled: true },
        // ioredis calls (cache, queue, pub/sub)
        '@opentelemetry/instrumentation-ioredis': { enabled: true },
        // fs, dns — disabled to reduce noise
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
  tracingInitialized = true;
  logger.info('[Tracing] OpenTelemetry SDK started');

  // Flush spans on graceful shutdown
  process.on('SIGTERM', () => sdk.shutdown().catch((e: Error) => logger.error('[Tracing] Shutdown error', { error: e })));
  process.on('SIGINT',  () => sdk.shutdown().catch((e: Error) => logger.error('[Tracing] Shutdown error', { error: e })));
}

// ─── Manual span helper ───────────────────────────────────────────────────────

/**
 * Wraps an async function in a named OpenTelemetry span.
 * Falls back to a direct call when tracing is not initialised.
 *
 * @example
 * // Instrument a BullMQ job processor
 * const result = await wrapWithSpan('queue.sessionReminder', async (span) => {
 *   span?.setAttribute('job.id', job.id);
 *   return processReminder(job);
 * }, { attributes: { 'queue.name': 'sessionReminder' } });
 *
 * @example
 * // Instrument a Stellar API call
 * const account = await wrapWithSpan('stellar.loadAccount', async (span) => {
 *   span?.setAttribute('stellar.operation', 'loadAccount');
 *   span?.setAttribute('stellar.network', env.STELLAR_NETWORK);
 *   return server.loadAccount(publicKey);
 * });
 */
export async function wrapWithSpan<T>(
  spanName: string,
  fn: (span: any | null) => Promise<T>,
  options: SpanOptions = {},
): Promise<T> {
  let tracer: any;
  let api: any;

  try {
    api = require('@opentelemetry/api');
    tracer = api.trace.getTracer('mentorminds');
  } catch {
    // OTel not installed — run fn directly
    return fn(null);
  }

  return tracer.startActiveSpan(spanName, async (span: any) => {
    if (options.attributes) {
      for (const [key, value] of Object.entries(options.attributes)) {
        span.setAttribute(key, value);
      }
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: api.SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: api.SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Returns the active OpenTelemetry tracer, or null if OTel is not installed.
 * Useful when you need direct tracer access for custom span trees.
 */
export function getTracer(): any | null {
  try {
    const api = require('@opentelemetry/api');
    return api.trace.getTracer('mentorminds');
  } catch {
    return null;
  }
}

// OpenTelemetry setup complete
