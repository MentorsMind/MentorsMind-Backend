/**
 * Unit tests for PushController (without database dependencies)
 */

// Mock dependencies before imports
jest.mock('../../models/push-tokens.model', () => ({
  PushTokensModel: {
    upsert: jest.fn(),
    deleteToken: jest.fn(),
    getActiveTokensByUserId: jest.fn(),
  },
}));

jest.mock('../../services/push.service', () => ({
  PushService: {
    sendTestNotification: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

import { Request, Response, NextFunction } from 'express';
import { PushController } from '../push.controller';
import { PushTokensModel } from '../../models/push-tokens.model';
import { PushService } from '../../services/push.service';

describe('PushController - Unit Tests', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
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
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          data: {
            message: 'Successfully subscribed to push notifications',
            tokenId: 'token-id-123',
          },
        })
      );
    });

    it('should return 400 if token is missing', async () => {
      mockReq.body = {};

      await PushController.subscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          message: 'Invalid input: expected string, received undefined',
        })
      );
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
    });

    it('should return 404 if token not found', async () => {
      mockReq.body = {
        token: 'non-existent-token',
      };

      (PushTokensModel.deleteToken as jest.Mock).mockResolvedValue(false);

      await PushController.unsubscribe(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
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
    });
  });
});
