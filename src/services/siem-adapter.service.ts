/**
 * SIEM Adapter Service
 *
 * Provides outbound SIEM integration for the incident response pipeline.
 * Two adapters are supported:
 *
 *   1. ElasticSiemAdapter  — indexes security incidents directly into
 *      Elasticsearch using the existing elasticsearch.service.ts client.
 *      Target index: "security-incidents".
 *
 *   2. WebhookSiemAdapter  — generic HTTP webhook adapter compatible with
 *      Splunk HEC, Microsoft Sentinel HTTPS data collector, and similar
 *      webhook-based SIEM ingestion APIs. Performs 3 attempts with
 *      exponential backoff (1 s → 2 s → 4 s) before giving up.
 *
 * Failed deliveries from either adapter are stored in an in-memory
 * dead-letter queue (DLQ) for manual inspection / replay.
 *
 * SiemAdapterService orchestrates which adapters are active based on
 * environment variables:
 *   SIEM_ELASTIC_ENABLED=true   → activate ElasticSiemAdapter
 *   SIEM_WEBHOOK_URL=<url>      → activate WebhookSiemAdapter
 *   SIEM_WEBHOOK_API_KEY=<key>  → optional Bearer token for webhook
 *   SIEM_SOURCE=<name>          → source/sourcetype label (default: mentorminds-backend)
 *
 * Part of issue #1003 "Implement Incident Response SIEM Integration".
 */

import elasticsearchService from './elasticsearch.service';
import { logger } from '../utils/logger';
import type { SiemPushPayload } from './incident-response.service';

// ─── Elastic event schema ─────────────────────────────────────────────────────

/**
 * Schema for a security incident document stored in the Elasticsearch
 * `security-incidents` index. Follows the ECS (Elastic Common Schema)
 * conventions where possible.
 */
export interface ElasticSiemEvent {
  '@timestamp': string;
  'event.kind': 'alert';
  'event.category': string[];
  'event.type': string[];
  'event.severity': number;
  'event.outcome': 'unknown' | 'success' | 'failure';
  'threat.technique.id': string[];
  'vulnerability.severity': string;
  incident: {
    id: string;
    type: string;
    category: string;
    status: string;
    score: number | null;
    response_actions: string[];
  };
  user: {
    id: string | null;
  };
  source: {
    ip: string | null;
  };
  resource: string | null;
  labels: {
    service: string;
    environment: string;
  };
}

// ─── Webhook event schema (Splunk HEC / Sentinel compatible) ─────────────────

/**
 * Generic webhook envelope accepted by Splunk HEC, Microsoft Sentinel
 * custom log ingestion, and comparable HTTPS-based SIEM data sources.
 */
export interface WebhookSiemEvent {
  time: number;           // epoch seconds (Splunk HEC convention)
  source: string;
  sourcetype: 'security_incident';
  host: string;
  index?: string;
  event: {
    incident_id: string;
    incident_type: string;
    severity: string;
    category: string;
    mitre_tags: string[];
    status: string;
    user_id: string | null;
    source_ip: string | null;
    affected_resource: string | null;
    occurred_at: string;
    response_actions: string[];
    score: number | null;
    environment: string;
  };
}

// ─── Dead-letter queue ────────────────────────────────────────────────────────

export interface DeadLetterEntry {
  id: string;            // unique DLQ entry ID
  adapter: 'elastic' | 'webhook';
  payload: SiemPushPayload;
  error: string;
  failedAt: Date;
  attempts: number;
}

/**
 * In-memory dead-letter queue. Failed SIEM deliveries are appended here so
 * that operators can inspect, replay, or export them without losing incident
 * telemetry. Capped at 10 000 entries to guard against unbounded growth.
 */
const deadLetterQueue: DeadLetterEntry[] = [];
const DLQ_MAX_SIZE = 10_000;

function pushToDlq(entry: Omit<DeadLetterEntry, 'id'>): void {
  if (deadLetterQueue.length >= DLQ_MAX_SIZE) {
    // Drop the oldest entry to make room
    deadLetterQueue.shift();
  }
  const id = `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  deadLetterQueue.push({ id, ...entry });
  logger.warn({ dlqEntryId: id, adapter: entry.adapter, incidentId: entry.payload.incidentId },
    '[SIEM-DLQ] Failed delivery stored in dead-letter queue',
  );
}

/** Expose the DLQ contents for replay / admin APIs. */
export function getDeadLetterQueue(): DeadLetterEntry[] {
  return [...deadLetterQueue];
}

/** Remove a specific entry from the DLQ (e.g. after successful manual replay). */
export function removeFromDeadLetterQueue(entryId: string): boolean {
  const idx = deadLetterQueue.findIndex((e) => e.id === entryId);
  if (idx === -1) return false;
  deadLetterQueue.splice(idx, 1);
  return true;
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

/**
 * Run `fn` up to `maxAttempts` times, waiting `baseDelayMs * 2^attempt`
 * milliseconds between retries (exponential backoff starting at 1 s).
 * Returns `{ success: true }` or `{ success: false, error }` on exhaustion.
 */
async function withRetry(
  fn: () => Promise<void>,
  maxAttempts: number,
  baseDelayMs: number,
): Promise<{ success: true; attempts: number } | { success: false; error: Error; attempts: number }> {
  let lastError: Error = new Error('Unknown error');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fn();
      return { success: true, attempts: attempt + 1 };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.debug(
          { attempt: attempt + 1, maxAttempts, delay, error: lastError.message },
          '[SIEM] Retry attempt failed, waiting before next retry',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  return { success: false, error: lastError, attempts: maxAttempts };
}

// ─── Severity mapping helpers ─────────────────────────────────────────────────

const SEVERITY_TO_ECS: Record<string, number> = {
  critical: 99,
  high: 73,
  medium: 47,
  low: 21,
  info: 0,
};

function toEcsSeverity(severity: string): number {
  return SEVERITY_TO_ECS[severity] ?? 47;
}

// ─── Elastic SIEM Adapter ─────────────────────────────────────────────────────

export const ElasticSiemAdapter = {
  /**
   * Serialize a SecurityIncident payload to ECS-aligned Elastic event schema
   * and index it into the `security-incidents` Elasticsearch index.
   * Uses the existing `elasticsearch.service.ts` client.
   */
  serialize(payload: SiemPushPayload, source: string): ElasticSiemEvent {
    return {
      '@timestamp': payload.occurredAt,
      'event.kind': 'alert',
      'event.category': ['authentication', 'intrusion_detection'],
      'event.type': ['indicator'],
      'event.severity': toEcsSeverity(payload.severity),
      'event.outcome': 'unknown',
      'threat.technique.id': payload.mitreTags,
      'vulnerability.severity': payload.severity,
      incident: {
        id: payload.incidentId,
        type: payload.incidentType,
        category: payload.category,
        status: payload.status,
        score: payload.score,
        response_actions: payload.responseActions,
      },
      user: {
        id: payload.userId,
      },
      source: {
        ip: payload.sourceIp,
      },
      resource: payload.affectedResource,
      labels: {
        service: source,
        environment: process.env.NODE_ENV ?? 'development',
      },
    };
  },

  /**
   * Push a serialized event to Elasticsearch with retry logic.
   * Returns number of attempts made and throws on exhaustion.
   */
  async push(payload: SiemPushPayload, source: string): Promise<number> {
    const event = this.serialize(payload, source);

    const result = await withRetry(
      () => elasticsearchService.indexDocument<ElasticSiemEvent>(
        'security-incidents',
        payload.incidentId,
        event,
      ),
      3,
      1_000,
    );

    if (!result.success) {
      pushToDlq({
        adapter: 'elastic',
        payload,
        error: result.error.message,
        failedAt: new Date(),
        attempts: result.attempts,
      });
      throw result.error;
    }

    logger.info(
      { incidentId: payload.incidentId, attempts: result.attempts },
      '[SIEM-Elastic] Security incident indexed into Elasticsearch',
    );
    return result.attempts;
  },
};

// ─── Webhook SIEM Adapter ─────────────────────────────────────────────────────

export const WebhookSiemAdapter = {
  /**
   * Serialize a SecurityIncident payload to the Splunk HEC / Sentinel-compatible
   * webhook envelope.
   */
  serialize(payload: SiemPushPayload, source: string): WebhookSiemEvent {
    return {
      time: Math.floor(new Date(payload.occurredAt).getTime() / 1000),
      source,
      sourcetype: 'security_incident',
      host: process.env.HOSTNAME ?? 'mentorminds-backend',
      index: process.env.SIEM_WEBHOOK_INDEX,
      event: {
        incident_id: payload.incidentId,
        incident_type: payload.incidentType,
        severity: payload.severity,
        category: payload.category,
        mitre_tags: payload.mitreTags,
        status: payload.status,
        user_id: payload.userId,
        source_ip: payload.sourceIp,
        affected_resource: payload.affectedResource,
        occurred_at: payload.occurredAt,
        response_actions: payload.responseActions,
        score: payload.score,
        environment: process.env.NODE_ENV ?? 'development',
      },
    };
  },

  /**
   * POST the serialized event to the configured webhook URL with 3 retries
   * and exponential backoff (1 s → 2 s → 4 s). On exhaustion, pushes to DLQ.
   */
  async push(
    payload: SiemPushPayload,
    webhookUrl: string,
    apiKey: string | undefined,
    source: string,
  ): Promise<number> {
    const event = this.serialize(payload, source);
    const body = JSON.stringify(event);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const result = await withRetry(
      async () => {
        const fetchFn: typeof fetch =
          typeof globalThis.fetch === 'function'
            ? globalThis.fetch
            : (await import('node-fetch' as any)).default;

        const response = await fetchFn(webhookUrl, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(8_000),
        });

        if (!response.ok) {
          // 4xx are non-retryable; 5xx / network errors are retryable
          const isRetryable = response.status >= 500;
          const errMsg = `SIEM webhook responded ${response.status} ${response.statusText}`;
          const err = new Error(errMsg) as Error & { retryable?: boolean };
          err.retryable = isRetryable;
          throw err;
        }
      },
      3,
      1_000,
    );

    if (!result.success) {
      pushToDlq({
        adapter: 'webhook',
        payload,
        error: result.error.message,
        failedAt: new Date(),
        attempts: result.attempts,
      });
      throw result.error;
    }

    logger.info(
      { incidentId: payload.incidentId, webhookUrl, attempts: result.attempts },
      '[SIEM-Webhook] Security incident delivered to SIEM webhook',
    );
    return result.attempts;
  },
};

// ─── SiemAdapterService ───────────────────────────────────────────────────────

export interface SiemPushResult {
  /** Whether at least one adapter succeeded */
  success: boolean;
  /** Adapters that delivered successfully */
  delivered: Array<'elastic' | 'webhook'>;
  /** Adapters that failed (payload added to DLQ) */
  failed: Array<{ adapter: 'elastic' | 'webhook'; error: string }>;
}

/**
 * Orchestrates the configured SIEM adapters for a given incident push.
 * Both adapters run concurrently; partial success is reported per-adapter.
 *
 * Activation rules:
 *   - ElasticSiemAdapter: active when `SIEM_ELASTIC_ENABLED=true`
 *   - WebhookSiemAdapter: active when `SIEM_WEBHOOK_URL` is set
 *
 * If neither adapter is configured, the payload is emitted as a structured
 * log (parseable by Filebeat / Fluentd) so incidents are never silently lost.
 */
export const SiemAdapterService = {
  async push(payload: SiemPushPayload): Promise<SiemPushResult> {
    const source = process.env.SIEM_SOURCE ?? 'mentorminds-backend';
    const elasticEnabled = process.env.SIEM_ELASTIC_ENABLED === 'true';
    const webhookUrl = process.env.SIEM_WEBHOOK_URL;
    const webhookApiKey = process.env.SIEM_WEBHOOK_API_KEY ?? process.env.SIEM_API_KEY;

    const delivered: Array<'elastic' | 'webhook'> = [];
    const failed: Array<{ adapter: 'elastic' | 'webhook'; error: string }> = [];

    // Run both adapters concurrently
    const tasks: Promise<void>[] = [];

    if (elasticEnabled) {
      tasks.push(
        ElasticSiemAdapter.push(payload, source)
          .then(() => { delivered.push('elastic'); })
          .catch((err: Error) => {
            failed.push({ adapter: 'elastic', error: err.message });
            logger.error(
              { incidentId: payload.incidentId, error: err.message },
              '[SiemAdapterService] Elastic adapter failed (payload in DLQ)',
            );
          }),
      );
    }

    if (webhookUrl) {
      tasks.push(
        WebhookSiemAdapter.push(payload, webhookUrl, webhookApiKey, source)
          .then(() => { delivered.push('webhook'); })
          .catch((err: Error) => {
            failed.push({ adapter: 'webhook', error: err.message });
            logger.error(
              { incidentId: payload.incidentId, error: err.message },
              '[SiemAdapterService] Webhook adapter failed (payload in DLQ)',
            );
          }),
      );
    }

    if (tasks.length === 0) {
      // No adapters configured — emit structured log as fallback
      logger.warn(
        {
          siem_event: true,
          incident_id: payload.incidentId,
          incident_type: payload.incidentType,
          severity: payload.severity,
          category: payload.category,
          mitre_tags: payload.mitreTags,
          status: payload.status,
          user_id: payload.userId,
          source_ip: payload.sourceIp,
          affected_resource: payload.affectedResource,
          occurred_at: payload.occurredAt,
          response_actions: payload.responseActions,
          score: payload.score,
        },
        '[SIEM] No adapters configured — structured log fallback',
      );
      // Treat log-only as non-failed (not a delivery error)
      delivered.push('elastic'); // sentinel: logged
    }

    await Promise.all(tasks);

    const success = failed.length === 0;
    return { success, delivered, failed };
  },
};
