import { CronJob } from 'cron';
import { logger } from '../utils/logger';
import { NotificationService } from './notification.service';
import pool from '../config/database';

/**
 * Notification Cleanup Service
 * Auto-deletes notifications older than 90 days
 */
export class NotificationCleanupService {
  private cronJob: CronJob | null = null;
  private isInitialized = false;

  /**
   * Initialize notification cleanup service
   * Runs daily at 2:00 AM to delete old notifications
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Notification cleanup service already initialized');
      return;
    }

    // Schedule daily cleanup at 2:00 AM
    this.cronJob = new CronJob('0 2 * * *', async () => {
      await this.cleanupOldNotifications();
    });

    this.cronJob.start();
    this.isInitialized = true;
    logger.info('Notification cleanup service initialized - runs daily at 2:00 AM');
  }

  /**
   * Delete notifications older than 90 days
   */
  private async cleanupOldNotifications(): Promise<void> {
    try {
      logger.info('Starting notification cleanup job');

      const query = `
        DELETE FROM notifications
        WHERE created_at < NOW() - INTERVAL '90 days'
        RETURNING id;
      `;

      const result = await pool.query(query);
      const deletedCount = result.rowCount || 0;

      logger.info(`Notification cleanup completed: ${deletedCount} notifications deleted`);

      // Also cleanup expired notifications
      const expiredCount = await NotificationService.cleanupExpiredNotifications();
      logger.info(`Expired notifications cleanup: ${expiredCount} notifications deleted`);

    } catch (error) {
      logger.error('Error during notification cleanup:', error);
    }
  }

  /**
   * Manually trigger cleanup (for testing or admin operations)
   */
  async triggerCleanup(): Promise<{ deleted: number; expired: number }> {
    logger.info('Manual notification cleanup triggered');

    try {
      const query = `
        DELETE FROM notifications
        WHERE created_at < NOW() - INTERVAL '90 days'
        RETURNING id;
      `;

      const result = await pool.query(query);
      const deleted = result.rowCount || 0;

      const expired = await NotificationService.cleanupExpiredNotifications();

      logger.info(`Manual cleanup completed: ${deleted} old, ${expired} expired`);

      return { deleted, expired };
    } catch (error) {
      logger.error('Error during manual notification cleanup:', error);
      return { deleted: 0, expired: 0 };
    }
  }

  /**
   * Shutdown gracefully
   */
  shutdown(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.isInitialized = false;
    logger.info('Notification cleanup service stopped');
  }
}

// Singleton instance
export const notificationCleanupService = new NotificationCleanupService();
