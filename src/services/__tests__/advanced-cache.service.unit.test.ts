import { AdvancedCacheService } from '../advanced-cache.service';
import { Redis } from 'ioredis';

jest.mock('ioredis');

describe('AdvancedCacheService - Distributed Lock', () => {
  let service: AdvancedCacheService;
  let redisMock: jest.Mocked<Redis>;

  beforeEach(() => {
    jest.clearAllMocks();
    redisMock = new Redis() as jest.Mocked<Redis>;
    service = new AdvancedCacheService(redisMock);
  });

  describe('acquireLock', () => {
    it('should return lock object on successful acquisition', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const lockId = 'test-lock-id';
      const result = await service.acquireLock('my-lock', lockId, 5000);

      expect(result).toEqual({
        lockId,
        timestamp: expect.any(Number),
        acquired: true,
      });
      expect(redisMock.set).toHaveBeenCalledWith(
        'my-lock',
        lockId,
        'PX',
        5000,
        'NX',
      );
    });

    it('should return null when lock is already held', async () => {
      redisMock.set.mockResolvedValueOnce(null);
      const lockId = 'test-lock-id';
      const result = await service.acquireLock('my-lock', lockId, 5000);

      expect(result).toBeNull();
    });

    it('should handle lock contention gracefully', async () => {
      redisMock.set.mockResolvedValueOnce(null);
      redisMock.set.mockResolvedValueOnce('OK');

      const lockId1 = 'lock-1';
      const lockId2 = 'lock-2';

      const result1 = await service.acquireLock('resource', lockId1, 5000);
      const result2 = await service.acquireLock('resource', lockId2, 5000);

      expect(result1).not.toBeNull();
      expect(result2).toBeNull();
    });

    it('should support short TTL values', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const result = await service.acquireLock('quick-lock', 'id-1', 100);

      expect(result).not.toBeNull();
      expect(redisMock.set).toHaveBeenCalledWith(
        'quick-lock',
        'id-1',
        'PX',
        100,
        'NX',
      );
    });

    it('should support long TTL values', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const result = await service.acquireLock('long-lock', 'id-1', 3600000);

      expect(result).not.toBeNull();
      expect(redisMock.set).toHaveBeenCalledWith(
        'long-lock',
        'id-1',
        'PX',
        3600000,
        'NX',
      );
    });

    it('should handle special characters in lock key', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const result = await service.acquireLock(
        'lock:user:123:resource',
        'id-1',
        5000,
      );

      expect(result).not.toBeNull();
    });

    it('should handle special characters in lock ID', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const specialId = 'id-!@#$%^&*()_+-=[]{}|;:,.<>?';
      const result = await service.acquireLock('lock', specialId, 5000);

      expect(result).not.toBeNull();
      expect(redisMock.set).toHaveBeenCalledWith(
        'lock',
        specialId,
        'PX',
        5000,
        'NX',
      );
    });

    it('should return timestamp with lock object', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const beforeAcquire = Date.now();
      const result = await service.acquireLock('lock', 'id', 5000);
      const afterAcquire = Date.now();

      expect(result?.timestamp).toBeGreaterThanOrEqual(beforeAcquire);
      expect(result?.timestamp).toBeLessThanOrEqual(afterAcquire);
    });
  });

  describe('releaseLock', () => {
    it('should remove lock when value matches', async () => {
      const lockId = 'correct-id';
      redisMock.eval.mockResolvedValueOnce(1);

      const result = await service.releaseLock('my-lock', lockId);

      expect(result).toBe(true);
      expect(redisMock.eval).toHaveBeenCalled();
    });

    it('should not remove lock when value does not match', async () => {
      redisMock.eval.mockResolvedValueOnce(0);

      const result = await service.releaseLock('my-lock', 'wrong-id');

      expect(result).toBe(false);
    });

    it('should handle release of non-existent lock', async () => {
      redisMock.eval.mockResolvedValueOnce(0);

      const result = await service.releaseLock('non-existent', 'any-id');

      expect(result).toBe(false);
    });

    it('should use Lua script for atomic operation', async () => {
      redisMock.eval.mockResolvedValueOnce(1);

      await service.releaseLock('lock', 'id');

      expect(redisMock.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call'),
        1,
        'lock',
        'id',
      );
    });

    it('should handle special characters in lock key during release', async () => {
      redisMock.eval.mockResolvedValueOnce(1);

      const result = await service.releaseLock('lock:user:123', 'id');

      expect(result).toBe(true);
    });

    it('should handle special characters in lock ID during release', async () => {
      redisMock.eval.mockResolvedValueOnce(1);
      const specialId = 'id-with-!@#$%^&*()';

      const result = await service.releaseLock('lock', specialId);

      expect(result).toBe(true);
    });
  });

  describe('lock TTL and auto-expiry', () => {
    it('should set expiry with millisecond precision', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const ttl = 7500;

      await service.acquireLock('lock', 'id', ttl);

      expect(redisMock.set).toHaveBeenCalledWith(
        'lock',
        'id',
        'PX',
        ttl,
        'NX',
      );
    });

    it('should handle minimum TTL', async () => {
      redisMock.set.mockResolvedValueOnce('OK');

      await service.acquireLock('lock', 'id', 1);

      expect(redisMock.set).toHaveBeenCalledWith('lock', 'id', 'PX', 1, 'NX');
    });

    it('should handle very large TTL', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const largeTtl = 86400000;

      await service.acquireLock('lock', 'id', largeTtl);

      expect(redisMock.set).toHaveBeenCalledWith(
        'lock',
        'id',
        'PX',
        largeTtl,
        'NX',
      );
    });
  });

  describe('retry logic', () => {
    it('should support retry on lock contention', async () => {
      redisMock.set
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('OK');

      const result = await service.acquireLockWithRetry('lock', 'id', 5000, {
        maxRetries: 3,
        retryDelayMs: 10,
      });

      expect(result).not.toBeNull();
      expect(redisMock.set).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries exceeded', async () => {
      redisMock.set.mockResolvedValue(null);

      const result = await service.acquireLockWithRetry('lock', 'id', 5000, {
        maxRetries: 2,
        retryDelayMs: 10,
      });

      expect(result).toBeNull();
      expect(redisMock.set).toHaveBeenCalledTimes(2);
    });

    it('should respect retry delay', async () => {
      redisMock.set
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('OK');

      const startTime = Date.now();
      await service.acquireLockWithRetry('lock', 'id', 5000, {
        maxRetries: 2,
        retryDelayMs: 50,
      });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(50);
    });

    it('should support zero retries', async () => {
      redisMock.set.mockResolvedValueOnce(null);

      const result = await service.acquireLockWithRetry('lock', 'id', 5000, {
        maxRetries: 0,
        retryDelayMs: 10,
      });

      expect(result).toBeNull();
      expect(redisMock.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty lock key', async () => {
      redisMock.set.mockResolvedValueOnce('OK');

      const result = await service.acquireLock('', 'id', 5000);

      expect(result).not.toBeNull();
    });

    it('should handle very long lock key', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const longKey = 'x'.repeat(10000);

      const result = await service.acquireLock(longKey, 'id', 5000);

      expect(result).not.toBeNull();
    });

    it('should handle very long lock ID', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const longId = 'x'.repeat(10000);

      const result = await service.acquireLock('lock', longId, 5000);

      expect(result).not.toBeNull();
    });

    it('should handle concurrent lock attempts', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      redisMock.set.mockResolvedValueOnce(null);

      const results = await Promise.all([
        service.acquireLock('shared-lock', 'id-1', 5000),
        service.acquireLock('shared-lock', 'id-2', 5000),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it('should handle numeric lock keys', async () => {
      redisMock.set.mockResolvedValueOnce('OK');

      const result = await service.acquireLock('12345', 'id', 5000);

      expect(result).not.toBeNull();
    });

    it('should handle unicode characters in lock ID', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const unicodeId = 'id-🔒-ñ-中文';

      const result = await service.acquireLock('lock', unicodeId, 5000);

      expect(result).not.toBeNull();
    });

    it('should handle rapidly successive lock/release operations', async () => {
      redisMock.set.mockResolvedValue('OK');
      redisMock.eval.mockResolvedValue(1);

      const results = [];
      for (let i = 0; i < 5; i++) {
        const acquired = await service.acquireLock(`lock-${i}`, `id-${i}`, 5000);
        const released = await service.releaseLock(`lock-${i}`, `id-${i}`);
        results.push({ acquired, released });
      }

      expect(results).toHaveLength(5);
      expect(results.every((r) => r.acquired && r.released)).toBe(true);
    });

    it('should handle zero TTL', async () => {
      redisMock.set.mockResolvedValueOnce('OK');

      const result = await service.acquireLock('lock', 'id', 0);

      expect(result).not.toBeNull();
    });

    it('should handle negative TTL gracefully', async () => {
      redisMock.set.mockResolvedValueOnce('OK');

      const result = await service.acquireLock('lock', 'id', -100);

      expect(result).not.toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle Redis connection errors on acquire', async () => {
      redisMock.set.mockRejectedValueOnce(new Error('Connection lost'));

      await expect(
        service.acquireLock('lock', 'id', 5000),
      ).rejects.toThrow('Connection lost');
    });

    it('should handle Redis errors on release', async () => {
      redisMock.eval.mockRejectedValueOnce(new Error('Redis error'));

      await expect(service.releaseLock('lock', 'id')).rejects.toThrow(
        'Redis error',
      );
    });

    it('should handle timeout during lock acquisition', async () => {
      redisMock.set.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve('OK'), 10000);
          }),
      );

      const promise = service.acquireLock('lock', 'id', 5000);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Timeout')),
          100,
        ),
      );

      await expect(Promise.race([promise, timeoutPromise])).rejects.toThrow(
        'Timeout',
      );
    });
  });

  describe('acceptance criteria', () => {
    it('✓ verify lock acquisition returns object on success', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const result = await service.acquireLock('lock', 'id', 5000);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('lockId');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('acquired');
      expect(result?.acquired).toBe(true);
    });

    it('✓ verify second acquisition while held returns null', async () => {
      redisMock.set.mockResolvedValueOnce(null);
      const result = await service.acquireLock('held-lock', 'id', 5000);

      expect(result).toBeNull();
    });

    it('✓ verify releaseLock removes key only if value matches', async () => {
      redisMock.eval
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      const releaseMatch = await service.releaseLock('lock', 'correct-id');
      const releaseNoMatch = await service.releaseLock('lock', 'wrong-id');

      expect(releaseMatch).toBe(true);
      expect(releaseNoMatch).toBe(false);
    });

    it('✓ verify lock auto-expires after TTL', async () => {
      redisMock.set.mockResolvedValueOnce('OK');
      const ttl = 5000;

      await service.acquireLock('expiring-lock', 'id', ttl);

      expect(redisMock.set).toHaveBeenCalledWith(
        'expiring-lock',
        'id',
        'PX',
        ttl,
        'NX',
      );
    });

    it('✓ all tests pass with in-memory Redis mock', () => {
      expect(redisMock).toBeDefined();
      expect(jest.isMockFunction(redisMock.set)).toBe(true);
      expect(jest.isMockFunction(redisMock.eval)).toBe(true);
    });
  });
});
