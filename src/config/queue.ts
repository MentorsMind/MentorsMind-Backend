import config from "./index";
import { ConnectionOptions, DefaultJobOptions } from "bullmq";

const redisUrl = config.redis.url || "redis://localhost:6379";
const url = new URL(redisUrl);

/** Shared Redis connection options for all BullMQ queues/workers. */
export const redisConnection: ConnectionOptions = {
  host: url.hostname,
  port: parseInt(url.port, 10) || 6379,
  password: url.password || undefined,
  // Required by BullMQ — disables ioredis per-request retry for blocking ops
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  // Enable TLS for rediss:// URLs
  ...(url.protocol === "rediss:" && { tls: {} }),
};

/**
 * Default job options: 5 attempts, exponential backoff starting at 2 seconds.
 * Sequence: 2s → 4s → 8s → 16s → 32s.
 * Failed jobs are retained for dead-letter inspection.
 *
 * Queue-level overrides:
 *   - paymentPollQueue: attempts=20, fixed delay=30s (Stellar polling)
 */
export const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 2000, // 2s → 4s → 8s → 16s → 32s
  },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
};

/** Centralised queue name registry — single source of truth. */
export const QUEUE_NAMES = {
  EMAIL: "email-queue",
  STELLAR_TX: "stellar-tx-queue",
  ESCROW_CHECK: "escrow-check-queue",
  ESCROW_RELEASE: "escrow-release-queue",
  NOTIFICATIONS: "notification-queue",
  PAYMENT_POLL: "payment-poll-queue",
  REPORT: "report-queue",
  EXPORT: "export-queue",
  SESSION_REMINDER: "session-reminder-queue",
  SESSION_NO_SHOW: "session-no-show-queue",
  AUDIT_LOG: "audit-log-queue",
  NOTIFICATION_CLEANUP: "notification-cleanup-queue",
  MAINTENANCE: "maintenance-queue",
  TRANSCRIPTION: "transcription-queue",
  BULK: "bulk-queue",
  DOMAIN_EVENTS: "domain-events-queue",
  RECORDING_CLEANUP: "recording-cleanup-queue",
  ANALYTICS_REFRESH: "analytics-refresh-queue",
  QUALITY_SCORE: "quality-score-queue",
  CDN_INVALIDATION: "cdn-invalidation-queue",
  INSIGHT_GENERATION: "insight-generation-queue",
  SECURITY_ANALYSIS: "security-analysis-queue",
  INCIDENT_RESPONSE: "incident-response-queue",
  TAX_REPORTING: "tax-reporting-queue",
  ONBOARDING_NUDGE: "onboarding-nudge-queue",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const QUEUE_PRIORITIES = {
  CRITICAL: 1,
  HIGH: 5,
  NORMAL: 10,
  BULK: 100,
} as const;

export enum JobType {
  EMAIL = "email",
  PAYMENT = "payment",
  NOTIFICATION = "notification",
  REPORT = "report",
  ANALYTICS = "analytics",
  BLOCKCHAIN = "blockchain",
}

export interface JobBackoffConfig {
  type: 'fixed' | 'exponential';
  delay: number;
}

export interface JobConfig {
  name: string;
  priority?: number;
  attempts?: number;
  backoff?: JobBackoffConfig;
  timeout?: number;
  removeOnComplete?: boolean | { count: number };
  removeOnFail?: boolean | { count: number };
}

export const JOB_RATE_LIMITS = {
  EMAIL: { max: 60, duration: 60_000 },
  NOTIFICATIONS: { max: 120, duration: 60_000 },
} as const;

export type JobRateLimit = (typeof JOB_RATE_LIMITS)[keyof typeof JOB_RATE_LIMITS];

/** Worker concurrency per queue. */
export const CONCURRENCY = {
  EMAIL: 10,
  STELLAR_TX: 5,
  ESCROW_CHECK: 1,
  ESCROW_RELEASE: 3,
  NOTIFICATIONS: 10,
  PAYMENT_POLL: 5,
  REPORT: 2,
  SESSION_REMINDER: 1,
  SESSION_NO_SHOW: 3,
  MAINTENANCE: 1,
  TRANSCRIPTION: 5,
  QUALITY_SCORE: 1,
  CDN_INVALIDATION: 5,
  /** Parallel per-user insight jobs — supports ~1k users within 10 minutes */
  INSIGHT_GENERATION: 20,
  SECURITY_ANALYSIS: 5,
  INCIDENT_RESPONSE: 3,
  ONBOARDING_NUDGE: 2,
} as const;
