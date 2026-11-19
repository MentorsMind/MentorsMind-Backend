/**
 * Unit tests for X-Rate-Limit-Scope header (#1287)
 *
 * Verifies that each rate-limiter variant sets a distinct X-Rate-Limit-Scope
 * header on 429 responses, and that Retry-After is always present.
 */

import { Request, Response, NextFunction } from 'express';

// ─── Mock RateLimiterService ──────────────────────────────────────────────────

const mockCheck = jest.fn();

jest.mock('../../services/rate-limiter.service', () => ({
  RateLimiterService: {
    check: mockCheck,
    getTierLimit: jest.fn().mockReturnValue({ max: 100, windowMs: 60_000 }),
    getCategoryLimit: jest.fn().mockReturnValue({ max: 50, windowMs: 60_000 }),
  },
}));

// ─── Mock utils ───────────────────────────────────────────────────────────────

jest.mock('../../utils/rate-limit.utils', () => ({
  isAdminRequest: jest.fn().mockReturnValue(false),
  setRateLimitHeaders: jest.fn(),
  ipKey: jest.fn().mockReturnValue('ip:127.0.0.1'),
  userKey: jest.fn().mockReturnValue('user:test-user'),
  buildRateLimitEvent: jest.fn().mockReturnValue({}),
  logRateLimitEvent: jest.fn(),
}));

// ─── Mock metrics ─────────────────────────────────────────────────────────────

jest.mock('../../config/metrics', () => ({
  rateLimitExceededTotal: { inc: jest.fn() },
}));

// ─── Mock env (needed by rate-limits.config) ──────────────────────────────────

jest.mock('../../config/env', () => ({
  default: {
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_REQUESTS: '100',
  },
}));

// Import after mocks
import {
  generalLimiter,
  authLimiter,
  paymentLimiter,
  exportLimiter,
  sensitiveLimiter,
} from '../rate-limit.middleware';
import { distributedRateLimit } from '../distributed-rate-limit.middleware';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockReset(allowed: boolean, windowMs = 60_000) {
  const resetTime = new Date(Date.now() + windowMs);
  mockCheck.mockResolvedValue({
    allowed,
    limit: 10,
    current: allowed ? 1 : 11,
    remaining: allowed ? 9 : 0,
    resetTime,
  });
}

function buildReqRes(): { req: Request; res: Response; next: NextFunction } {
  const req = {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: {},
    user: undefined,
  } as unknown as Request;

  const headers: Record<string, string> = {};
  let statusCode = 200;
  const res = {
    setHeader: jest.fn((key: string, val: string) => { headers[key] = val; }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    _headers: headers,
    getHeader: (k: string) => headers[k],
  } as unknown as Response;

  const next = jest.fn() as unknown as NextFunction;
  return { req, res, next };
}

// =============================================================================
// rate-limit.middleware — createLimiter-based limiters
// =============================================================================

describe('X-Rate-Limit-Scope header — rate-limit.middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  const cases: Array<[string, (r: Request, s: Response, n: NextFunction) => Promise<void>]> = [
    ['general', generalLimiter as any],
    ['auth',    authLimiter    as any],
    ['payment', paymentLimiter as any],
    ['export',  exportLimiter  as any],
    ['sensitive', sensitiveLimiter as any],
  ];

  it.each(cases)(
    '%s limiter sets X-Rate-Limit-Scope: %s on 429',
    async (expectedScope, limiter) => {
      mockReset(false);
      const { req, res, next } = buildReqRes();
      await limiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).toHaveBeenCalledWith('X-Rate-Limit-Scope', expectedScope);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each(cases)(
    '%s limiter sets Retry-After header on 429',
    async (_scope, limiter) => {
      mockReset(false, 3600_000);
      const { req, res, next } = buildReqRes();
      await limiter(req, res, next);

      const calls = (res.setHeader as jest.Mock).mock.calls;
      const retryAfterCall = calls.find(([k]) => k === 'Retry-After');
      expect(retryAfterCall).toBeDefined();
      const seconds = Number(retryAfterCall![1]);
      expect(seconds).toBeGreaterThan(0);
    },
  );

  it('does NOT set X-Rate-Limit-Scope when request is allowed', async () => {
    mockReset(true);
    const { req, res, next } = buildReqRes();
    await generalLimiter(req as Request, res as Response, next as NextFunction);

    const calls = (res.setHeader as jest.Mock).mock.calls;
    const scopeCall = calls.find(([k]) => k === 'X-Rate-Limit-Scope');
    expect(scopeCall).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

// =============================================================================
// distributed-rate-limit.middleware — category maps to scope
// =============================================================================

describe('X-Rate-Limit-Scope header — distributed-rate-limit.middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  const categories = ['general', 'auth', 'payment', 'file-upload'] as const;

  it.each(categories)(
    'distributedRateLimit category=%s sets X-Rate-Limit-Scope: %s on 429',
    async (category) => {
      mockReset(false);
      const { req, res, next } = buildReqRes();
      const middleware = distributedRateLimit({ category, fallbackToIp: true });
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).toHaveBeenCalledWith('X-Rate-Limit-Scope', category);
    },
  );

  it('each category produces a distinct X-Rate-Limit-Scope value', async () => {
    const scopes: string[] = [];

    for (const category of categories) {
      mockReset(false);
      const { req, res, next } = buildReqRes();
      const middleware = distributedRateLimit({ category, fallbackToIp: true });
      await middleware(req, res, next);

      const calls = (res.setHeader as jest.Mock).mock.calls;
      const scopeCall = calls.find(([k]: [string]) => k === 'X-Rate-Limit-Scope');
      scopes.push(scopeCall![1] as string);
    }

    // All scopes should be unique across different categories
    expect(new Set(scopes).size).toBe(categories.length);
  });
});
