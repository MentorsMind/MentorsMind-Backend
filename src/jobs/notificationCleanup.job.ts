import { InAppNotificationService } from '../services/inAppNotification.service';
import { logger } from '../utils/logger.utils';

/**
 * Notification Cleanup Job
 *
 * Deletes notifications whose expires_at < NOW() (older than 90 days).
 * Intended to run once per day via the BullMQ scheduler.
 */
export async function runNotificationCleanupJob(): Promise<void> {
  logger.info('NotificationCleanupJob: starting');

  const deleted = await InAppNotificationService.deleteExpired();

  logger.info('NotificationCleanupJob: completed', { deletedCount: deleted });
}
