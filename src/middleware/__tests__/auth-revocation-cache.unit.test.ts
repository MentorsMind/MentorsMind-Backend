import crypto from 'crypto';

jest.mock('../errorHandler', () => ({ createError: jest.fn((code: string) => Object.assign(new Error(code), { code })) }));
jest.mock('../../utils/logger.utils', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

jest.mock('../../services/email.service', () => ({ EmailService: jest.fn() }));
jest.mock('../../services/socket.service', () => ({ SocketService: {} }));

const query = jest.fn();
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { query: (...a: unknown[]) => query(...a) },
}));

const mockGet = jest.fn();
const mockSet = jest.fn();
jest.mock('../../services/cache.service', () => ({
  CacheService: {
    get: (...a: unknown[]) => mockGet(...a),
    set: (...a: unknown[]) => mockSet(...a),
    invalidatePattern: jest.fn(),
    isDistributed: jest.fn(() => false),
  },
}));

import { env } from '../../config/env';
import { TokenService } from '../../services/token.service';
import {
  isTokenRevokedCached,
  jwtExpiryToSeconds,
  revocationCacheKey,
  stopAuthDebounceCleanup,
} from '../auth.middleware';

const token = 'header.payload.signature';
const iat = 1_700_000_000_000;
const expectedKey = `revoked:${crypto.createHash('sha256').update(token).digest('hex')}`;
const expectedTtl = jwtExpiryToSeconds(env.JWT_EXPIRES_IN);

describe('token revocation cache', () => {
  beforeEach(() => jest.clearAllMocks());
  afterAll(() => stopAuthDebounceCleanup());

  it('keys the cache by sha256 of the token, never the raw token', () => {
    expect(revocationCacheKey(token)).toBe(expectedKey);
    expect(revocationCacheKey(token)).not.toContain(token);
  });

  it('converts JWT expiry strings to seconds', () => {
    expect(jwtExpiryToSeconds('15m')).toBe(900);
    expect(jwtExpiryToSeconds('1h')).toBe(3600);
    expect(jwtExpiryToSeconds('900')).toBe(900);
  });

  it('cache hit does not call the DB', async () => {
    mockGet.mockResolvedValue('valid');
    await expect(isTokenRevokedCached(token, 'u1', iat)).resolves.toBe(false);
    expect(mockGet).toHaveBeenCalledWith(expectedKey);
    expect(query).not.toHaveBeenCalled();

    mockGet.mockResolvedValue('revoked');
    await expect(isTokenRevokedCached(token, 'u1', iat)).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('cache miss calls the DB once and caches the verdict with the JWT_EXPIRES_IN TTL', async () => {
    mockGet.mockResolvedValue(null);
    query.mockResolvedValue({ rows: [{ token_invalid_before: null, deletion_completed_at: null }] });

    await expect(isTokenRevokedCached(token, 'u1', iat)).resolves.toBe(false);

    expect(query).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expectedKey, 'valid', expectedTtl);
  });

  it('caches "revoked" when the DB reports the token as invalidated', async () => {
    mockGet.mockResolvedValue(null);
    query.mockResolvedValue({
      rows: [{ token_invalid_before: new Date(iat + 1000), deletion_completed_at: null }],
    });

    await expect(isTokenRevokedCached(token, 'u1', iat)).resolves.toBe(true);
    expect(mockSet).toHaveBeenCalledWith(expectedKey, 'revoked', expectedTtl);
  });

  it('blacklistToken writes the revoked hash to the cache immediately', async () => {
    query.mockResolvedValue({ rows: [] });
    await TokenService.blacklistToken('jti-1', 1_900_000_000, token);
    expect(mockSet).toHaveBeenCalledWith(expectedKey, 'revoked', expectedTtl);
  });
});
