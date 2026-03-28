/**
 * Unit tests for PushService (without database dependencies)
 */

// Mock all dependencies before imports
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(),
  },
  messaging: jest.fn(() => ({
    sendEachForMulticast: jest.fn(),
  })),
}));

jest.mock('../../models/push-tokens.model', () => ({
  PushTokensModel: {
    getActiveTokensByUserId: jest.fn(),
    markTokenInactive: jest.fn(),
    updateLastUsed: jest.fn(),
  },
}));

jest.mock('../../services/users.service', () => ({
  UsersService: {
    findById: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../../config/env', () => ({
  env: {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_PRIVATE_KEY: 'test-key',
    FIREBASE_CLIENT_EMAIL: 'test@test.com',
    NODE_ENV: 'test',
  },
}));

import { PushService } from '../push.service';
import { PushTokensModel } from '../../models/push-tokens.model';
import { UsersService } from '../../services/users.service';
import * as admin from 'firebase-admin';

describe('PushService - Unit Tests', () => {
  const mockUserId = 'user-123';
  const mockToken = 'fcm-token-abc123';

  beforeEach(() => {
    jest.clearAllMocks();
    PushService.initialized = true;
  });

  describe('sendToUser', () => {
    it('should send push notification successfully', async () => {
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: true,
      });

      const mockTokens = [
        { id: '1', token: mockToken, user_id: mockUserId, is_active: true },
      ];
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue(mockTokens);

      const mockMessaging = {
        sendEachForMulticast: jest.fn().mockResolvedValue({
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true }],
        }),
      };
      (admin.messaging as jest.Mock).mockReturnValue(mockMessaging);
      (PushTokensModel.updateLastUsed as jest.Mock).mockResolvedValue(true);

      const result = await PushService.sendToUser(
        mockUserId,
        'Test Title',
        'Test Body',
        { type: 'test_type', key: 'value' }
      );

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(0);
      expect(result.invalidTokens).toHaveLength(0);
      expect(PushTokensModel.updateLastUsed).toHaveBeenCalledWith(mockToken);
    });

    it('should not send if user has disabled push notifications for the type', async () => {
      (UsersService.findById as jest.Mock).mockResolvedValue({
        id: mockUserId,
        notification_preferences: {
          test_type: { push: false },
        },
      });

      const result = await PushService.sendToUser(
        mockUserId,
        'Test Title',
        'Test Body',
        { type: 'test_type' }
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('User has disabled push notifications for type: test_type');
      expect(PushTokensModel.getActiveTokensByUserId).not.toHaveBeenCalled();
    });

    it('should handle invalid tokens and mark them inactive', async () => {
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: true,
      });

      const mockTokens = [
        { id: '1', token: 'invalid-token', user_id: mockUserId, is_active: true },
      ];
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue(mockTokens);

      const mockMessaging = {
        sendEachForMulticast: jest.fn().mockResolvedValue({
          successCount: 0,
          failureCount: 1,
          responses: [
            {
              success: false,
              error: {
                code: 'messaging/invalid-registration-token',
                message: 'Invalid token',
              },
            },
          ],
        }),
      };
      (admin.messaging as jest.Mock).mockReturnValue(mockMessaging);
      (PushTokensModel.markTokenInactive as jest.Mock).mockResolvedValue(true);

      const result = await PushService.sendToUser(
        mockUserId,
        'Test Title',
        'Test Body',
        { type: 'test_type' }
      );

      expect(result.success).toBe(false);
      expect(result.invalidTokens).toContain('invalid-token');
      expect(PushTokensModel.markTokenInactive).toHaveBeenCalledWith('invalid-token');
    });
  });

  describe('handleInvalidTokens', () => {
    it('should mark multiple invalid tokens as inactive', async () => {
      const invalidTokens = ['token-1', 'token-2', 'token-3'];
      (PushTokensModel.markTokenInactive as jest.Mock).mockResolvedValue(true);

      await PushService.handleInvalidTokens(invalidTokens);

      expect(PushTokensModel.markTokenInactive).toHaveBeenCalledTimes(3);
      expect(PushTokensModel.markTokenInactive).toHaveBeenCalledWith('token-1');
      expect(PushTokensModel.markTokenInactive).toHaveBeenCalledWith('token-2');
      expect(PushTokensModel.markTokenInactive).toHaveBeenCalledWith('token-3');
    });

    it('should handle empty token array', async () => {
      await PushService.handleInvalidTokens([]);

      expect(PushTokensModel.markTokenInactive).not.toHaveBeenCalled();
    });
  });
});
