jest.mock('../../config/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

import { redis } from '../../config/redis';
import {
  STELLAR_STREAM_CURSOR_KEY_PREFIX,
  getStellarStreamCursorKey,
  loadStellarStreamCursor,
  saveStellarStreamCursor,
  clearStellarStreamCursor,
} from '../stellar-cursor.utils';

describe('stellar cursor persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to now when no persisted cursor exists', async () => {
    (redis.get as jest.Mock).mockResolvedValue(null);

    await expect(loadStellarStreamCursor('GBTEST')).resolves.toBe('now');
    expect(redis.get).toHaveBeenCalledWith(`${STELLAR_STREAM_CURSOR_KEY_PREFIX}:GBTEST`);
  });

  it('stores the most recent cursor with a TTL', async () => {
    await saveStellarStreamCursor('GBTEST', 'cursor-123');

    expect(redis.set).toHaveBeenCalledWith(
      `${STELLAR_STREAM_CURSOR_KEY_PREFIX}:GBTEST`,
      'cursor-123',
      'EX',
      7 * 24 * 60 * 60,
    );
  });

  it('removes the Redis cursor when clearing state', async () => {
    await clearStellarStreamCursor('GBTEST');

    expect(redis.del).toHaveBeenCalledWith(`${STELLAR_STREAM_CURSOR_KEY_PREFIX}:GBTEST`);
  });

  it('builds the correct account key', () => {
    expect(getStellarStreamCursorKey('GBTEST')).toBe(`${STELLAR_STREAM_CURSOR_KEY_PREFIX}:GBTEST`);
  });
});
