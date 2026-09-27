/**
 * Webhook delivery retry integration test.
 *
 * Exercises the real webhook delivery worker processor together with
 * WebhookService.executeDelivery. Queue processing is isolated: BullMQ is
 * replaced with an in-memory stub that records every retry job (and its
 * delay), and each recorded retry is fed back into the worker processor
 * manually instead of waiting on the BullMQ scheduler. Outbound HTTP (axios)
 * and the database pool are mocked; the pool mock tracks delivery status and
 * webhook failure state so status transitions can be asserted.
 */

const mockAxiosPost = jest.fn();
const mockQueueAdd = jest.fn();
const mockPoolQuery = jest.fn();

jest.mock('bullmq', () => ({
  Queue: class {
    add(...args: unknown[]) {
      return mockQueueAdd(...args);
    }
    async close() {}
  },
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockAxiosPost(...args) },
}));

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

jest.mock('../../../src/queues/queue.config', () => ({ redisConnection: {} }));

jest.mock('../../../src/services/cache.service', () => ({ CacheService: {} }));

jest.mock('../../../src/services/webhook-circuit-breaker.service', () => ({
  WebhookCircuitBreaker: {
    check: async () => ({ state: 'closed', allowed: true, isProbe: false }),
    reportOutcome: async () => undefined,
    hashUrl: (url: string) => url,
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { Worker } from 'bullmq';
import '../../../src/jobs/webhookDelivery.job';
import { WebhookDeliveryJobData } from '../../../src/queues/webhook.queue';

interface DeliveryJob {
  id: string;
  data: WebhookDeliveryJobData;
}

// The processor the webhook delivery worker registered with BullMQ.
const processWebhookDelivery = (Worker as unknown as jest.Mock).mock.calls[0][1] as (
  job: DeliveryJob,
) => Promise<void>;

const DELIVERY_ID = 'delivery-1';
const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];
const MAX_CONSECUTIVE_FAILURES = 10;

const serverError = Object.assign(new Error('Request failed with status code 500'), {
  response: { status: 500 },
});

let deliveryStatusUpdates: string[];
let deadLetterEntries: number;
let webhookFailureCount: number;
let webhookActive: boolean;

async function fakeQuery(sql: string, params: unknown[] = []) {
  const statusUpdate = /UPDATE webhook_deliveries SET status = '(\w+)'/.exec(sql);
  if (statusUpdate && params[params.length - 1] === DELIVERY_ID) {
    deliveryStatusUpdates.push(statusUpdate[1]);
  } else if (sql.includes('INSERT INTO webhook_dead_letter_queue')) {
    deadLetterEntries += 1;
  } else if (sql.includes('failure_count = failure_count + 1')) {
    webhookFailureCount += 1;
  } else if (sql.includes('SELECT failure_count FROM webhooks')) {
    return { rows: [{ failure_count: webhookFailureCount }], rowCount: 1 };
  } else if (sql.includes('SET is_active = false')) {
    webhookActive = false;
  }
  return { rows: [], rowCount: 1 };
}

function deliveryJob(): DeliveryJob {
  return {
    id: 'job-1',
    data: {
      deliveryId: DELIVERY_ID,
      webhookId: 'webhook-1',
      url: 'https://hooks.example.com/mentorsmind',
      secret: 'whsec_test',
      eventType: 'session.completed',
      payload: { event: 'session.completed', event_type: 'session.completed' },
      attemptNumber: 1,
    },
  };
}

/**
 * Processes the job, then keeps handing each retry the worker scheduled back
 * to the processor until no retry is scheduled. Returns the attempt numbers run.
 */
async function processWithRetries(job: DeliveryJob): Promise<number[]> {
  const attempts: number[] = [];
  let next: DeliveryJob | undefined = job;

  while (next && attempts.length <= MAX_ATTEMPTS) {
    const retriesBefore = mockQueueAdd.mock.calls.length;
    await processWebhookDelivery(next);
    attempts.push(next.data.attemptNumber);

    const retry = mockQueueAdd.mock.calls[retriesBefore];
    next = retry ? { id: retry[0], data: retry[1] } : undefined;
  }

  return attempts;
}

describe('Webhook delivery retry with backoff', () => {
  beforeEach(() => {
    deliveryStatusUpdates = [];
    deadLetterEntries = 0;
    webhookFailureCount = 0;
    webhookActive = true;

    mockAxiosPost.mockReset();
    mockQueueAdd.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockImplementation(fakeQuery);
  });

  it('retries a delivery to a 500-returning endpoint up to the max attempts with increasing delays', async () => {
    mockAxiosPost.mockRejectedValue(serverError);

    const attempts = await processWithRetries(deliveryJob());

    expect(attempts).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mockAxiosPost).toHaveBeenCalledTimes(MAX_ATTEMPTS);

    const scheduledDelays = mockQueueAdd.mock.calls.map(([, , opts]) => opts.delay);
    expect(scheduledDelays).toEqual(RETRY_DELAYS_MS);
    scheduledDelays.slice(1).forEach((delay, i) => {
      expect(delay).toBeGreaterThan(scheduledDelays[i]);
    });
  });

  it('marks a delivery to a 200-returning endpoint as delivered and does not retry it', async () => {
    mockAxiosPost.mockResolvedValue({ status: 200, statusText: 'OK', data: { received: true } });

    const attempts = await processWithRetries(deliveryJob());

    expect(attempts).toEqual([1]);
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(deliveryStatusUpdates).toEqual(['success']);
  });

  it('marks the delivery as failed after all retries fail', async () => {
    mockAxiosPost.mockRejectedValue(serverError);

    await processWithRetries(deliveryJob());

    expect(deliveryStatusUpdates.filter((status) => status === 'retrying')).toHaveLength(
      MAX_ATTEMPTS - 1,
    );
    expect(deliveryStatusUpdates[deliveryStatusUpdates.length - 1]).toBe('failed');
    expect(deadLetterEntries).toBe(1);
    expect(webhookFailureCount).toBe(1);
    expect(webhookActive).toBe(true);
  });

  it('marks a permanently failing webhook as inactive once consecutive failures hit the limit', async () => {
    webhookFailureCount = MAX_CONSECUTIVE_FAILURES - 1;
    mockAxiosPost.mockRejectedValue(serverError);

    await processWithRetries(deliveryJob());

    expect(deliveryStatusUpdates[deliveryStatusUpdates.length - 1]).toBe('failed');
    expect(webhookFailureCount).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(webhookActive).toBe(false);
  });
});
