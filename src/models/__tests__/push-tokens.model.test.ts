import { PushTokensModel } from '../push-tokens.model';
import pool from '../../config/database';

jest.mock('../../config/database');

describe('PushTokensModel', () => {
  const mockUserId = 'user-123';
  const mockToken = 'fcm-token-abc123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('upsert', () => {
    it('should create new push token', async () => {
      const mockPushToken = {
        id: 'token-id-123',
        user_id: mockUserId,
        token: mockToken,
        device_type: 'web',
        device_id: 'device-123',
        is_active: true,
        last_used_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValue({
        rows: [mockPushToken],
      });

      const result = await PushTokensModel.upsert({
        user_id: mockUserId,
        token: mockToken,
        device_type: 'web',
        device_id: 'device-123',
      });

      expect(result).toEqual(mockPushToken);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO push_tokens'),
        [mockUserId, mockToken, 'web', 'device-123']
      );
    });

    it('should update existing token on conflict', async () => {
      const mockPushToken = {
        id: 'token-id-123',
        user_id: mockUserId,
        token: mockToken,
        device_type: 'android',
        device_id: 'device-456',
        is_active: true,
        last_used_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValue({
        rows: [mockPushToken],
      });

      const result = await PushTokensModel.upsert({
        user_id: mockUserId,
        token: mockToken,
        device_type: 'android',
        device_id: 'device-456',
      });

      expect(result).toEqual(mockPushToken);
    });

    it('should return null on database error', async () => {
      (pool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      const result = await PushTokensModel.upsert({
        user_id: mockUserId,
        token: mockToken,
      });

      expect(result).toBeNull();
    });
  });

  describe('getActiveTokensByUserId', () => {
    it('should return all active tokens for user', async () => {
      const mockTokens = [
        {
          id: 'token-1',
          user_id: mockUserId,
          token: 'token-1',
          device_type: 'web',
          is_active: true,
          last_used_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'token-2',
          user_id: mockUserId,
          token: 'token-2',
          device_type: 'android',
          is_active: true,
          last_used_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (pool.query as jest.Mock).mockResolvedValue({
        rows: mockTokens,
      });

      const result = await PushTokensModel.getActiveTokensByUserId(mockUserId);

      expect(result).toEqual(mockTokens);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND is_active = TRUE'),
        [mockUserId]
      );
    });

    it('should return empty array on error', async () => {
      (pool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      const result = await PushTokensModel.getActiveTokensByUserId(mockUserId);

      expect(result).toEqual([]);
    });
  });

  describe('deleteToken', () => {
    it('should delete token successfully', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
      });

      const result = await PushTokensModel.deleteToken(mockUserId, mockToken);

      expect(result).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM push_tokens'),
        [mockUserId, mockToken]
      );
    });

    it('should return false if token not found', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rowCount: 0,
      });

      const result = await PushTokensModel.deleteToken(mockUserId, mockToken);

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      (pool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      const result = await PushTokensModel.deleteToken(mockUserId, mockToken);

      expect(result).toBe(false);
    });
  });

  describe('markTokenInactive', () => {
    it('should mark token as inactive', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
      });

      const result = await PushTokensModel.markTokenInactive(mockToken);

      expect(result).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SET is_active = FALSE'),
        [mockToken]
      );
    });

    it('should return false if token not found', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rowCount: 0,
      });

      const result = await PushTokensModel.markTokenInactive(mockToken);

      expect(result).toBe(false);
    });
  });

  describe('updateLastUsed', () => {
    it('should update last_used_at timestamp', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
      });

      const result = await PushTokensModel.updateLastUsed(mockToken);

      expect(result).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SET last_used_at = NOW()'),
        [mockToken]
      );
    });
  });

  describe('deleteAllByUserId', () => {
    it('should delete all tokens for user', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rowCount: 3,
      });

      const result = await PushTokensModel.deleteAllByUserId(mockUserId);

      expect(result).toBe(3);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM push_tokens'),
        [mockUserId]
      );
    });
  });

  describe('cleanupInactiveTokens', () => {
    it('should cleanup old inactive tokens', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rowCount: 5,
      });

      const result = await PushTokensModel.cleanupInactiveTokens(30);

      expect(result).toBe(5);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE is_active = FALSE")
      );
    });
  });
});
