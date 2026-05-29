import { PushService } from '../push.service';
import { PushTokensModel } from '../../models/push-tokens.model';
import { NotificationPreferencesModel } from '../../models/notification-preferences.model';
import * as admin from 'firebase-admin';

// Mock Firebase Admin
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(),
  },
  messaging: jest.fn(() => ({
    sendEachForMulticast: jest.fn(),
  })),
}));

// Mock models
jest.mock('../../models/push-tokens.model');
jest.mock('../../models/notification-preferences.model');

describe('PushService', () => {
  const mockUserId = 'user-123';
  const mockToken = 'fcm-token-abc123';

  beforeEach(() => {
    jest.clearAllMocks();
    // Set initialized to true for tests
    PushService.initialized = true;
  });

  describe('sendToUser', () => {
    it('should send push notification successfully', async () => {
      // Mock preferences
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: true,
      });

      // Mock tokens
      const mockTokens = [
        { id: '1', token: mockToken, user_id: mockUserId, is_active: true },
      ];
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue(mockTokens);

      // Mock Firebase response
      const mockMessaging = {
        sendEachForMulticast: jest.fn().mockResolvedValue({
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true }],
        }),
      };
      (admin.messaging as jest.Mock).mockReturnValue(mockMessaging);

      // Mock updateLastUsed
      (PushTokensModel.updateLastUsed as jest.Mock).mockResolvedValue(true);

      const result = await PushService.sendToUser(
        mockUserId,
        'Test Title',
        'Test Body',
        { key: 'value' }
      );

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(0);
      expect(result.invalidTokens).toHaveLength(0);
      expect(PushTokensModel.updateLastUsed).toHaveBeenCalledWith(mockToken);
    });

    it('should not send if user has disabled push notifications', async () => {
      // Mock preferences with push disabled
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: false,
      });

      const result = await PushService.sendToUser(
        mockUserId,
        'Test Title',
        'Test Body'
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('User has disabled push notifications');
      expect(PushTokensModel.getActiveTokensByUserId).not.toHaveBeenCalled();
    });

    it('should handle no active tokens', async () => {
      // Mock preferences
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: true,
      });

      // Mock no tokens
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue([]);

      const result = await PushService.sendToUser(
        mockUserId,
        'Test Title',
        'Test Body'
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('No active push tokens found for user');
    });

    it('should handle invalid tokens and mark them inactive', async () => {
      // Mock preferences
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: true,
      });

      // Mock tokens
      const mockTokens = [
        { id: '1', token: 'invalid-token', user_id: mockUserId, is_active: true },
      ];
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue(mockTokens);

      // Mock Firebase response with invalid token error
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

      // Mock markTokenInactive
      (PushTokensModel.markTokenInactive as jest.Mock).mockResolvedValue(true);

      const result = await PushService.sendToUser(
        mockUserId,
        'Test Title',
        'Test Body'
      );

      expect(result.success).toBe(false);
      expect(result.invalidTokens).toContain('invalid-token');
      expect(PushTokensModel.markTokenInactive).toHaveBeenCalledWith('invalid-token');
    });

    it('should send to multiple devices', async () => {
      // Mock preferences
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: true,
      });

      // Mock multiple tokens
      const mockTokens = [
        { id: '1', token: 'token-1', user_id: mockUserId, is_active: true },
        { id: '2', token: 'token-2', user_id: mockUserId, is_active: true },
      ];
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue(mockTokens);

      // Mock Firebase response
      const mockMessaging = {
        sendEachForMulticast: jest.fn().mockResolvedValue({
          successCount: 2,
          failureCount: 0,
          responses: [{ success: true }, { success: true }],
        }),
      };
      (admin.messaging as jest.Mock).mockReturnValue(mockMessaging);

      // Mock updateLastUsed
      (PushTokensModel.updateLastUsed as jest.Mock).mockResolvedValue(true);

      const result = await PushService.sendToUser(
        mockUserId,
        'Test Title',
        'Test Body'
      );

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(2);
      expect(PushTokensModel.updateLastUsed).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendSessionReminder', () => {
    it('should send session reminder with correct format', async () => {
      const sessionDetails = {
        mentorName: 'John Doe',
        scheduledAt: new Date('2026-03-27T10:00:00Z'),
        durationMinutes: 60,
        bookingId: 'booking-123',
      };

      // Mock preferences and tokens
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: true,
      });
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue([
        { id: '1', token: mockToken, user_id: mockUserId, is_active: true },
      ]);

      // Mock Firebase response
      const mockMessaging = {
        sendEachForMulticast: jest.fn().mockResolvedValue({
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true }],
        }),
      };
      (admin.messaging as jest.Mock).mockReturnValue(mockMessaging);
      (PushTokensModel.updateLastUsed as jest.Mock).mockResolvedValue(true);

      const result = await PushService.sendSessionReminder(mockUserId, sessionDetails);

      expect(result.success).toBe(true);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          notification: expect.objectContaining({
            title: 'Session Starting Soon',
            body: 'Your session with John Doe starts in 15 minutes',
          }),
          data: expect.objectContaining({
            type: 'session_reminder',
            bookingId: 'booking-123',
          }),
        })
      );
    });
  });

  describe('sendPaymentConfirmed', () => {
    it('should send payment confirmation with correct format', async () => {
      const paymentDetails = {
        amount: '100.50',
        transactionId: 'tx-123',
      };

      // Mock preferences and tokens
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: true,
      });
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue([
        { id: '1', token: mockToken, user_id: mockUserId, is_active: true },
      ]);

      // Mock Firebase response
      const mockMessaging = {
        sendEachForMulticast: jest.fn().mockResolvedValue({
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true }],
        }),
      };
      (admin.messaging as jest.Mock).mockReturnValue(mockMessaging);
      (PushTokensModel.updateLastUsed as jest.Mock).mockResolvedValue(true);

      const result = await PushService.sendPaymentConfirmed(mockUserId, paymentDetails);

      expect(result.success).toBe(true);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          notification: expect.objectContaining({
            title: 'Payment Confirmed',
            body: 'Your payment of 100.50 XLM has been confirmed',
          }),
          data: expect.objectContaining({
            type: 'payment_confirmed',
            transactionId: 'tx-123',
          }),
        })
      );
    });
  });

  describe('sendNewMessage', () => {
    it('should send new message notification with correct format', async () => {
      const messageDetails = {
        senderName: 'Jane Smith',
        messagePreview: 'Hey, are you available tomorrow?',
        conversationId: 'conv-123',
      };

      // Mock preferences and tokens
      (NotificationPreferencesModel.getByUserId as jest.Mock).mockResolvedValue({
        push_enabled: true,
      });
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue([
        { id: '1', token: mockToken, user_id: mockUserId, is_active: true },
      ]);

      // Mock Firebase response
      const mockMessaging = {
        sendEachForMulticast: jest.fn().mockResolvedValue({
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true }],
        }),
      };
      (admin.messaging as jest.Mock).mockReturnValue(mockMessaging);
      (PushTokensModel.updateLastUsed as jest.Mock).mockResolvedValue(true);

      const result = await PushService.sendNewMessage(mockUserId, messageDetails);

      expect(result.success).toBe(true);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          notification: expect.objectContaining({
            title: 'New message from Jane Smith',
            body: 'Hey, are you available tomorrow?',
          }),
          data: expect.objectContaining({
            type: 'new_message',
            conversationId: 'conv-123',
          }),
        })
      );
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

  describe('sendToTokens', () => {
    it('should return error if Firebase not initialized', async () => {
      PushService.initialized = false;

      const result = await PushService.sendToTokens([mockToken], {
        title: 'Test',
        body: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Firebase not initialized');
    });

    it('should return error if no tokens provided', async () => {
      const result = await PushService.sendToTokens([], {
        title: 'Test',
        body: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('No tokens provided');
    });

    it('should handle mixed success and failure responses', async () => {
      const tokens = ['valid-token', 'invalid-token'];

      const mockMessaging = {
        sendEachForMulticast: jest.fn().mockResolvedValue({
          successCount: 1,
          failureCount: 1,
          responses: [
            { success: true },
            {
              success: false,
              error: {
                code: 'messaging/registration-token-not-registered',
                message: 'Token not registered',
              },
            },
          ],
        }),
      };
      (admin.messaging as jest.Mock).mockReturnValue(mockMessaging);

      const result = await PushService.sendToTokens(tokens, {
        title: 'Test',
        body: 'Test body',
      });

      expect(result.success).toBe(false);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.invalidTokens).toContain('invalid-token');
    });
  });
});
