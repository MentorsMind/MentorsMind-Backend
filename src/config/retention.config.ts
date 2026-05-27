import { env } from './env';

/**
 * Retention configuration — values may be overridden via environment variables.
 */
const retentionConfig = {
  notificationsDays: parseInt(env.RETENTION_NOTIFICATIONS_DAYS || '', 10) || 90,
  auditLogsYears: parseInt(env.RETENTION_AUDIT_LOGS_YEARS || '', 10) || 7,
  paymentsYears: parseInt(env.RETENTION_PAYMENTS_YEARS || '', 10) || 7,
  sessionsYears: parseInt(env.RETENTION_SESSIONS_YEARS || '', 10) || 2,
} as const;

export default retentionConfig;
