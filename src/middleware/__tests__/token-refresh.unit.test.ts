jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../services/token.service', () => ({
  TokenService: {
    rotateRefreshToken: jest.fn(),
  },
}));

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { tokenRefreshMiddleware, handleTokenRefresh } from '../token-refresh.middleware';
import { TokenService } from '../../services/token.service';

describe('token-refresh.middleware', () => {
  const secret = process.env.JWT_SECRET || 'test-jwt-secret';
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    mockReq = {
      headers: {},
      body: {},
      query: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('tokenRefreshMiddleware (Access Token Expiry Verification)', () => {
    it('passes through when access token is valid and unexpired', () => {
      const payload = { userId: 'user-123', role: 'mentee' };
      const token = jwt.sign(payload, secret, { expiresIn: '15m' });

      mockReq.headers = {
        authorization: `Bearer ${token}`,
      };

      tokenRefreshMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect((mockReq as any).user).toBeDefined();
      expect((mockReq as any).user.userId).toBe('user-123');
    });

    it('rejects access tokens with exp in the past and returns 401 with code TOKEN_EXPIRED', () => {
      const payload = { userId: 'user-123', role: 'mentee' };
      const token = jwt.sign(payload, secret, { expiresIn: '-10s' });

      mockReq.headers = {
        authorization: `Bearer ${token}`,
      };

      tokenRefreshMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'TOKEN_EXPIRED',
          error: expect.stringMatching(/expired/i),
        }),
      );
    });

    it('rejects token when time is advanced past expiry using jest.setSystemTime()', () => {
      jest.useFakeTimers();
      const baseTime = new Date('2026-09-24T12:00:00Z');
      jest.setSystemTime(baseTime);

      const payload = { userId: 'user-456', role: 'mentor' };
      const token = jwt.sign(payload, secret, { expiresIn: '15m' });

      // Advance time by 16 minutes (past the 15m expiration)
      jest.setSystemTime(new Date(baseTime.getTime() + 16 * 60 * 1000));

      mockReq.headers = {
        authorization: `Bearer ${token}`,
      };

      tokenRefreshMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'TOKEN_EXPIRED',
          error: expect.stringMatching(/expired/i),
        }),
      );
    });

    it('distinguishes between token expired and token invalid (malformed token)', () => {
      mockReq.headers = {
        authorization: 'Bearer invalid.token.value',
      };

      tokenRefreshMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'TOKEN_INVALID',
          error: expect.stringMatching(/invalid token/i),
        }),
      );
    });

    it('distinguishes between token expired and token invalid (missing token)', () => {
      mockReq.headers = {};

      tokenRefreshMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'TOKEN_INVALID',
          error: expect.stringMatching(/no token provided/i),
        }),
      );
    });
  });

  describe('handleTokenRefresh (POST /auth/refresh)', () => {
    it('requires a refresh token in the body', async () => {
      mockReq.body = {};

      await handleTokenRefresh(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('calls TokenService.rotateRefreshToken when refresh token is provided', async () => {
      mockReq.body = { refreshToken: 'valid-refresh-token' };
      (TokenService.rotateRefreshToken as jest.Mock).mockResolvedValueOnce({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      await handleTokenRefresh(mockReq as Request, mockRes as Response, mockNext);

      expect(TokenService.rotateRefreshToken).toHaveBeenCalledWith(
        'valid-refresh-token',
        undefined,
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });
});
