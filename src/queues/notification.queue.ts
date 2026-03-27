import { Queue } from 'bullmq';
import { redisConnection, defaultJobOptions } from './queue.config';

/** BullMQ queue for notification-related jobs (reserved for future use). */
export const notificationQueue = new Queue('notification-queue', {
  connection: redisConnection,
  defaultJobOptions,
});
