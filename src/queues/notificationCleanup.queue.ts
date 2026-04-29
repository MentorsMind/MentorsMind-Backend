import { Queue } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config';

export interface NotificationCleanupJobData {
  jobType: 'notification-cleanup';
}

export const notificationCleanupQueue = new Queue<NotificationCleanupJobData>(
  QUEUE_NAMES.NOTIFICATION_CLEANUP,
  { connection: redisConnection, defaultJobOptions },
);
