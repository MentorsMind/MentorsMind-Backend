/**
 * Webhook Delivery Worker
 *
 * Processes outbound webhook delivery jobs from the webhook-delivery-queue.
 * Retry scheduling (1 min / 5 min / 30 min) is handled inside WebhookService.executeDelivery.
 */

import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queues/queue.config';
import { WEBHOOK_QUEUE_NAME, WebhookDeliveryJobData, webhookQueue } from '../queues/webhook.queue';
import { WebhookService } from '../services/webhook.service';
import { WebhookCircuitBreaker } from '../services/webhook-circuit-breaker.service';
import { Logger } from "../utils/logger.utils";

/** How long a delivery is deferred while its endpoint's circuit is open (issue #783). */
const CIRCUIT_OPEN_DEFER_MS = 5 * 60 * 1000;

async function processWebhookDelivery(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { deliveryId, webhookId, url, secret, payload, attemptNumber } = job.data;

  const circuit = await WebhookCircuitBreaker.check(url);
  if (!circuit.allowed) {
    logger.warn('Webhook circuit breaker open — deferring delivery instead of attempting', {
      jobId: job.id,
      deliveryId,
      webhookId,
      urlHash: WebhookCircuitBreaker.hashUrl(url),
      state: circuit.state,
    });

    // Re-queue without consuming a delivery attempt or blocking this worker
    // slot on a known-broken endpoint — this is what keeps a retry storm
    // against one endpoint from delaying delivery to healthy endpoints.
    await webhookQueue.add(
      `circuit-deferred-${deliveryId}-${attemptNumber}`,
      job.data,
      { delay: CIRCUIT_OPEN_DEFER_MS },
    );
    return;
  }

  logger.info('Webhook delivery started', {
    jobId: job.id,
    deliveryId,
    webhookId,
    url,
    attempt: attemptNumber,
    circuitState: circuit.state,
  });

  const result = await WebhookService.executeDelivery(
    deliveryId,
    webhookId,
    url,
    secret,
    payload,
    attemptNumber,
  );

  await WebhookCircuitBreaker.reportOutcome(url, result.success);
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
