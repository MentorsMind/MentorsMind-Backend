import { AuditLogModel } from './audit-log.model';
import { ExportJobModel } from './export-job.model';
import { SessionModel } from './session.model';
import { PaymentModel } from './payment.model';
import { ReviewModel } from './review.model';
import { NotificationsModel } from './notifications.model';
import { NotificationPreferencesModel } from './notification-preferences.model';
import { NotificationTemplatesModel } from './notification-templates.model';
import { NotificationDeliveryTrackingModel } from './notification-delivery-tracking.model';
import { NotificationAnalyticsModel } from './notification-analytics.model';
import { logger } from '../utils/logger';

export const initializeModels = async () => {
  try {
    await AuditLogModel.initializeTable();
    await ExportJobModel.initializeTable();
    await SessionModel.initializeTable();
    await PaymentModel.initializeTable();
    await ReviewModel.initializeTable();
    await NotificationsModel.initializeTable();
    await NotificationPreferencesModel.initializeTable();
    await NotificationTemplatesModel.initializeTable();
    await NotificationDeliveryTrackingModel.initializeTable();
    await NotificationAnalyticsModel.initializeTable();
    logger.info('All database tables initialized');
  } catch (error) {
    logger.error('Database initialization failed', { error });
    throw error;
  }
};
