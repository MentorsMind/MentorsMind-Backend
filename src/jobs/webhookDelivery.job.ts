/**
 * Webhook Delivery Worker
 *
 * Processes outbound webhook delivery jobs from the webhook-delivery-queue.
 * Retry scheduling (1 min / 5 min / 30 min) is handled inside WebhookService.executeDelivery.
 */

import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queues/queue.config';
import { WEBHOOK_QUEUE_NAME, WebhookDeliveryJobData } from '../queues/webhook.queue';
import { WebhookService } from '../services/webhook.service';
import { logger } from '../utils/logger';

async function processWebhookDelivery(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { deliveryId, webhookId, url, secret, payload, attemptNumber } = job.data;

  logger.info('Webhook delivery started', {
    jobId: job.id,
    deliveryId,
    webhookId,
    url,
    attempt: attemptNumber,
  });

  await WebhookService.executeDelivery(
    deliveryId,
    webhookId,
    url,
    secret,
    payload,
    attemptNumber,
  );
}

export const webhookDeliveryWorker = new Worker<WebhookDeliveryJobData>(
  WEBHOOK_QUEUE_NAME,
  processWebhookDelivery,
  {
    connection: redisConnection,
    concurrency: 10,
  },
);

webhookDeliveryWorker.on('completed', (job) => {
  logger.info('Webhook delivery job completed', { jobId: job.id, deliveryId: job.data.deliveryId });
});

webhookDeliveryWorker.on('failed', (job, err) => {
  logger.error('Webhook delivery job failed unexpectedly', {
    jobId: job?.id,
    deliveryId: job?.data?.deliveryId,
    error: err.message,
  });
});

webhookDeliveryWorker.on('error', (err) => {
  logger.error('Webhook delivery worker error', { error: err.message });
});
