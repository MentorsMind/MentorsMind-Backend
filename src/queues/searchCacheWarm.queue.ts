/**
 * Search Cache Warming Queue
 *
 * BullMQ queue for search cache warming jobs.
 */

import { Queue } from 'bullmq';
import { redisConfig } from '../config/redis.config';

export const searchCacheWarmQueue = new Queue('searchCacheWarm', {
  connection: redisConfig.connection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
  },
});
