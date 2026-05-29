jest.mock('../../config', () => ({
  default: { redis: { url: 'redis://localhost:6379' } },
}));

jest.mock('../queue.config', () => ({
  redisConnection: { host: 'localhost', port: 6379 },
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  },
  QUEUE_NAMES: {
    EMAIL: 'email-queue',
    PAYMENT_POLL: 'payment-poll-queue',
    ESCROW_RELEASE: 'escrow-release-queue',
    REPORT: 'report-queue',
    EXPORT: 'export-queue',
  },
  CONCURRENCY: { EMAIL: 10, PAYMENT_POLL: 5, ESCROW_RELEASE: 3, REPORT: 2 },
}));

// Prevent pg from trying to connect during tests
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
}));

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    getJob: jest.fn().mockResolvedValue(null),
  })),
  Worker: jest.fn(),
  Job: jest.fn(),
}));

import { emailQueue, enqueueEmail } from '../email.queue';
import { paymentPollQueue, enqueuePaymentPoll } from '../payment-poll.queue';
import {
  escrowReleaseQueue,
  scheduleEscrowRelease,
  cancelEscrowRelease,
} from '../escrow-release.queue';
import { reportQueue, enqueueWeeklyEarningsReport } from '../report.queue';

describe('Email Queue', () => {
  it('enqueues an email job', async () => {
    await enqueueEmail({ to: ['test@example.com'], subject: 'Hello' });
    expect(emailQueue.add).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({
        to: ['test@example.com'],
        subject: 'Hello',
        jobType: 'send-email',
      }),
      expect.anything(),
    );
  });

  it('passes priority when provided', async () => {
    await enqueueEmail({ to: ['a@b.com'], subject: 'Urgent' }, 1);
    expect(emailQueue.add).toHaveBeenCalledWith(
      'send-email',
      expect.any(Object),
      expect.objectContaining({ priority: 1 }),
    );
  });
});

describe('Payment Poll Queue', () => {
  it('enqueues a payment poll job with deduplication jobId', async () => {
    await enqueuePaymentPoll({
      paymentId: 'pay-1',
      userId: 'user-1',
      transactionHash: null,
    });
    expect(paymentPollQueue.add).toHaveBeenCalledWith(
      'poll-payment',
      expect.objectContaining({ paymentId: 'pay-1' }),
      expect.objectContaining({ jobId: 'payment-poll:pay-1' }),
    );
  });
});

describe('Escrow Release Queue', () => {
  it('schedules an escrow release with 48h delay', async () => {
    const data = {
      escrowId: 'escrow-1',
      mentorId: 'mentor-1',
      learnerId: 'learner-1',
      sessionCompletedAt: new Date().toISOString(),
    };
    await scheduleEscrowRelease(data);
    expect(escrowReleaseQueue.add).toHaveBeenCalledWith(
      'auto-release-escrow',
      data,
      expect.objectContaining({
        jobId: 'escrow-release:escrow-1',
        delay: 48 * 60 * 60 * 1000,
      }),
    );
  });

  it('cancels an escrow release if job exists', async () => {
    const removeFn = jest.fn();
    (escrowReleaseQueue.getJob as jest.Mock).mockResolvedValueOnce({
      remove: removeFn,
    });
    await cancelEscrowRelease('escrow-1');
    expect(removeFn).toHaveBeenCalled();
  });

  it('does nothing when cancelling a non-existent job', async () => {
    (escrowReleaseQueue.getJob as jest.Mock).mockResolvedValueOnce(null);
    await expect(cancelEscrowRelease('escrow-999')).resolves.not.toThrow();
  });
});

describe('Report Queue', () => {
  it('enqueues a weekly earnings report with correct period', async () => {
    await enqueueWeeklyEarningsReport('mentor-1');
    expect(reportQueue.add).toHaveBeenCalledWith(
      'weekly-earnings',
      expect.objectContaining({
        reportType: 'weekly-earnings',
        mentorId: 'mentor-1',
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('weekly-earnings:mentor-1'),
      }),
    );
  });

  it('enqueues platform-wide report when no mentorId', async () => {
    await enqueueWeeklyEarningsReport();
    expect(reportQueue.add).toHaveBeenCalledWith(
      'weekly-earnings',
      expect.objectContaining({
        reportType: 'weekly-earnings',
        mentorId: undefined,
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('weekly-earnings:platform'),
      }),
    );
  });
});
