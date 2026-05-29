import { LoginAttemptsService, THRESHOLDS } from '../loginAttempts.service';
import { redis } from '../../config/redis';

// Mock the shared Redis client
jest.mock('../../config/redis', () => ({
  redis: {
    status: 'ready', // Default to ready
    exists: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    pipeline: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    })),
  },
}));

describe('LoginAttemptsService (in-memory fallback)', () => {
  const TEST_EMAIL = 'test@example.com';
  const TEST_IP = '127.0.0.1';

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    // Clear the in-memory store for a clean slate
    (LoginAttemptsService as any).memStore.clear();
  });

  it('should use in-memory fallback when Redis is not ready for recordFailure', async () => {
    // Simulate Redis being unavailable
    (redis.status as string) = 'end'; // Or 'reconnecting', 'connecting', etc.

    // Record failures, expecting in-memory to be used
    for (let i = 0; i < THRESHOLDS.CAPTCHA; i++) {
      await LoginAttemptsService.recordFailure(TEST_EMAIL, TEST_IP);
    }

    // Verify Redis functions were NOT called
    expect(redis.exists).not.toHaveBeenCalled();
    expect(redis.pipeline).not.toHaveBeenCalled();

    // Check status, expecting in-memory to reflect attempts
    const status = await LoginAttemptsService.getStatus(TEST_EMAIL);
    expect(status.attempts).toBe(THRESHOLDS.CAPTCHA);
    expect(status.captchaRequired).toBe(true);
    expect(status.locked).toBe(false);
  });

  it('should use in-memory fallback when Redis is not ready for getStatus', async () => {
    // Simulate Redis being unavailable
    (redis.status as string) = 'end';

    // Record some failures in-memory directly (as if recordFailure was called)
    const memStore = (LoginAttemptsService as any).memStore;
    memStore.set(TEST_EMAIL.toLowerCase(), { count: THRESHOLDS.CAPTCHA });

    // Get status, expecting in-memory to be used
    const status = await LoginAttemptsService.getStatus(TEST_EMAIL);

    // Verify Redis functions were NOT called
    expect(redis.exists).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.ttl).not.toHaveBeenCalled();

    expect(status.attempts).toBe(THRESHOLDS.CAPTCHA);
    expect(status.captchaRequired).toBe(true);
  });

  it('should use in-memory fallback when Redis is not ready for resetAttempts', async () => {
    // Simulate Redis being unavailable
    (redis.status as string) = 'end';

    // Record some failures in-memory directly
    const memStore = (LoginAttemptsService as any).memStore;
    memStore.set(TEST_EMAIL.toLowerCase(), { count: 5 });

    // Reset attempts
    await LoginAttemptsService.resetAttempts(TEST_EMAIL);

    // Verify Redis del was NOT called
    expect(redis.del).not.toHaveBeenCalled();

    // Check status, expecting in-memory to be reset
    const status = await LoginAttemptsService.getStatus(TEST_EMAIL);
    expect(status.attempts).toBe(0);
  });

  it('should use in-memory fallback when Redis is not ready for adminUnlock', async () => {
    // Simulate Redis being unavailable
    (redis.status as string) = 'end';

    // Record a permanent lock in-memory directly
    const memStore = (LoginAttemptsService as any).memStore;
    memStore.set(TEST_EMAIL.toLowerCase(), { count: THRESHOLDS.LOCK_PERMANENT, permanent: true });

    // Admin unlock
    await LoginAttemptsService.adminUnlock(TEST_EMAIL);

    // Verify Redis del was NOT called
    expect(redis.del).not.toHaveBeenCalled();

    // Check status, expecting in-memory permanent lock to be cleared
    const status = await LoginAttemptsService.getStatus(TEST_EMAIL);
    expect(status.permanent).toBe(false);
    expect(status.locked).toBe(false);
  });
});
