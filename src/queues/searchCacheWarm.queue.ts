/**
 * Search Cache Warming Queue
 *
 * BullMQ queue for search cache warming jobs.
 */

import { Queue } from 'bullmq';
import { redisConnection } from './queue.config';

export const searchCacheWarmQueue = new Queue('searchCacheWarm', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
  },
});
