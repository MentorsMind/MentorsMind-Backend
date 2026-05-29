import { Queue } from 'bullmq';
import { redisConnection, QUEUE_NAMES } from './queue.config';

export interface WebhookDeliveryJobData {
  deliveryId: string;
  webhookId: string;
  url: string;
  secret: string;
  eventType: string;
  payload: Record<string, unknown>;
  attemptNumber: number;
}

// Register the queue name in the central registry at runtime
// (QUEUE_NAMES is a const object; we extend it via module augmentation below)
export const WEBHOOK_QUEUE_NAME = 'webhook-delivery-queue';

export const webhookQueue = new Queue<WebhookDeliveryJobData>(WEBHOOK_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,          // We manage retries manually with custom delays
    removeOnComplete: { count: 200 },
    removeOnFail: false,  // Keep for dead-letter inspection
  },
});
