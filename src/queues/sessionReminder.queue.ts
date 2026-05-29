import { Queue } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config';

export interface SessionReminderJobData {
    jobType: 'session-reminder';
}

export const sessionReminderQueue = new Queue<SessionReminderJobData>(
    QUEUE_NAMES.SESSION_REMINDER,
    { connection: redisConnection, defaultJobOptions },
);
