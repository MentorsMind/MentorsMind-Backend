import config from '../config';
import { ConnectionOptions, DefaultJobOptions } from 'bullmq';

const redisUrl = config.redis.url || 'redis://localhost:6379';
const url = new URL(redisUrl);

/** Shared Redis connection options for all BullMQ queues */
export const redisConnection: ConnectionOptions = {
  host: url.hostname,
  port: parseInt(url.port, 10) || 6379,
  password: url.password || undefined,
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
