jest.mock('../../config', () => ({
  default: {
    redis: { url: 'redis://localhost:6379' },
    db: {
      url: 'postgresql://localhost/test',
      host: 'localhost',
      port: 5432,
      name: 'test',
      user: 'test',
      password: 'test',
      poolMax: 5,
      idleTimeoutMs: 1000,
      connectionTimeoutMs: 1000,
    },
  },
}));

jest.mock('../../queues/queue.config', () => ({
  redisConnection: { host: 'localhost', port: 6379 },
  defaultJobOptions: { attempts: 5 },
  QUEUE_NAMES: { ESCROW_RELEASE: 'escrow-release-queue' },
  CONCURRENCY: { ESCROW_RELEASE: 3 },
}));

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
}));

jest.mock('../../config/database', () => ({
  default: { query: jest.fn() },
}));

jest.mock('../../services/escrow-api.service', () => ({
  EscrowApiService: {
    getEscrowById: jest.fn(),
    releaseEscrow: jest.fn(),
  },
}));

jest.mock('../../services/audit-logger.service', () => ({
  AuditLoggerService: { logEvent: jest.fn().mockResolvedValue(undefined) },
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

import { EscrowApiService } from '../../services/escrow-api.service';

const mockGetEscrow = EscrowApiService.getEscrowById as jest.Mock;
const mockReleaseEscrow = EscrowApiService.releaseEscrow as jest.Mock;

// Side-effect import to register the worker and capture the processor
import '../escrow-release.worker';

describe('Escrow Release Worker', () => {
  const mockJob = {
    id: 'job-1',
    data: {
      escrowId: 'escrow-1',
      mentorId: 'mentor-1',
      learnerId: 'learner-1',
      sessionCompletedAt: new Date().toISOString(),
    },
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('releases a funded escrow', async () => {
    mockGetEscrow.mockResolvedValue({ id: 'escrow-1', status: 'funded' });
    mockReleaseEscrow.mockResolvedValue({ id: 'escrow-1', status: 'released' });

    await capturedProcessor(mockJob);
    expect(mockReleaseEscrow).toHaveBeenCalledWith('escrow-1', 'system');
  });

  it('skips already-released escrow', async () => {
    mockGetEscrow.mockResolvedValue({ id: 'escrow-1', status: 'released' });
    await capturedProcessor(mockJob);
    expect(mockReleaseEscrow).not.toHaveBeenCalled();
  });

  it('skips disputed escrow', async () => {
    mockGetEscrow.mockResolvedValue({ id: 'escrow-1', status: 'disputed' });
    await capturedProcessor(mockJob);
    expect(mockReleaseEscrow).not.toHaveBeenCalled();
  });

  it('skips refunded escrow', async () => {
    mockGetEscrow.mockResolvedValue({ id: 'escrow-1', status: 'refunded' });
    await capturedProcessor(mockJob);
    expect(mockReleaseEscrow).not.toHaveBeenCalled();
  });

  it('throws when escrow not found', async () => {
    mockGetEscrow.mockResolvedValue(null);
    await expect(capturedProcessor(mockJob)).rejects.toThrow(
      'Escrow escrow-1 not found',
    );
  });
});
