import { AuthService } from '../auth.service';
import pool from '../../config/database';
import { env } from '../../config/env';
import { TokenService } from '../token.service';
import bcrypt from 'bcryptjs';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock('../../middleware/errorHandler', () => ({
  createError: jest.fn((message: string) => new Error(message)),
}));
jest.mock('../cache.service', () => ({ CacheService: { invalidatePattern: jest.fn() } }));
jest.mock('../token.service', () => ({
  TokenService: { issueTokens: jest.fn() },
}));
jest.mock('../sessionManager.service', () => ({
  SessionManagerService: { createSession: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('bcryptjs');

describe('AuthService bcrypt hash upgrade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rehashes a successfully authenticated password when rounds differ', async () => {
    const scheduledCallbacks: Array<(...args: unknown[]) => void> = [];
    jest.spyOn(global, 'setImmediate').mockImplementation((callback) => {
      scheduledCallbacks.push(callback as (...args: unknown[]) => void);
      return {} as NodeJS.Immediate;
    });

    (pool.query as jest.Mock)
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-1',
          role: 'learner',
          user_tier: 'free',
          status: 'active',
          password_hash: 'old-hash',
        }],
      })
      .mockResolvedValue({ rows: [] });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.getRounds as jest.Mock).mockReturnValue(10);
    (bcrypt.hash as jest.Mock).mockResolvedValue('upgraded-hash');
    (TokenService.issueTokens as jest.Mock).mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    const result = await AuthService.login({
      email: 'test@test.com',
      password: 'Password123!',
    });

    expect(result.tokens.accessToken).toBe('access-token');
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(scheduledCallbacks).toHaveLength(1);

    await (scheduledCallbacks[0] as () => Promise<void>)();

    expect(bcrypt.hash).toHaveBeenCalledWith('Password123!', Number(env.BCRYPT_ROUNDS));
    expect(pool.query).toHaveBeenLastCalledWith(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      ['upgraded-hash', 'user-1']
    );
  });
});