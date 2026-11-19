import { TokenService } from '../token.service';
import pool from '../../config/database';
import { JwtUtils } from '../../utils/jwt.utils';
import config from '../../config';
import jwt from 'jsonwebtoken';

jest.mock('../../config/database', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      query: jest.fn(),
      connect: jest.fn(() => Promise.resolve(mClient)),
    },
  };
});

jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  }
}), { virtual: true });

jest.mock('../socket.service', () => ({
  SocketService: {
    emitToUser: jest.fn()
  }
}));

jest.mock('../email.service', () => {
  return {
    EmailService: jest.fn().mockImplementation(() => ({
      sendEmail: jest.fn().mockResolvedValue(true)
    }))
  };
});

jest.mock('../../config', () => {
  return {
    __esModule: true,
    default: {
      jwt: {
        secret: 'a'.repeat(64),
        refreshSecret: 'b'.repeat(64),
        previousSecret: 'c'.repeat(64),
      }
    }
  };
});

describe('TokenService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-25T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('issueTokens', () => {
    it('should return access and refresh tokens and store refresh token in db', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] }); // For enforceSessionLimit
      
      const tokens = await TokenService.issueTokens('user1', 'test@test.com', 'mentee');
      
      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO refresh_tokens'),
        expect.any(Array)
      );
    });
  });

  describe('rotateRefreshToken', () => {
    it('should return new token pair and rotate in db', async () => {
      // Create a valid refresh token
      const oldToken = jwt.sign(
        { userId: 'user1', email: 'test@test.com', role: 'mentee' },
        config.jwt.refreshSecret,
        { expiresIn: '7d', issuer: 'mentorsmind-api', audience: 'mentorsmind-client' }
      );
      
      const oldTokenHash = JwtUtils.hashToken(oldToken);

      // Mock DB finding the token
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'record-1', family_id: 'family-1', token_hash: oldTokenHash, device_fingerprint: null }]
      });

      const client = await (pool as any).connect();
      client.query.mockResolvedValueOnce({}); // BEGIN
      client.query.mockResolvedValueOnce({ rows: [{ id: 'record-2' }] }); // INSERT
      client.query.mockResolvedValueOnce({}); // UPDATE
      client.query.mockResolvedValueOnce({}); // COMMIT

      const newTokens = await TokenService.rotateRefreshToken(oldToken);
      
      expect(newTokens).toHaveProperty('accessToken');
      expect(newTokens).toHaveProperty('refreshToken');
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should reject an expired refresh token', async () => {
      // Create an expired refresh token
      const oldToken = jwt.sign(
        { userId: 'user1', email: 'test@test.com', role: 'mentee' },
        config.jwt.refreshSecret,
        { expiresIn: '-1h', issuer: 'mentorsmind-api', audience: 'mentorsmind-client' }
      );

      await expect(TokenService.rotateRefreshToken(oldToken))
        .rejects
        .toThrow('Invalid refresh token');
    });

    it('should reject a revoked refresh token and detect theft', async () => {
      const oldToken = jwt.sign(
        { userId: 'user1', email: 'test@test.com', role: 'mentee' },
        config.jwt.refreshSecret,
        { expiresIn: '7d', issuer: 'mentorsmind-api', audience: 'mentorsmind-client' }
      );

      // First query returns nothing (not found or revoked)
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      // Second query returns it was used (replaced_by is not null, so it existed)
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ family_id: 'family-1', user_id: 'user1' }]
      });
      // Third query revokes family
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await expect(TokenService.rotateRefreshToken(oldToken))
        .rejects
        .toThrow('Suspicious activity detected. All sessions revoked.');
      
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1'),
        ['family-1']
      );
    });
  });

  describe('JWT Expiry and Dual-Secret Rotation', () => {
    it('should reject an expired access token', () => {
      const token = jwt.sign(
        { userId: 'user1', email: 'test@test.com', role: 'mentee' },
        config.jwt.secret,
        { expiresIn: '-1h', issuer: 'mentorsmind-api', audience: 'mentorsmind-client' }
      );

      expect(() => JwtUtils.verifyAccessToken(token)).toThrow('jwt expired');
    });

    it('should accept a token signed with JWT_SECRET_PREVIOUS', () => {
      // Sign with the previous secret
      const token = jwt.sign(
        { userId: 'user1', email: 'test@test.com', role: 'mentee' },
        config.jwt.previousSecret!,
        { expiresIn: '15m', issuer: 'mentorsmind-api', audience: 'mentorsmind-client' }
      );

      const decoded = JwtUtils.verifyAccessToken(token);
      expect(decoded.userId).toBe('user1');
    });
  });
});
