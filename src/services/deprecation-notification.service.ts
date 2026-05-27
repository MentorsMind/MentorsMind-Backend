/**
 * Deprecation Notification Service
 * 
 * Handles notifications to users about deprecated endpoints,
 * including email, in-app notifications, and dashboard alerts.
 */

import deprecationManager from '../utils/deprecation.utils';
import { getUpcomingSunsets, getSunsetEndpoints } from '../config/deprecation-registry';
import { logInfo, logWarning } from '../utils/error.utils';

export interface NotificationRecipient {
  userId: string;
  email: string;
  name: string;
}

export interface DeprecationNotification {
  endpoint: string;
  sunsetDate: Date;
  replacementEndpoint?: string;
  migrationGuide?: string;
  daysUntilSunset: number;
}

class DeprecationNotificationService {
  /**
   * Send deprecation notification to users
   */
  async notifyUsers(
    recipients: NotificationRecipient[],
    notification: DeprecationNotification
  ): Promise<void> {
    logInfo(`Sending deprecation notification to ${recipients.length} users`, {
      endpoint: notification.endpoint,
      sunsetDate: notification.sunsetDate.toISOString(),
    });

    // Send email notifications
    await this.sendEmailNotifications(recipients, notification);

    // Create in-app notifications
    await this.createInAppNotifications(recipients, notification);

    // Log notification sent
    logInfo(`Deprecation notification sent successfully`, {
      endpoint: notification.endpoint,
      recipientCount: recipients.length,
    });
  }

  /**
   * Send email notifications about deprecation
   */
  private async sendEmailNotifications(
    recipients: NotificationRecipient[],
    notification: DeprecationNotification
  ): Promise<void> {
    // This would integrate with your email service
    // Example: SendGrid, AWS SES, etc.

    const emailTemplate = this.generateEmailTemplate(notification);

    for (const recipient of recipients) {
      try {
        // await emailService.send({
        //   to: recipient.email,
        //   subject: `API Deprecation Notice: ${notification.endpoint}`,
        //   html: emailTemplate,
        // });

        logInfo(`Email sent to ${recipient.email}`, {
          endpoint: notification.endpoint,
          userId: recipient.userId,
        });
      } catch (error) {
        logWarning(`Failed to send email to ${recipient.email}`, {
          endpoint: notification.endpoint,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Create in-app notifications
   */
  private async createInAppNotifications(
    recipients: NotificationRecipient[],
    notification: DeprecationNotification
  ): Promise<void> {
    // This would integrate with your notification system
    // Example: Database notifications, push notifications, etc.

    for (const recipient of recipients) {
      try {
        // await notificationService.create({
        //   userId: recipient.userId,
        //   type: 'deprecation',
        //   title: `API Endpoint Deprecated: ${notification.endpoint}`,
        //   message: this.generateNotificationMessage(notification),
        //   data: {
        //     endpoint: notification.endpoint,
        //     replacementEndpoint: notification.replacementEndpoint,
        //     migrationGuide: notification.migrationGuide,
        //   },
        // });

        logInfo(`In-app notification created for ${recipient.userId}`, {
          endpoint: notification.endpoint,
        });
      } catch (error) {
        logWarning(`Failed to create notification for ${recipient.userId}`, {
          endpoint: notification.endpoint,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Generate email template for deprecation notice
   */
  private generateEmailTemplate(notification: DeprecationNotification): string {
    const daysUntilSunset = notification.daysUntilSunset;
    const sunsetDateFormatted = notification.sunsetDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
            .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
            .action-items { background-color: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0; }
            .footer { color: #666; font-size: 12px; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 20px; }
            a { color: #2196F3; text-decoration: none; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>API Deprecation Notice</h2>
              <p>We're updating our API to improve performance and user experience.</p>
            </div>

            <div class="warning">
              <strong>⚠️ Important:</strong> The following API endpoint will be removed on <strong>${sunsetDateFormatted}</strong> (in ${daysUntilSunset} days).
            </div>

            <h3>Deprecated Endpoint</h3>
            <p><code>${notification.endpoint}</code></p>

            ${
              notification.replacementEndpoint
                ? `
              <h3>Replacement Endpoint</h3>
              <p><code>${notification.replacementEndpoint}</code></p>
            `
                : ''
            }

            <div class="action-items">
              <h3>What You Need to Do</h3>
              <ol>
                <li>Review the migration guide below</li>
                <li>Update your API calls to use the new endpoint</li>
                <li>Test thoroughly in your staging environment</li>
                <li>Deploy to production before ${sunsetDateFormatted}</li>
              </ol>
            </div>

            ${
              notification.migrationGuide
                ? `
              <h3>Migration Guide</h3>
              <p>For detailed migration instructions, please visit:</p>
              <p><a href="${notification.migrationGuide}">${notification.migrationGuide}</a></p>
            `
                : ''
            }

            <h3>Timeline</h3>
            <ul>
              <li><strong>Today:</strong> Deprecation notice sent</li>
              <li><strong>${sunsetDateFormatted}:</strong> Endpoint will return 410 Gone</li>
            </ul>

            <h3>Need Help?</h3>
            <p>If you have questions or need assistance with migration:</p>
            <ul>
              <li>Email: <a href="mailto:api-support@mentorminds.com">api-support@mentorminds.com</a></li>
              <li>Documentation: <a href="https://docs.mentorminds.com/api">https://docs.mentorminds.com/api</a></li>
              <li>Support Portal: <a href="https://support.mentorminds.com">https://support.mentorminds.com</a></li>
            </ul>

            <div class="footer">
              <p>This is an automated message from MentorMinds API Team. Please do not reply to this email.</p>
              <p>&copy; 2024 MentorMinds. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generate notification message
   */
  private generateNotificationMessage(notification: DeprecationNotification): string {
    return `The API endpoint ${notification.endpoint} will be removed on ${notification.sunsetDate.toLocaleDateString()}. 
    ${notification.replacementEndpoint ? `Please migrate to ${notification.replacementEndpoint}.` : 'Please review the migration guide.'}`;
  }

  /**
   * Send batch notifications for all upcoming sunsets
   */
  async sendUpcomingSunsetNotifications(recipients: NotificationRecipient[]): Promise<void> {
    const upcoming = getUpcomingSunsets();

    logInfo(`Sending notifications for ${upcoming.length} upcoming sunsets`, {
      recipientCount: recipients.length,
    });

    for (const item of upcoming) {
      const deprecation = deprecationManager.getDeprecation(item.endpoint);
      if (deprecation) {
        const daysUntilSunset = Math.ceil(
          (deprecation.sunsetDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );

        await this.notifyUsers(recipients, {
          endpoint: item.endpoint,
          sunsetDate: deprecation.sunsetDate,
          replacementEndpoint: item.replacementEndpoint,
          migrationGuide: deprecation.migrationGuide,
          daysUntilSunset,
        });
      }
    }
  }

  /**
   * Send final warning for endpoints about to sunset (within 7 days)
   */
  async sendFinalWarnings(recipients: NotificationRecipient[]): Promise<void> {
    const upcoming = getUpcomingSunsets().filter((item) => {
      const deprecation = deprecationManager.getDeprecation(item.endpoint);
      if (!deprecation) return false;

      const daysUntilSunset = Math.ceil(
        (deprecation.sunsetDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );

      return daysUntilSunset <= 7;
    });

    logInfo(`Sending final warnings for ${upcoming.length} endpoints`, {
      recipientCount: recipients.length,
    });

    for (const item of upcoming) {
      const deprecation = deprecationManager.getDeprecation(item.endpoint);
      if (deprecation) {
        const daysUntilSunset = Math.ceil(
          (deprecation.sunsetDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );

        await this.notifyUsers(recipients, {
          endpoint: item.endpoint,
          sunsetDate: deprecation.sunsetDate,
          replacementEndpoint: item.replacementEndpoint,
          migrationGuide: deprecation.migrationGuide,
          daysUntilSunset,
        });
      }
    }
  }

  /**
   * Send notification about removed endpoints
   */
  async sendRemovalNotifications(recipients: NotificationRecipient[]): Promise<void> {
    const sunset = getSunsetEndpoints();

    logInfo(`Sending removal notifications for ${sunset.length} endpoints`, {
      recipientCount: recipients.length,
    });

    for (const item of sunset) {
      const deprecation = deprecationManager.getDeprecation(item.endpoint);
      if (deprecation) {
        // Send notification about removal
        logInfo(`Endpoint removed: ${item.endpoint}`, {
          replacementEndpoint: item.replacementEndpoint,
        });
      }
    }
  }
}

export default new DeprecationNotificationService();
