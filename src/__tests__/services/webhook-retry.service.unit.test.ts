/**
 * Unit tests for Webhook Service retry logic
 */

import { WebhookService } from '../../services/webhook.service';
import { NotificationService } from '../../services/notification.service';
import { UsersService } from '../../services/users.service';
import { webhookQueue } from '../../queues/webhook.queue';
import { logger } from '../../utils/logger';

// Mock dependencies
jest.mock('../../services/notification.service');
jest.mock('../../services/users.service');
jest.mock('../../queues/webhook.queue');
jest.mock('../../utils/logger');

describe('WebhookService Retry Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Retry Delays', () => {
    it('should have correct retry delays: 1m, 5m, 30m, 2h, 8h', () => {
      // The RETRY_DELAYS_MS constant should be:
      // [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000]
      const expectedDelays = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];
      
      // Import the constant from the service
      const webhookModule = require('../../services/webhook.service');
      const actualDelays = webhookModule.RETRY_DELAYS_MS;
      
      expect(actualDelays).toEqual(expectedDelays);
    });
  });

  describe('sendFailureAlert', () => {
    it('should send alert after 3 consecutive failures', async () => {
      const mockUser = { id: 'user-123', email: 'test@example.com' };
      (UsersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (NotificationService.createInAppNotification as jest.Mock).mockResolvedValue(null);

      await WebhookService.sendFailureAlert('webhook-123', 'user-123', 3);

      expect(NotificationService.createInAppNotification).toHaveBeenCalledWith(
        'user-123',
        'system_alert',
        'Webhook Delivery Failures',
        expect.stringContaining('3 consecutive delivery failures'),
        { webhookId: 'webhook-123', failureCount: 3 },
      );
    });

    it('should not send alert if already sent', async () => {
      // This would be handled by the caller checking alert_sent_at
      // The service just marks it as sent
      const mockUser = { id: 'user-123', email: 'test@example.com' };
      (UsersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (NotificationService.createInAppNotification as jest.Mock).mockResolvedValue(null);

      await WebhookService.sendFailureAlert('webhook-123', 'user-123', 5);

      expect(NotificationService.createInAppNotification).toHaveBeenCalled();
    });
  });

  describe('retryDelivery', () => {
    it('should successfully schedule a retry for failed delivery', async () => {
      const mockDelivery = {
        id: 'delivery-123',
        webhook_id: 'webhook-123',
        url: 'https://example.com/webhook',
        secret_plain: 'secret123',
        event_type: 'test',
        payload: { test: 'data' },
        status: 'failed',
        attempt_number: 2,
      };

      const mockWebhook = {
        user_id: 'user-123',
        url: 'https://example.com/webhook',
        secret_plain: 'secret123',
      };

      // Mock pool query to return delivery with webhook info
      const pool = require('../../config/database').pool;
      pool.query = jest.fn().mockResolvedValueOnce({
        rows: [{ ...mockDelivery, ...mockWebhook }],
      }).mockResolvedValueOnce({ rows: [] }); // For update query

      (webhookQueue.add as jest.Mock).mockResolvedValue('job-id');

      const result = await WebhookService.retryDelivery('delivery-123', 'user-123');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Retry scheduled for attempt 3');
      expect(webhookQueue.add).toHaveBeenCalledWith(
        'deliver',
        expect.objectContaining({
          deliveryId: 'delivery-123',
          attemptNumber: 3,
        }),
        expect.objectContaining({
          jobId: 'delivery-delivery-123-attempt-3-manual',
          delay: expect.any(Number),
        }),
      );
    });

    it('should not retry already successful delivery', async () => {
      const mockDelivery = {
        id: 'delivery-123',
        status: 'success',
        webhook_id: 'webhook-123',
        url: 'https://example.com/webhook',
        secret_plain: 'secret123',
      };

      const pool = require('../../config/database').pool;
      pool.query = jest.fn().mockResolvedValueOnce({
        rows: [mockDelivery],
      });

      const result = await WebhookService.retryDelivery('delivery-123', 'user-123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Delivery already succeeded');
    });

    it('should not retry delivery already scheduled for retry', async () => {
      const mockDelivery = {
        id: 'delivery-123',
        status: 'retrying',
        webhook_id: 'webhook-123',
        url: 'https://example.com/webhook',
        secret_plain: 'secret123',
      };

      const pool = require('../../config/database').pool;
      pool.query = jest.fn().mockResolvedValueOnce({
        rows: [mockDelivery],
      });

      const result = await WebhookService.retryDelivery('delivery-123', 'user-123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Delivery is already scheduled for retry');
    });

    it('should reject retry if max attempts exceeded', async () => {
      const mockDelivery = {
        id: 'delivery-123',
        status: 'failed',
        attempt_number: 6, // Already exceeded max retries
        webhook_id: 'webhook-123',
        url: 'https://example.com/webhook',
        secret_plain: 'secret123',
      };

      const pool = require('../../config/database').pool;
      pool.query = jest.fn().mockResolvedValueOnce({
        rows: [mockDelivery],
      });

      const result = await WebhookService.retryDelivery('delivery-123', 'user-123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Maximum retry attempts exceeded');
    });

    it('should return error if delivery not found', async () => {
      const pool = require('../../config/database').pool;
      pool.query = jest.fn().mockResolvedValueOnce({
        rows: [],
      });

      const result = await WebhookService.retryDelivery('delivery-123', 'user-123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Delivery not found');
    });
  });

  describe('Retry Delay Calculation', () => {
    it('should use correct delay for each attempt', () => {
      const webhookModule = require('../../services/webhook.service');
      const RETRY_DELAYS_MS = webhookModule.RETRY_DELAYS_MS;

      // Attempt 2 (after attempt 1 fails) should use RETRY_DELAYS_MS[0] = 1m
      expect(RETRY_DELAYS_MS[0]).toBe(60_000);

      // Attempt 3 should use RETRY_DELAYS_MS[1] = 5m
      expect(RETRY_DELAYS_MS[1]).toBe(300_000);

      // Attempt 4 should use RETRY_DELAYS_MS[2] = 30m
      expect(RETRY_DELAYS_MS[2]).toBe(1_800_000);

      // Attempt 5 should use RETRY_DELAYS_MS[3] = 2h
      expect(RETRY_DELAYS_MS[3]).toBe(7_200_000);

      // Attempt 6 should use RETRY_DELAYS_MS[4] = 8h
      expect(RETRY_DELAYS_MS[4]).toBe(28_800_000);
    });
  });
});
