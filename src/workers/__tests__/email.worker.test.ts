jest.mock('../../config', () => ({
  default: { redis: { url: 'redis://localhost:6379' } },
}));

jest.mock('../../queues/queue.config', () => ({
  redisConnection: { host: 'localhost', port: 6379 },
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  },
  QUEUE_NAMES: { EMAIL: 'email-queue' },
  CONCURRENCY: { EMAIL: 10 },
}));

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
}));

const mockSendEmail = jest.fn();

jest.mock('../../services/email.service', () => ({
  EmailService: jest
    .fn()
    .mockImplementation(() => ({ sendEmail: mockSendEmail })),
}));

jest.mock('../../utils/logger.utils', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

let capturedProcessor: Function;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: Function) => {
    capturedProcessor = processor;
    return { on: jest.fn(), close: jest.fn() };
  }),
}));

// Side-effect import to register the worker and capture the processor
import '../email.worker';

describe('Email Worker', () => {
  const mockJob = {
    id: 'job-1',
    data: {
      jobType: 'send-email' as const,
      to: ['user@example.com'],
      subject: 'Test',
    },
    attemptsMade: 1,
  } as any;

  beforeEach(() => mockSendEmail.mockReset());

  it('calls emailService.sendEmail with job data', async () => {
    mockSendEmail.mockResolvedValue({
      success: true,
      messageId: 'msg-1',
      deliveryStatus: 'sent',
    });
    await capturedProcessor(mockJob);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['user@example.com'], subject: 'Test' }),
    );
  });

  it('throws when email send fails with error message', async () => {
    mockSendEmail.mockResolvedValue({
      success: false,
      error: 'SMTP error',
      deliveryStatus: 'failed',
    });
    await expect(capturedProcessor(mockJob)).rejects.toThrow('SMTP error');
  });

  it('throws with default message when no error string provided', async () => {
    mockSendEmail.mockResolvedValue({
      success: false,
      deliveryStatus: 'failed',
    });
    await expect(capturedProcessor(mockJob)).rejects.toThrow(
      'Email send failed',
    );
  });
});
