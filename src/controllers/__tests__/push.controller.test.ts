import { Request, Response } from 'express';
import { PushController } from '../push.controller';
import { PushTokensModel } from '../../models/push-tokens.model';
import { PushService } from '../../services/push.service';

// Mock dependencies
jest.mock('../../models/push-tokens.model');
jest.mock('../../services/push.service');

describe('PushController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockNext = jest.fn();

    mockReq = {
      body: {},
      params: {},
      user: { id: 'user-123' },
    } as any;

    mockRes = {
      status: statusMock,
      json: jsonMock,
    };

    jest.clearAllMocks();
  });

  describe('subscribe', () => {
    it('should subscribe to push notifications successfully', async () => {
      mockReq.body = {
        token: 'fcm-token-abc123',
        deviceType: 'web',
        deviceId: 'device-123',
      };

      const mockPushToken = {
        id: 'token-id-123',
        user_id: 'user-123',
        token: 'fcm-token-abc123',
        device_type: 'web',
        device_id: 'device-123',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (PushTokensModel.upsert as jest.Mock).mockResolvedValue(mockPushToken);

      await PushController.subscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(PushTokensModel.upsert).toHaveBeenCalledWith({
        user_id: 'user-123',
        token: 'fcm-token-abc123',
        device_type: 'web',
        device_id: 'device-123',
      });

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'success',
        data: {
          message: 'Successfully subscribed to push notifications',
          tokenId: 'token-id-123',
        },
      });
    });

    it('should return 401 if user not authenticated', async () => {
      (mockReq as any).user = undefined;

      await PushController.subscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Unauthorized',
      });
    });

    it('should return 400 if token is missing', async () => {
      mockReq.body = {};

      await PushController.subscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'FCM token is required',
      });
    });

    it('should return 500 if database operation fails', async () => {
      mockReq.body = {
        token: 'fcm-token-abc123',
      };

      (PushTokensModel.upsert as jest.Mock).mockResolvedValue(null);

      await PushController.subscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Failed to save push token',
      });
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from push notifications successfully', async () => {
      mockReq.body = {
        token: 'fcm-token-abc123',
      };

      (PushTokensModel.deleteToken as jest.Mock).mockResolvedValue(true);

      await PushController.unsubscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(PushTokensModel.deleteToken).toHaveBeenCalledWith('user-123', 'fcm-token-abc123');

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'success',
        data: {
          message: 'Successfully unsubscribed from push notifications',
        },
      });
    });

    it('should return 401 if user not authenticated', async () => {
      (mockReq as any).user = undefined;

      await PushController.unsubscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should return 400 if token is missing', async () => {
      mockReq.body = {};

      await PushController.unsubscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'FCM token is required',
      });
    });

    it('should return 404 if token not found', async () => {
      mockReq.body = {
        token: 'non-existent-token',
      };

      (PushTokensModel.deleteToken as jest.Mock).mockResolvedValue(false);

      await PushController.unsubscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Token not found or already removed',
      });
    });
  });

  describe('getTokens', () => {
    it('should return all active tokens for user', async () => {
      const mockTokens = [
        {
          id: 'token-1',
          user_id: 'user-123',
          token: 'fcm-token-1',
          device_type: 'web',
          device_id: 'device-1',
          is_active: true,
          last_used_at: new Date('2026-03-26T10:00:00Z'),
          created_at: new Date('2026-03-20T10:00:00Z'),
          updated_at: new Date('2026-03-26T10:00:00Z'),
        },
        {
          id: 'token-2',
          user_id: 'user-123',
          token: 'fcm-token-2',
          device_type: 'android',
          device_id: 'device-2',
          is_active: true,
          last_used_at: new Date('2026-03-25T10:00:00Z'),
          created_at: new Date('2026-03-21T10:00:00Z'),
          updated_at: new Date('2026-03-25T10:00:00Z'),
        },
      ];

      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue(mockTokens);

      await PushController.getTokens(mockReq as Request, mockRes as Response, mockNext);

      expect(PushTokensModel.getActiveTokensByUserId).toHaveBeenCalledWith('user-123');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'success',
        data: {
          tokens: [
            {
              id: 'token-1',
              deviceType: 'web',
              deviceId: 'device-1',
              lastUsedAt: mockTokens[0].last_used_at,
              createdAt: mockTokens[0].created_at,
            },
            {
              id: 'token-2',
              deviceType: 'android',
              deviceId: 'device-2',
              lastUsedAt: mockTokens[1].last_used_at,
              createdAt: mockTokens[1].created_at,
            },
          ],
        },
      });
    });
  });

  describe('sendTest', () => {
    it('should send test notification successfully', async () => {
      const mockResult = {
        success: true,
        successCount: 1,
        failureCount: 0,
        invalidTokens: [],
        errors: [],
      };

      (PushService.sendTestNotification as jest.Mock).mockResolvedValue(mockResult);

      await PushController.sendTest(mockReq as Request, mockRes as Response, mockNext);

      expect(PushService.sendTestNotification).toHaveBeenCalledWith('user-123');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'success',
        data: {
          message: 'Test notification sent',
          successCount: 1,
          failureCount: 0,
        },
      });
    });

    it('should return 500 if test notification fails', async () => {
      const mockResult = {
        success: false,
        successCount: 0,
        failureCount: 1,
        invalidTokens: [],
        errors: ['Firebase not initialized'],
      };

      (PushService.sendTestNotification as jest.Mock).mockResolvedValue(mockResult);

      await PushController.sendTest(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        status: 'error',
        message: 'Firebase not initialized',
      });
    });
  });
});
