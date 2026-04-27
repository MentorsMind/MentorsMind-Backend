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
};

/**
 * Default job options: 3 attempts, exponential backoff starting at 1 second.
 * Failed jobs are retained for dead-letter inspection.
 */
export const defaultJobOptions: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000, // 1s → 2s → 4s
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
  AUDIT_LOG: "audit-log-queue",
  NOTIFICATION_CLEANUP: "notification-cleanup-queue",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

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
} as const;
