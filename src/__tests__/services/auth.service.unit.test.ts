import { AuthService } from '../../services/auth.service';
import pool from '../../config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { mockDeep, mockReset } from 'jest-mock-extended';
import { createMockUser } from '../helpers/factories';

// Mock external dependencies
jest.mock('../../config/database');
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('crypto');

const mockPool = pool as jest.Mocked<typeof pool>;
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockJwt = jwt as jest.Mocked<typeof jwt>;
const mockCrypto = crypto as jest.Mocked<typeof crypto>;

describe('AuthService', () => {
  beforeEach(() => {
    mockReset(mockPool);
    mockReset(mockBcrypt);
    mockReset(mockJwt);
    mockReset(mockCrypto);
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const input = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'learner' as const,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // Email check
        .mockResolvedValueOnce({ rows: [{ id: 'user-123', role: 'learner' }] }); // Insert

      mockBcrypt.genSalt.mockResolvedValue('salt');
      mockBcrypt.hash.mockResolvedValue('hashedPassword');

      const mockTokens = { accessToken: 'access', refreshToken: 'refresh' };
      jest.spyOn(AuthService, 'generateTokens').mockResolvedValue(mockTokens);

      const result = await AuthService.register(input);

      expect(result).toEqual({
        ...mockTokens,
        userId: 'user-123',
      });
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should throw error if email already exists', async () => {
      const input = {
        email: 'existing@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'learner' as const,
      };

      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

      await expect(AuthService.register(input)).rejects.toThrow('Email is already registered.');
    });
  });

  describe('login', () => {
    it('should login user successfully', async () => {
      const input = {
        email: 'test@example.com',
        password: 'password123',
      };

      mockPool.query.mockResolvedValue({
        rows: [{ id: 'user-123', role: 'learner', password_hash: 'hashed' }],
      });
      mockBcrypt.compare.mockResolvedValue(true);

      const mockTokens = { accessToken: 'access', refreshToken: 'refresh' };
      jest.spyOn(AuthService, 'generateTokens').mockResolvedValue(mockTokens);

      const result = await AuthService.login(input);

      expect(result).toEqual({
        tokens: mockTokens,
        userId: 'user-123',
        role: 'learner',
      });
    });

    it('should throw error for invalid email', async () => {
      const input = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };

      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(AuthService.login(input)).rejects.toThrow('Invalid email or password.');
    });

    it('should throw error for invalid password', async () => {
      const input = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      mockPool.query.mockResolvedValue({
        rows: [{ id: 'user-123', role: 'learner', password_hash: 'hashed' }],
      });
      mockBcrypt.compare.mockResolvedValue(false);

      await expect(AuthService.login(input)).rejects.toThrow('Invalid email or password.');
    });
  });

  describe('refresh', () => {
    it('should refresh tokens successfully', async () => {
      const refreshToken = 'valid-refresh-token';

      mockJwt.verify.mockReturnValue({ sub: 'user-123', role: 'learner' });
      mockPool.query.mockResolvedValue({
        rows: [{ refresh_token: refreshToken, role: 'learner' }],
      });

      const mockTokens = { accessToken: 'new-access', refreshToken: 'new-refresh' };
      jest.spyOn(AuthService, 'generateTokens').mockResolvedValue(mockTokens);

      const result = await AuthService.refresh(refreshToken);

      expect(result).toEqual(mockTokens);
    });

    it('should throw error for invalid refresh token', async () => {
      const refreshToken = 'invalid-token';

      mockJwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(AuthService.refresh(refreshToken)).rejects.toThrow('Invalid or expired refresh token.');
    });
  });

  describe('logout', () => {
    it('should clear refresh token', async () => {
      const userId = 'user-123';

      mockPool.query.mockResolvedValue({});

      await AuthService.logout(userId);

      expect(mockPool.query).toHaveBeenCalledWith(
        'UPDATE users SET refresh_token = NULL WHERE id = $1',
        [userId]
      );
    });
  });

  describe('forgotPassword', () => {
    it('should generate reset token for existing user', async () => {
      const email = 'test@example.com';

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'user-123' }] })
        .mockResolvedValueOnce({});

      mockCrypto.randomBytes.mockReturnValue(Buffer.from('randombytes'));
      mockCrypto.createHash.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('hashed-token'),
      } as any);

      const result = await AuthService.forgotPassword(email);

      expect(result).toBe('72616e646f6d6279746573'); // hex of 'randombytes'
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should return empty string for non-existent user', async () => {
      const email = 'nonexistent@example.com';

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await AuthService.forgotPassword(email);

      expect(result).toBe('');
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetPassword', () => {
    it('should reset password successfully', async () => {
      const input = {
        token: 'reset-token',
        newPassword: 'newpassword123',
      };

      mockCrypto.createHash.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('hashed-token'),
      } as any);

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'user-123' }] })
        .mockResolvedValueOnce({});

      mockBcrypt.genSalt.mockResolvedValue('salt');
      mockBcrypt.hash.mockResolvedValue('new-hashed-password');

      const result = await AuthService.resetPassword(input);

      expect(result).toBe('user-123');
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should throw error for invalid reset token', async () => {
      const input = {
        token: 'invalid-token',
        newPassword: 'newpassword123',
      };

      mockCrypto.createHash.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('hashed-token'),
      } as any);

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(AuthService.resetPassword(input)).rejects.toThrow('Invalid or expired reset token.');
    });
  });

  describe('generateTokens', () => {
    it('should generate and save tokens', async () => {
      const userId = 'user-123';
      const role = 'learner';

      mockJwt.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      mockPool.query.mockResolvedValue({});

      const result = await AuthService.generateTokens(userId, role);

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(mockJwt.sign).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        'UPDATE users SET refresh_token = $1 WHERE id = $2',
        ['refresh-token', userId]
      );
    });
  });
});