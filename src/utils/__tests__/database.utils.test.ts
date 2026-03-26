import {
  toDatabaseError,
  isUniqueViolation,
  isForeignKeyViolation,
  isSerializationFailure,
  exists,
  count,
  getPoolStats,
} from '../database.utils';

// ─── Mock pool ────────────────────────────────────────────────────────────────

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  },
}));

jest.mock('../logger.utils', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

import pool from '../../config/database';
const mockPool = pool as jest.Mocked<typeof pool>;

// ─── toDatabaseError ─────────────────────────────────────────────────────────

describe('toDatabaseError', () => {
  it('maps pg code 23505 to UNIQUE_VIOLATION', () => {
    const err = toDatabaseError({ code: '23505', message: 'duplicate key', constraint: 'users_email_key' });
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(err.pgCode).toBe('23505');
    expect(err.constraint).toBe('users_email_key');
  });

  it('maps pg code 23503 to FOREIGN_KEY_VIOLATION', () => {
    const err = toDatabaseError({ code: '23503', message: 'fk violation' });
    expect(err.code).toBe('FOREIGN_KEY_VIOLATION');
  });

  it('maps pg code 40001 to SERIALIZATION_FAILURE', () => {
    const err = toDatabaseError({ code: '40001', message: 'could not serialize' });
    expect(err.code).toBe('SERIALIZATION_FAILURE');
  });

  it('maps unknown pg codes to UNKNOWN', () => {
    const err = toDatabaseError({ code: '99999', message: 'something weird' });
    expect(err.code).toBe('UNKNOWN');
  });

  it('handles raw Error objects', () => {
    const err = toDatabaseError(new Error('timeout'));
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('timeout');
  });
});

// ─── Error predicates ─────────────────────────────────────────────────────────

describe('error predicates', () => {
  it('isUniqueViolation returns true for code 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });

  it('isForeignKeyViolation returns true for code 23503', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
  });

  it('isSerializationFailure returns true for 40001 and 40P01', () => {
    expect(isSerializationFailure({ code: '40001' })).toBe(true);
    expect(isSerializationFailure({ code: '40P01' })).toBe(true);
    expect(isSerializationFailure({ code: '23505' })).toBe(false);
  });
});

// ─── exists ───────────────────────────────────────────────────────────────────

describe('exists', () => {
  it('returns true when a row is found', async () => {
    (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const result = await exists('users', 'email = $1', ['a@b.com']);
    expect(result).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      'SELECT 1 FROM users WHERE email = $1 LIMIT 1',
      ['a@b.com'],
    );
  });

  it('returns false when no row is found', async () => {
    (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(await exists('users', 'email = $1', ['x@y.com'])).toBe(false);
  });

  it('throws a DatabaseError on query failure', async () => {
    (mockPool.query as jest.Mock).mockRejectedValueOnce({ code: '08006', message: 'conn lost' });
    await expect(exists('users', '1=1', [])).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
  });
});

// ─── count ────────────────────────────────────────────────────────────────────

describe('count', () => {
  it('returns the correct integer count', async () => {
    (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ n: '42' }] });
    expect(await count('bookings', 'mentor_id = $1', ['uuid-1'])).toBe(42);
  });

  it('uses default WHERE 1=1 when no clause given', async () => {
    (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ n: '7' }] });
    await count('users');
    const calls = (mockPool.query as jest.Mock).mock.calls;
    expect(calls[calls.length - 1]?.[0]).toContain('WHERE 1=1');
  });
});

// ─── getPoolStats ─────────────────────────────────────────────────────────────

describe('getPoolStats', () => {
  it('reflects pool counts', () => {
    const stats = getPoolStats();
    expect(stats).toEqual({ totalCount: 5, idleCount: 3, waitingCount: 0 });
  });
});
