import config from '../config';
import { ConnectionOptions, DefaultJobOptions } from 'bullmq';

// ─── Redis connection for BullMQ ──────────────────────────────────────────────
//
// All queues and workers share the same Redis instance so that jobs are visible
// across every API replica.  Each Queue / Worker / QueueScheduler creates its
// own ioredis connection from these options internally — do NOT pass the shared
// application `redis` client here because BullMQ uses blocking commands that
// require a dedicated connection.
//
// Critical settings for BullMQ:
//   maxRetriesPerRequest: null  — required; BullMQ uses BLPOP / BRPOP which
//                                 are long-running and must not be retried by
//                                 ioredis after a transient error.
//   enableOfflineQueue: false   — fail fast when Redis is unreachable rather
//                                 than buffering commands indefinitely.

const redisUrl = config.redis.url || 'redis://localhost:6379';
const url = new URL(redisUrl);

/** Shared Redis connection options for all BullMQ queues and workers. */
export const redisConnection: ConnectionOptions = {
  host: url.hostname,
  port: parseInt(url.port, 10) || 6379,
  ...(url.password && { password: decodeURIComponent(url.password) }),
  // TLS: enable automatically for rediss:// URLs (e.g. Upstash, ElastiCache TLS)
  ...(url.protocol === 'rediss:' && { tls: {} }),
  // Required by BullMQ — disables ioredis per-request retry for blocking ops
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
};

/** Default job options with exponential backoff retry */
export const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000, // 2s, 4s, 8s, 16s, 32s
  },
  removeOnComplete: { count: 100 },
  removeOnFail: false, // keep failed jobs for dead-letter inspection
};

export const QUEUE_NAMES = {
  EMAIL: 'email-queue',
  PAYMENT_POLL: 'payment-poll-queue',
  ESCROW_RELEASE: 'escrow-release-queue',
  REPORT: 'report-queue',
  EXPORT: 'export-queue',
  SESSION_REMINDER: 'session-reminder-queue',
} as const;

export const CONCURRENCY = {
  EMAIL: 10,
  PAYMENT_POLL: 5,
  ESCROW_RELEASE: 3,
  REPORT: 2,
  SESSION_REMINDER: 1,
} as const;
