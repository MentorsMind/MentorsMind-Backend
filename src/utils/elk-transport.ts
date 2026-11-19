/**
 * ELK Stack Log Transport — Issue #740
 *
 * Implements a log aggregation pipeline that forwards structured JSON log
 * entries from the Pino logger to Elasticsearch (the "E" in ELK) in real-time.
 *
 * Architecture:
 *   Pino logger (stdout JSON)
 *     └─ ELKTransport (this file) ─── batch/retry ──► Elasticsearch HTTP API
 *
 * Design decisions:
 *  - Writes are batched (configurable interval + max-batch size) to avoid
 *    one HTTP request per log line at high throughput.
 *  - Failed batches are retried with exponential back-off up to a max of 3
 *    attempts before being dropped (with a `warn` log of the drop count).
 *  - The transport is disabled when ELASTICSEARCH_ENABLED=false or when
 *    NODE_ENV=test, so tests are never affected by ES connectivity.
 *  - Index name follows the ILM rolling alias pattern:
 *      mentorminds-logs-YYYY.MM.DD
 *  - Documents are enriched with a `@timestamp` field (ISO-8601) and a
 *    `service.name` field so Kibana Discover shows them correctly.
 *  - The Elasticsearch `_bulk` API is used for efficient batch ingestion.
 */

import { env } from "../config/env";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogDocument {
  "@timestamp": string;
  "log.level": string;
  message: string;
  "service.name": string;
  "service.version"?: string;
  "service.environment": string;
  "host.name": string;
  "trace.id"?: string;
  "span.id"?: string;
  requestId?: string;
  correlationId?: string;
  userId?: string;
  [key: string]: unknown;
}

interface BulkAction {
  index: { _index: string };
}

// ---------------------------------------------------------------------------
// Index naming
// ---------------------------------------------------------------------------

function getIndexName(): string {
  const prefix = env.ELASTICSEARCH_INDEX_PREFIX || "mentorminds";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  return `${prefix}-logs-${date}`;
}

// ---------------------------------------------------------------------------
// HTTP helper (no external deps)
// ---------------------------------------------------------------------------

async function httpBulk(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-ndjson", ...headers },
      body,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// ELKTransport class
// ---------------------------------------------------------------------------

export interface ELKTransportOptions {
  /** Elasticsearch base URL (defaults to env.ELASTICSEARCH_URL) */
  url?: string;
  /** Index prefix (defaults to env.ELASTICSEARCH_INDEX_PREFIX) */
  indexPrefix?: string;
  /** Max log entries to buffer before flushing (default: 100) */
  batchSize?: number;
  /** How often to auto-flush in ms (default: 5000) */
  flushIntervalMs?: number;
  /** Max retry attempts on failure (default: 3) */
  maxRetries?: number;
  /** Base back-off delay in ms for retries (default: 500) */
  retryBaseDelayMs?: number;
}

export class ELKTransport {
  private readonly url: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly authHeaders: Record<string, string>;

  private buffer: LogDocument[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;
  private droppedCount = 0;

  constructor(options: ELKTransportOptions = {}) {
    this.url = (options.url ?? env.ELASTICSEARCH_URL).replace(/\/$/, "");
    this.batchSize = options.batchSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? 5_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;

    // Build auth headers
    this.authHeaders = {};
    if (env.ELASTICSEARCH_API_KEY) {
      this.authHeaders["Authorization"] = `ApiKey ${env.ELASTICSEARCH_API_KEY}`;
    } else if (env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD) {
      const creds = Buffer.from(
        `${env.ELASTICSEARCH_USERNAME}:${env.ELASTICSEARCH_PASSWORD}`,
      ).toString("base64");
      this.authHeaders["Authorization"] = `Basic ${creds}`;
    }
  }

  /**
   * Start the periodic flush timer.
   * Call once during application bootstrap.
   */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {}); // errors handled inside flush()
    }, this.flushIntervalMs);

    // Allow process to exit even if timer is active
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  /**
   * Stop the periodic flush timer and flush remaining buffer.
   * Call during graceful shutdown.
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Enqueue a log document. Triggers an immediate flush when buffer is full.
   */
  write(doc: LogDocument): void {
    this.buffer.push(doc);
    if (this.buffer.length >= this.batchSize) {
      this.flush().catch(() => {});
    }
  }

  /**
   * Flush buffered log documents to Elasticsearch via the _bulk API.
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) return;
    this.isFlushing = true;

    const batch = this.buffer.splice(0, this.batchSize);
    const indexName = getIndexName();

    // Build ndjson bulk body
    const lines: string[] = [];
    for (const doc of batch) {
      const action: BulkAction = { index: { _index: indexName } };
      lines.push(JSON.stringify(action));
      lines.push(JSON.stringify(doc));
    }
    const body = lines.join("\n") + "\n";

    let attempt = 0;
    let success = false;

    while (attempt < this.maxRetries && !success) {
      try {
        const result = await httpBulk(
          `${this.url}/_bulk`,
          body,
          this.authHeaders,
        );
        if (result.ok) {
          success = true;
        } else if (result.status >= 400 && result.status < 500) {
          // Client error — do not retry
          logger.warn("ELK bulk rejected (client error)", {
            status: result.status,
            dropped: batch.length,
          });
          this.droppedCount += batch.length;
          break;
        } else {
          throw new Error(`ES bulk returned ${result.status}`);
        }
      } catch (err) {
        attempt++;
        if (attempt < this.maxRetries) {
          const delay = this.retryBaseDelayMs * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          logger.warn("ELK bulk failed after max retries — dropping batch", {
            dropped: batch.length,
            err: err instanceof Error ? err.message : String(err),
          });
          this.droppedCount += batch.length;
        }
      }
    }

    this.isFlushing = false;
  }

  getStats(): { buffered: number; dropped: number } {
    return { buffered: this.buffer.length, dropped: this.droppedCount };
  }
}

// ---------------------------------------------------------------------------
// Singleton transport instance
// ---------------------------------------------------------------------------

let _transport: ELKTransport | null = null;
let _flushHandlersRegistered = false;

function registerProcessFlushHandlers(transport: ELKTransport): void {
  if (_flushHandlersRegistered) return;
  _flushHandlersRegistered = true;

  // Flush buffered entries on graceful shutdown so they are not lost on SIGTERM.
  const gracefulFlush = () => {
    transport.stop().catch(() => {}).finally(() => {
      // Do not call process.exit() — let the caller's shutdown sequence handle it.
    });
  };

  process.once("SIGTERM", gracefulFlush);
  process.once("SIGINT", gracefulFlush);

  // Best-effort flush before the process terminates on an unhandled error.
  process.once("uncaughtException", (err) => {
    transport.stop().catch(() => {}).finally(() => {
      // Re-throw so Node.js still exits with a non-zero code and the original
      // error is printed.  Any other uncaughtException handler registered
      // before this one has already been called.
      throw err;
    });
  });
}

export function getELKTransport(): ELKTransport | null {
  const enabled =
    env.ELASTICSEARCH_ENABLED === "true" &&
    env.NODE_ENV !== "test" &&
    !!env.ELASTICSEARCH_URL;

  if (!enabled) return null;

  if (!_transport) {
    _transport = new ELKTransport();
    _transport.start();
    registerProcessFlushHandlers(_transport);
  }
  return _transport;
}

/**
 * Convert a raw Pino log object into an ECS (Elastic Common Schema)-compatible
 * Elasticsearch document. This ensures Kibana understands the fields natively.
 *
 * ECS reference: https://www.elastic.co/guide/en/ecs/current/index.html
 */
export function toECSDocument(pinoLog: Record<string, unknown>): LogDocument {
  const level = typeof pinoLog.level === "number"
    ? pinoLevelToLabel(pinoLog.level as number)
    : (pinoLog.level as string) ?? "info";

  return {
    "@timestamp": (pinoLog.time as string) ?? new Date().toISOString(),
    "log.level": level,
    message: (pinoLog.msg as string) ?? "",
    "service.name": (pinoLog.service as string) ?? "mentorminds-backend",
    "service.environment": env.NODE_ENV,
    "host.name": (pinoLog.instanceId as string) ?? "",
    "trace.id": pinoLog.traceId as string | undefined,
    "span.id": pinoLog.spanId as string | undefined,
    requestId: pinoLog.requestId as string | undefined,
    correlationId: pinoLog.correlationId as string | undefined,
    userId: pinoLog.userId as string | undefined,
    // Forward remaining fields
    ...Object.fromEntries(
      Object.entries(pinoLog).filter(
        ([k]) =>
          ![
            "time",
            "level",
            "msg",
            "pid",
            "hostname",
            "service",
            "instanceId",
          ].includes(k),
      ),
    ),
  };
}

function pinoLevelToLabel(level: number): string {
  if (level >= 60) return "fatal";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  if (level >= 20) return "debug";
  return "trace";
}
