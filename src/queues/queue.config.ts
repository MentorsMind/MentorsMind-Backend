/**
 * Queue config — re-exported from src/config/queue.ts (single source of truth).
 * Kept here for backward-compatibility with existing queue/worker imports.
 */
export {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
  CONCURRENCY,
} from "../config/queue";
export type { QueueName } from "../config/queue";
