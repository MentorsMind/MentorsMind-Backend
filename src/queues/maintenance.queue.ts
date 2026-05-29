import { Queue } from 'bullmq';
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from './queue.config';

export const maintenanceQueue = new Queue(QUEUE_NAMES.MAINTENANCE, {
  connection: redisConnection,
  defaultJobOptions,
});
