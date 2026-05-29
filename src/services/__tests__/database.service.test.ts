import { DatabaseService } from '../database.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
    totalCount: 4,
    idleCount: 2,
    waitingCount: 0,
  },
}));

jest.mock('../../utils/logger.utils', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

jest.mock('../../utils/database.utils', () => ({
  ...jest.requireActual('../../utils/database.utils'),
  toDatabaseError: (err: any) => {
    const e = new Error(err?.message ?? 'db error') as any;
    e.code = 'UNKNOWN';
    e.pgCode = err?.code;
    return e;
  },
  isSerializationFailure: (err: any) => err?.code === '40001' || err?.code === '40P01',
  getPoolStats: () => ({ totalCount: 4, idleCount: 2, waitingCount: 0 }),
}));

import pool from '../../config/database';
const mockPool = pool as jest.Mocked<typeof pool>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ─── withTransaction ─────────────────────────────────────────────────────────

describe('DatabaseService.withTransaction', () => {
  it('commits a successful transaction', async () => {
    const result = await DatabaseService.withTransaction(async (client) => {
      await client.query('SELECT 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('rolls back when the callback throws', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('fail')) // callback query
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      DatabaseService.withTransaction(async (client) => {
        await client.query('bad query');
      }),
    ).rejects.toThrow();

    const calls = mockClient.query.mock.calls.map((c: any) => c[0]);
    expect(calls).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('sets isolation level when specified', async () => {
    await DatabaseService.withTransaction(async () => 'ok', {
      isolationLevel: 'SERIALIZABLE',
    });

    expect(mockClient.query).toHaveBeenCalledWith(
      'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
    );
  });

  it('releases the client even when ROLLBACK itself fails', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('cb fail')) // callback
      .mockRejectedValueOnce(new Error('rollback fail')); // ROLLBACK

    await expect(DatabaseService.withTransaction(async () => { throw new Error('cb'); })).rejects.toThrow();
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('DatabaseService.withRetry', () => {
  it('returns immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('value');
    const result = await DatabaseService.withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 });
    expect(result).toBe('value');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxAttempts and throws on persistent failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(
      DatabaseService.withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 5, backoffFactor: 2 }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10000);

  it('succeeds after a transient failure', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');

    const result = await DatabaseService.withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 5, backoffFactor: 2 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  }, 10000);
});

// ─── checkHealth ─────────────────────────────────────────────────────────────

describe('DatabaseService.checkHealth', () => {
  it('returns connected=true when pool query succeeds', async () => {
    (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const result = await DatabaseService.checkHealth();
    expect(result.connected).toBe(true);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.poolStats).toBeDefined();
  });

  it('returns connected=false and error message when query fails', async () => {
    (mockPool.query as jest.Mock).mockRejectedValueOnce(new Error('no connection'));
    const result = await DatabaseService.checkHealth();
    expect(result.connected).toBe(false);
    expect(result.error).toBe('no connection');
  });
});

// ─── runMigrations ────────────────────────────────────────────────────────────

describe('DatabaseService.runMigrations', () => {
  it('runs pending migrations and records them', async () => {
    const freshClient = {
      query: jest.fn()
        .mockResolvedValueOnce({})                        // CREATE TABLE _migrations
        .mockResolvedValueOnce({ rows: [] })              // SELECT applied ids (none)
        .mockResolvedValueOnce({ rows: [{ max: '0' }] }) // MAX batch
        .mockResolvedValueOnce({})                        // BEGIN
        .mockResolvedValueOnce({})                        // migration.up() call
        .mockResolvedValueOnce({})                        // INSERT INTO _migrations
        .mockResolvedValueOnce({}),                       // COMMIT
      release: jest.fn(),
    };
    (mockPool.connect as jest.Mock).mockResolvedValueOnce(freshClient);

    const migration = {
      id: '001_create_users',
      name: 'Create users table',
      up: jest.fn().mockResolvedValue(undefined),
      down: jest.fn(),
    };

    await DatabaseService.runMigrations([migration]);
    expect(migration.up).toHaveBeenCalledTimes(1);
    expect(freshClient.release).toHaveBeenCalled();
  });

  it('skips already-applied migrations', async () => {
    const freshClient = {
      query: jest.fn()
        .mockResolvedValueOnce({})                                          // CREATE TABLE _migrations
        .mockResolvedValueOnce({ rows: [{ id: '001_create_users' }] })      // already applied
        .mockResolvedValueOnce({ rows: [{ max: '1' }] }),                   // MAX batch
      release: jest.fn(),
    };
    (mockPool.connect as jest.Mock).mockResolvedValueOnce(freshClient);

    const migration = {
      id: '001_create_users',
      name: 'Create users table',
      up: jest.fn(),
      down: jest.fn(),
    };

    await DatabaseService.runMigrations([migration]);
    expect(migration.up).not.toHaveBeenCalled();
    expect(freshClient.release).toHaveBeenCalled();
  });
});

