import { NotificationsModel, NotificationInput, NotificationType, NotificationChannel, NotificationPriority } from '../models/notifications.model';
import { NotificationPreferencesModel } from '../models/notification-preferences.model';
import { NotificationDeliveryTrackingModel, DeliveryStatus } from '../models/notification-delivery-tracking.model';
import { NotificationAnalyticsModel } from '../models/notification-analytics.model';
import { enqueueEmail } from '../queues/email.queue';
import { SocketService } from './socket.service';
import { logger } from '../utils/logger';

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: string;
  channel: string;
  priority: string;
  title: string;
  message: string;
  template_id?: string;
  template_data: Record<string, any>;
  data: Record<string, any>;
  is_read: boolean;
  scheduled_at?: Date;
  expires_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface EmailNotification {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

export interface NotificationRequest {
  userId: string;
  type: NotificationType;
  channels: NotificationChannel[];
  templateId?: string;
  templateData?: Record<string, any>;
  data?: Record<string, any>;
  priority?: NotificationPriority;
  scheduledAt?: Date;
  expiresAt?: Date;
  title?: string;
  message?: string;
}

export interface NotificationResult {
  success: boolean;
  notificationIds: string[];
  errors: string[];
}

export interface NotificationStatus {
  id: string;
  status: DeliveryStatus;
  channel: string;
  createdAt: Date;
  deliveryHistory: any[];
}

export interface BatchNotificationRequest {
  requests: NotificationRequest[];
  batchOptions?: {
    maxBatchSize?: number;
    delayBetweenBatches?: number;
  };
}

export interface BatchNotificationResult {
  success: boolean;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  results: NotificationResult[];
  errors: string[];
}

/**
 * Enhanced Notification Service - Handles multi-channel notifications with advanced features
 */
export const NotificationService = {
  /**
   * Send notification through multiple channels based on request
   */
  async sendNotification(request: NotificationRequest): Promise<NotificationResult> {
    const result: NotificationResult = {
      success: true,
      notificationIds: [],
      errors: [],
    };

    try {
      // Get user preferences to filter channels
      const preferences = await this.getUserPreferences(request.userId);
      const allowedChannels = this.filterChannelsByPreferences(request.channels, preferences, request.type);

      // Create notifications for each allowed channel
      for (const channel of allowedChannels) {
        try {
          const notification = await this.createNotification({
            user_id: request.userId,
            type: request.type,
            channel,
            priority: request.priority || NotificationPriority.NORMAL,
            title: request.title || this.getDefaultTitle(request.type),
            message: request.message || this.getDefaultMessage(request.type),
            template_id: request.templateId,
            template_data: request.templateData,
            data: request.data,
            scheduled_at: request.scheduledAt,
            expires_at: request.expiresAt,
          });

          if (notification) {
            result.notificationIds.push(notification.id);
            
            // Track delivery attempt
            await NotificationDeliveryTrackingModel.create({
              notification_id: notification.id,
              status: request.scheduledAt ? DeliveryStatus.QUEUED : DeliveryStatus.PROCESSING,
              channel,
            });

            // Update analytics
            await this.updateAnalytics(request.type, channel, 'sent');
          }
        } catch (error) {
          result.errors.push(`Failed to create ${channel} notification: ${error instanceof Error ? error.message : 'Unknown error'}`);
          result.success = false;
        }
      }

      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to send notification: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    }
  },

  /**
   * Create a notification record in the database
   */
  async createNotification(input: NotificationInput): Promise<NotificationRecord | null> {
    const notification = await NotificationsModel.create(input);

    if (notification) {
      // Emit notification:new event to the user via WebSocket
      try {
        SocketService.emitToUser(notification.user_id, 'notification:new', {
          notificationId: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          data: notification.data,
          createdAt: notification.created_at,
        });
      } catch (error) {
        logger.error('Failed to emit notification:new event', { error, notificationId: notification.id });
      }
    }

    return notification;
  },

  /**
   * Create a notification using simplified parameters (backward compatibility)
   * @param userId - User ID to send notification to
   * @param type - Notification type (e.g., 'session_booked', 'payment_received')
   * @param payload - Object containing title, message, and optional data
   */
  async create(
    userId: string,
    type: string,
    payload: { title: string; message: string; data?: Record<string, any> }
  ): Promise<NotificationRecord | null> {
    return this.createNotification({
      user_id: userId,
      type,
      channel: NotificationChannel.IN_APP,
      priority: NotificationPriority.NORMAL,
      title: payload.title,
      message: payload.message,
      data: payload.data || {},
    });
  },

  /**
   * Create an in-app notification for a user (backward compatibility)
   */
  async createInAppNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    data: Record<string, unknown> = {}
  ): Promise<NotificationRecord> {
    const notification = await this.createNotification({
      user_id: userId,
      type,
      channel: NotificationChannel.IN_APP,
      priority: NotificationPriority.NORMAL,
      title,
      message,
      data: data as Record<string, any>,
    });

    if (!notification) {
      throw new Error('Failed to create in-app notification');
    }

    return notification;
  },

  /**
   * Send email notification via the email queue (processed by email worker → EmailService).
   */
  async sendEmail(notification: EmailNotification): Promise<boolean> {
    try {
      await enqueueEmail({
        to: [notification.to],
        subject: notification.subject,
        htmlContent: notification.html || notification.body.replace(/\n/g, '<br>'),
        textContent: notification.body,
      });
      return true;
    } catch (error) {
      console.error('Failed to enqueue email:', error);
      return false;
    }
  },

  /**
   * Send meeting URL notification to both mentor and mentee
   */
  async sendMeetingUrlNotification(
    mentorId: string,
    menteeId: string,
    mentorEmail: string,
    menteeEmail: string,
    mentorName: string,
    menteeName: string,
    meetingUrl: string,
    scheduledAt: Date,
    durationMinutes: number,
    expiresAt: Date
  ): Promise<void> {
    const sessionTime = scheduledAt.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    const expiryTime = expiresAt.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });

    // Email content
    const emailSubject = 'Your MentorMinds Session Meeting Link';
    const emailBody = `
Hello {NAME},

Your mentorship session has been confirmed! Here are your meeting details:

📅 Date & Time: ${sessionTime}
⏱️ Duration: ${durationMinutes} minutes
🔗 Meeting Link: ${meetingUrl}

⚠️ Important: This meeting room will expire at ${expiryTime} (30 minutes after your session ends).

Please join the meeting a few minutes early to ensure everything is working properly.

Best regards,
The MentorMinds Team
    `.trim();

    const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #4A90E2;">Your MentorMinds Session is Confirmed!</h2>
  
  <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <h3 style="margin-top: 0;">Meeting Details</h3>
    <p><strong>📅 Date & Time:</strong> ${sessionTime}</p>
    <p><strong>⏱️ Duration:</strong> ${durationMinutes} minutes</p>
    <p><strong>🔗 Join Meeting:</strong> <a href="${meetingUrl}" style="color: #4A90E2;">${meetingUrl}</a></p>
  </div>

  <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
    <p style="margin: 0;"><strong>⚠️ Important:</strong> This meeting room will expire at <strong>${expiryTime}</strong> (30 minutes after your session ends).</p>
  </div>

  <p style="margin-top: 20px;">Please join the meeting a few minutes early to ensure everything is working properly.</p>
  
  <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;" />
  <p style="color: #666; font-size: 14px;">Best regards,<br>The MentorMinds Team</p>
</div>
    `.trim();

    // Send emails to both participants
    await Promise.all([
      this.sendEmail({
        to: mentorEmail,
        subject: emailSubject,
        body: emailBody.replace('{NAME}', mentorName),
        html: htmlBody,
      }),
      this.sendEmail({
        to: menteeEmail,
        subject: emailSubject,
        body: emailBody.replace('{NAME}', menteeName),
        html: htmlBody,
      }),
    ]);

    // Create in-app notifications
    await Promise.all([
      this.createInAppNotification(
        mentorId,
        'meeting_confirmed',
        'Session Meeting Link Available',
        `Your meeting with ${menteeName} has been scheduled. Join link: ${meetingUrl}`,
        { meetingUrl, scheduledAt, expiresAt }
      ),
      this.createInAppNotification(
        menteeId,
        'meeting_confirmed',
        'Session Meeting Link Available',
        `Your meeting with ${mentorName} has been scheduled. Join link: ${meetingUrl}`,
        { meetingUrl, scheduledAt, expiresAt }
      ),
    ]);
  },

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId: string) {
    const preferences = await NotificationPreferencesModel.getByUserId(userId);
    return preferences || NotificationPreferencesModel.getDefaultPreferences();
  },

  /**
   * Filter channels based on user preferences
   */
  filterChannelsByPreferences(
    requestedChannels: NotificationChannel[],
    preferences: any,
    notificationType: string
  ): NotificationChannel[] {
    const allowedChannels: NotificationChannel[] = [];

    for (const channel of requestedChannels) {
      // Check global channel preferences
      if (channel === NotificationChannel.EMAIL && !preferences.email_enabled) {
        continue;
      }
      if (channel === NotificationChannel.IN_APP && !preferences.in_app_enabled) {
        continue;
      }
      if (channel === NotificationChannel.PUSH && !preferences.push_enabled) {
        continue;
      }

      // Check specific notification type preferences
      const typePrefs = preferences.preferences?.[notificationType];
      if (typePrefs) {
        const channelKey = channel.replace('_', '');
        if (typePrefs[channelKey] === false) {
          continue;
        }
      }

      allowedChannels.push(channel);
    }

    return allowedChannels;
  },

  /**
   * Get default title for notification type
   */
  getDefaultTitle(type: string): string {
    const titles: Record<string, string> = {
      [NotificationType.BOOKING_CONFIRMED]: 'Booking Confirmed',
      [NotificationType.PAYMENT_PROCESSED]: 'Payment Processed',
      [NotificationType.SESSION_REMINDER]: 'Session Reminder',
      [NotificationType.DISPUTE_CREATED]: 'Dispute Created',
      [NotificationType.SYSTEM_ALERT]: 'System Alert',
      [NotificationType.MEETING_CONFIRMED]: 'Meeting Confirmed',
      [NotificationType.MESSAGE_RECEIVED]: 'New Message',
      [NotificationType.SESSION_CANCELLED]: 'Session Cancelled',
    };
    return titles[type] || 'Notification';
  },

  /**
   * Get default message for notification type
   */
  getDefaultMessage(type: string): string {
    const messages: Record<string, string> = {
      [NotificationType.BOOKING_CONFIRMED]: 'Your booking has been confirmed.',
      [NotificationType.PAYMENT_PROCESSED]: 'Your payment has been processed successfully.',
      [NotificationType.SESSION_REMINDER]: 'You have an upcoming session.',
      [NotificationType.DISPUTE_CREATED]: 'A dispute has been created.',
      [NotificationType.SYSTEM_ALERT]: 'System notification.',
      [NotificationType.MEETING_CONFIRMED]: 'Your meeting has been confirmed.',
      [NotificationType.MESSAGE_RECEIVED]: 'You have received a new message.',
      [NotificationType.SESSION_CANCELLED]: 'Your session has been cancelled.',
    };
    return messages[type] || 'You have a new notification.';
  },

  /**
   * Update analytics for notification events
   */
  async updateAnalytics(type: string, channel: string, metric: 'sent' | 'delivered' | 'failed' | 'opened' | 'clicked'): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      await NotificationAnalyticsModel.incrementMetric(today, type, channel, metric);
    } catch (error) {
      logger.error('Failed to update notification analytics', { error });
    }
  },

  /**
   * Get notification status with delivery history
   */
  async getNotificationStatus(notificationId: string): Promise<NotificationStatus | null> {
    try {
      const notification = await NotificationsModel.getById(notificationId);
      if (!notification) {
        return null;
      }

      const deliveryHistory = await NotificationDeliveryTrackingModel.getByNotificationId(notificationId);
      const latestStatus = await NotificationDeliveryTrackingModel.getLatestStatus(notificationId);

      return {
        id: notification.id,
        status: latestStatus?.status || DeliveryStatus.QUEUED,
        channel: notification.channel,
        createdAt: notification.created_at,
        deliveryHistory,
      };
    } catch (error) {
      logger.error('Failed to get notification status', { error });
      return null;
    }
  },

  /**
   * Schedule a notification for future delivery
   */
  async scheduleNotification(request: NotificationRequest & { scheduledAt: Date }): Promise<string | null> {
    try {
      const result = await this.sendNotification({
        ...request,
        scheduledAt: request.scheduledAt,
      });

      if (result.success && result.notificationIds.length > 0) {
        return result.notificationIds[0];
      }

      return null;
    } catch (error) {
      logger.error('Failed to schedule notification', { error });
      return null;
    }
  },

  /**
   * Cancel a scheduled notification
   */
  async cancelScheduledNotification(notificationId: string): Promise<boolean> {
    try {
      return await NotificationsModel.delete(notificationId);
    } catch (error) {
      logger.error('Failed to cancel scheduled notification', { error });
      return false;
    }
  },

  /**
   * Retry a failed notification
   */
  async retryFailedNotification(notificationId: string): Promise<boolean> {
    try {
      const notification = await NotificationsModel.getById(notificationId);
      if (!notification) {
        return false;
      }

      // Update delivery tracking
      await NotificationDeliveryTrackingModel.create({
        notification_id: notificationId,
        status: DeliveryStatus.PROCESSING,
        channel: notification.channel,
      });

      // Update analytics
      await this.updateAnalytics(notification.type, notification.channel, 'sent');

      return true;
    } catch (error) {
      logger.error('Failed to retry notification', { error });
      return false;
    }
  },

  /**
   * Get unread notifications for a user (enhanced version)
   */
  async getUnreadNotifications(userId: string): Promise<NotificationRecord[]> {
    return await NotificationsModel.getUnreadByUserId(userId);
  },

  /**
   * Mark notification as read (enhanced version)
   */
  async markAsRead(notificationId: string): Promise<boolean> {
    return await NotificationsModel.markAsRead(notificationId);
  },

  /**
   * Mark all notifications as read for a user (enhanced version)
   */
  async markAllAsRead(userId: string): Promise<number> {
    return await NotificationsModel.markAllAsReadByUserId(userId);
  },

  /**
   * Get notifications for a user with filtering
   */
  async getUserNotifications(
    userId: string,
    options: {
      channel?: string;
      type?: string;
      isRead?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<NotificationRecord[]> {
    return await NotificationsModel.getByUserId(userId, options);
  },

  /**
   * Get notification counts for a user
   */
  async getNotificationCounts(userId: string): Promise<{ total: number; unread: number; read: number }> {
    return await NotificationsModel.getCountsByUserId(userId);
  },

  /**
   * Send batch notifications with processing options
   */
  async sendBatchNotifications(batchRequest: BatchNotificationRequest): Promise<BatchNotificationResult> {
    const result: BatchNotificationResult = {
      success: true,
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      results: [],
      errors: [],
    };

    const { requests, batchOptions } = batchRequest;
    const maxBatchSize = batchOptions?.maxBatchSize || 100;
    const delayBetweenBatches = batchOptions?.delayBetweenBatches || 0;

    try {
      // Process notifications in batches
      for (let i = 0; i < requests.length; i += maxBatchSize) {
        const batch = requests.slice(i, i + maxBatchSize);
        
        // Add delay between batches if specified
        if (i > 0 && delayBetweenBatches > 0) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }

        // Process batch
        const batchPromises = batch.map(request => this.sendNotification(request));
        const batchResults = await Promise.allSettled(batchPromises);

        // Process results
        for (const batchResult of batchResults) {
          result.totalProcessed++;
          
          if (batchResult.status === 'fulfilled') {
            const notificationResult = batchResult.value;
            result.results.push(notificationResult);
            
            if (notificationResult.success) {
              result.successCount++;
            } else {
              result.failureCount++;
              result.errors.push(...notificationResult.errors);
            }
          } else {
            result.failureCount++;
            result.errors.push(`Batch processing failed: ${batchResult.reason}`);
          }
        }
      }

      result.success = result.failureCount === 0;
      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(`Batch processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    }
  },

  /**
   * Validate notification request
   */
  validateNotificationRequest(request: NotificationRequest): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate required fields
    if (!request.userId) {
      errors.push('userId is required');
    }

    if (!request.type) {
      errors.push('type is required');
    }

    if (!request.channels || request.channels.length === 0) {
      errors.push('At least one channel is required');
    }

    // Validate channels
    if (request.channels) {
      const validChannels = Object.values(NotificationChannel);
      for (const channel of request.channels) {
        if (!validChannels.includes(channel)) {
          errors.push(`Invalid channel: ${channel}`);
        }
      }
    }

    // Validate notification type
    if (request.type) {
      const validTypes = Object.values(NotificationType);
      if (!validTypes.includes(request.type)) {
        errors.push(`Invalid notification type: ${request.type}`);
      }
    }

    // Validate priority
    if (request.priority) {
      const validPriorities = Object.values(NotificationPriority);
      if (!validPriorities.includes(request.priority)) {
        errors.push(`Invalid priority: ${request.priority}`);
      }
    }

    // Validate scheduled date
    if (request.scheduledAt && request.scheduledAt <= new Date()) {
      errors.push('scheduledAt must be in the future');
    }

    // Validate expiration date
    if (request.expiresAt && request.scheduledAt && request.expiresAt <= request.scheduledAt) {
      errors.push('expiresAt must be after scheduledAt');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  },

  /**
   * Get scheduled notifications that are ready to be processed
   */
  async getScheduledNotificationsForProcessing(limit: number = 100): Promise<NotificationRecord[]> {
    return await NotificationsModel.getScheduledNotifications(limit);
  },

  /**
   * Process expired notifications cleanup
   */
  async cleanupExpiredNotifications(): Promise<number> {
    try {
      return await NotificationsModel.deleteExpired();
    } catch (error) {
      logger.error('Failed to cleanup expired notifications', { error });
      return 0;
    }
  },

  /**
   * Get delivery statistics for analytics
   */
  async getDeliveryStatistics(
    startDate: Date,
    endDate: Date,
    channel?: string
  ): Promise<{ status: string; count: number }[]> {
    try {
      return await NotificationDeliveryTrackingModel.getDeliveryStats(startDate, endDate, channel);
    } catch (error) {
      logger.error('Failed to get delivery statistics', { error });
      return [];
    }
  },

  /**
   * Get failed notifications for retry processing
   */
  async getFailedNotificationsForRetry(limit: number = 50, olderThan?: Date): Promise<any[]> {
    try {
      return await NotificationDeliveryTrackingModel.getFailedDeliveries(limit, olderThan);
    } catch (error) {
      logger.error('Failed to get failed notifications for retry', { error });
      return [];
    }
  },
};

export default NotificationService;
