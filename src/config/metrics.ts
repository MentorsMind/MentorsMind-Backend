/**
 * metrics.ts
 *
 * Centralised Prometheus metrics registry for MentorsMind.
 *
 * All prom-client instruments are defined here and exported as singletons.
 * Consumers (middleware, services, workers) import individual counters /
 * histograms / gauges rather than registering their own — this prevents
 * duplicate-registration errors when modules are re-required in tests.
 *
 * Metrics exposed:
 *
 *   HTTP
 *     http_requests_total              counter   method, path, status_code
 *     http_request_duration_seconds    histogram method, path, status_code
 *
 *   WebSocket
 *     active_websocket_connections     gauge     (no labels)
 *
 *   Database
 *     db_query_duration_seconds        histogram operation, table
 *
 *   Redis
 *     redis_call_duration_seconds      histogram command
 *
 *   Queue / BullMQ
 *     queue_job_duration_seconds       histogram queue_name, job_name, status
 *     queue_jobs_total                 counter   queue_name, job_name, status
 *
 *   Stellar
 *     stellar_api_call_duration_seconds histogram  operation, network
 *     stellar_api_calls_total          counter    operation, network, status
 *
 *   Notifications
 *     notification_delivery_attempts_total counter channel, status
 *
 *   Webhooks
 *     webhook_circuit_breaker_state    gauge      url_hash
 *
 *   API Versioning
 *     deprecated_api_calls_total       counter    version
 * Default Node.js metrics (GC, heap, event loop lag) are collected
 * automatically via `collectDefaultMetrics()`.
 */

import * as promClient from "prom-client";
const { Counter, Gauge, Histogram, Registry } = promClient;

// ─── Registry ──────────────────────────────────────────────────────────[...]

/**
 * A dedicated registry keeps our metrics isolated from any third-party library
 * that might also use prom-client's default global register.
 */
export const metricsRegistry = new Registry();

// Attach default Node.js / process metrics to our registry
promClient.collectDefaultMetrics({
  register: metricsRegistry,
  labels: { app: "mentorminds" },
});

// ─── HTTP ───────────────────────────────────────────────────────────…[...]

export const httpRequestsTotal = new Counter<string>({
  name: "http_requests_total",
  help: "Total number of HTTP requests, partitioned by method, path, and status code",
  labelNames: ["method", "path", "status_code"],
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new Histogram<string>({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path", "status_code"],
  // Buckets: 5 ms → 10 s — covers fast API responses and slow Stellar calls
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// ─── WebSocket ─────────────────────────────────────────────────────────…[...]

export const activeWebsocketConnections = new Gauge<string>({
  name: "active_websocket_connections",
  help: "Number of currently open WebSocket connections",
  registers: [metricsRegistry],
});

// ─── Database ──────────────────────────────────────────────────────────[...]

export const dbQueryDurationSeconds = new Histogram<string>({
  name: "db_query_duration_seconds",
  help: "PostgreSQL query duration in seconds",
  labelNames: ["operation", "table"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});

export const dbQueryDurationMs = dbQueryDurationSeconds;

export const dbPoolTotalConnections = new Gauge<string>({
  name: "db_pool_total_connections",
  help: "Total connections in the PostgreSQL pool",
  registers: [metricsRegistry],
});

export const dbPoolIdleConnections = new Gauge<string>({
  name: "db_pool_idle_connections",
  help: "Idle connections in the PostgreSQL pool",
  registers: [metricsRegistry],
});

export const dbPoolWaitingClients = new Gauge<string>({
  name: "db_pool_waiting_clients",
  help: "Clients waiting for a PostgreSQL pool connection",
  registers: [metricsRegistry],
});

export const dbPoolUtilizationPercent = new Gauge<string>({
  name: "db_pool_utilization_percent",
  help: "PostgreSQL pool utilization as a percentage of max connections",
  registers: [metricsRegistry],
});

export const dbPoolExhaustionAlertsTotal = new Counter<string>({
  name: "db_pool_exhaustion_alerts_total",
  help: "Number of times the database pool crossed the exhaustion threshold",
  registers: [metricsRegistry],
});

export const dbCircuitBreakerOpenTotal = new Counter<string>({
  name: "db_circuit_breaker_open_total",
  help: "Number of times the database circuit breaker was opened",
  registers: [metricsRegistry],
});

export const dbTableSizeBytes = new Gauge<string>({
  name: "db_table_size_bytes",
  help: "Current total relation size in bytes for each tracked table",
  labelNames: ["table_name"],
  registers: [metricsRegistry],
});

// ─── Redis ──────────────────────────────────────────────────────────…[...]

export const redisCallDurationSeconds = new Histogram<string>({
  name: "redis_call_duration_seconds",
  help: "Redis command duration in seconds",
  labelNames: ["command"],
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [metricsRegistry],
});

// ─── Chatbot ──────────────────────────────────────────────────────────[...]

export const chatbotMessagesTotal = new Counter<string>({
  name: "chatbot_messages_total",
  help: "Total chatbot messages, partitioned by intent and escalation status",
  labelNames: ["intent", "escalated"],
  registers: [metricsRegistry],
});

// ─── Queue / BullMQ ───────────────────────────────────────────────────────…[...]

export const queueJobDurationSeconds = new Histogram<string>({
  name: "queue_job_duration_seconds",
  help: "BullMQ job processing duration in seconds",
  labelNames: ["queue_name", "job_name", "status"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

export const queueJobsTotal = new Counter<string>({
  name: "queue_jobs_total",
  help: "Total BullMQ jobs processed, partitioned by queue, job name, and final status",
  labelNames: ["queue_name", "job_name", "status"],
  registers: [metricsRegistry],
});

// ─── Stellar ──────────────────────────────────────────────────────────[...]

export const stellarApiCallDurationSeconds = new Histogram<string>({
  name: "stellar_api_call_duration_seconds",
  help: "Stellar Horizon API call duration in seconds",
  labelNames: ["operation", "network"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const stellarApiCallsTotal = new Counter<string>({
  name: "stellar_api_calls_total",
  help: "Total Stellar Horizon API calls, partitioned by operation, network, and status",
  labelNames: ["operation", "network", "status"],
  registers: [metricsRegistry],
});

export const escrowSyncMismatchesTotal = new Counter<string>({
  name: "escrow_sync_mismatches_total",
  help: "Total number of Soroban escrow state mismatches corrected by the check worker",
  labelNames: ["type"],
  registers: [metricsRegistry],
});

// ─── Mentor Quality Scoring ───────────────────────────────────────────────────

export const mentorQualityScoreGauge = new Gauge<string>({
  name: "mentor_quality_score",
  help: "Latest computed quality score (0-100) per mentor",
  labelNames: ["mentorId"],
  registers: [metricsRegistry],
});

// ─── Feature Flags ────────────────────────────────────────────────────────[...]

export const featureFlagEvaluationsTotal = new Counter<string>({
  name: "feature_flag_evaluations_total",
  help: "Total feature flag evaluations, partitioned by flag key and result",
  labelNames: ["flag", "result"],
  registers: [metricsRegistry],
});

// ─── Rate Limiting ────────────────────────────────────────────────────────[...]

export const rateLimitExceededTotal = new Counter<string>({
  name: "rate_limit_exceeded_total",
  help: "Total number of rate limit exceeded events",
  labelNames: ["tier", "endpoint_category"],
  registers: [metricsRegistry],
});

export const stellarVerificationAttemptsTotal = new Counter<string>({
  name: "stellar_verification_attempts_total",
  help: "Total Stellar transaction verification attempts by outcome",
  labelNames: ["outcome"],
  registers: [metricsRegistry],
});

// ─── Goals ────────────────────────────────────────────────────────────────────

export const goalRemindersSentTotal = new Counter<string>({
  name: "goal_reminders_sent_total",
  help: "Total number of goal deadline reminders sent, partitioned by reminder type",
  labelNames: ["reminder_type"],
  registers: [metricsRegistry],
});

// ─── Notifications ────────────────────────────────────────────────────────[...]

export const notificationDeliveryAttemptsTotal = new Counter<string>({
  name: "notification_delivery_attempts_total",
  help: "Total notification delivery attempts, partitioned by channel and outcome (sent, failed, dead_letter)",
  labelNames: ["channel", "status"],
  registers: [metricsRegistry],
});

export const pushTokenInvalidTotal = new Counter<string>({
  name: "push_token_invalid_total",
  help: "Total invalid push tokens encountered",
  labelNames: ["reason"],
  registers: [metricsRegistry],
});

export const pushNotificationsSentTotal = new Counter<string>({
  name: "push_notifications_sent_total",
  help: "Total push notifications sent",
  labelNames: ["status"],
  registers: [metricsRegistry],
});

// ─── Webhooks ─────────────────────────────────────────────────────────…[...]

export const webhookCircuitBreakerState = new Gauge<string>({
  name: "webhook_circuit_breaker_state",
  help: "Webhook per-endpoint circuit breaker state (0=closed, 1=open, 2=half-open)",
  labelNames: ["url_hash"],
  registers: [metricsRegistry],
});

// ─── Wallet Reconciliation ─────────────────────────────────────────────────

export const walletReconciliationsTotal = new Counter<string>({
  name: "wallet_reconciliations_total",
  help: "Total wallet reconciliation runs, partitioned by outcome (success, no_wallet, error)",
  labelNames: ["status"],
  registers: [metricsRegistry],
});

export const walletDiscrepanciesTotal = new Counter<string>({
  name: "wallet_discrepancies_total",
  help: "Total asset balance discrepancies detected during reconciliation, partitioned by asset type",
  labelNames: ["asset_type"],
  registers: [metricsRegistry],
});
