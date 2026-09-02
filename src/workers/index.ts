/**
 * Workers index — import once in server.ts to activate all background workers.
 */
import { QUEUE_NAMES } from '../config/queue';
import { logger } from '../utils/logger.utils';

// Startup assertion: verify all queue names used by workers exist in QUEUE_NAMES
const REQUIRED_QUEUE_NAMES = [
    'EMAIL',
    'PAYMENT_POLL',
    'ESCROW_RELEASE',
    'REPORT',
    'SESSION_REMINDER',
    'SESSION_NO_SHOW',
    'STELLAR_TX',
    'ESCROW_CHECK',
    'NOTIFICATIONS',
    'NOTIFICATION_CLEANUP',
    'MAINTENANCE',
    'TRANSCRIPTION',
    'DOMAIN_EVENTS',
    'RECORDING_CLEANUP',
    'ANALYTICS_REFRESH',
    'INSIGHT_GENERATION',
    'INCIDENT_RESPONSE',
    'ONBOARDING_NUDGE',
    'TAX_REPORTING',
] as const;

for (const queueKey of REQUIRED_QUEUE_NAMES) {
    if (!(queueKey in QUEUE_NAMES)) {
        const error = `Queue name ${queueKey} is used by a worker but not defined in QUEUE_NAMES`;
        logger.error('[Workers] Startup validation failed', { error });
        throw new Error(error);
    }
}

logger.info('[Workers] Queue name validation passed', {
    validatedQueues: REQUIRED_QUEUE_NAMES.length,
});

export { emailWorker } from './email.worker';
export { paymentWorker } from './payment.worker';
export { escrowReleaseWorker } from './escrow-release.worker';
export { reportWorker } from './report.worker';
export { sessionReminderWorker } from './sessionReminder.worker';
export { sessionNoShowWorker } from './session-no-show.worker';
export { notificationCleanupWorker } from './notificationCleanup.worker';
export { maintenanceWorker } from './maintenance.worker';
export { startScheduler, stopScheduler } from './scheduler';
export { stellarTxWorker } from '../jobs/stellarTx.worker';
export { escrowCheckWorker } from '../jobs/escrowCheck.worker';
export { notificationsWorker } from '../jobs/notifications.worker';
export { webhookDeliveryWorker } from '../jobs/webhookDelivery.job';
export { transcriptionWorker } from './transcription.worker';
export { domainEventsWorker } from './domain-events.worker';
export { qualityScoreWorker } from './quality-score.worker';
export { startRetentionEnforcementWorker, stopRetentionEnforcementWorker } from './retention-enforcement.worker';
export { recordingCleanupWorker } from './recordingCleanup.worker';
export { analyticsRefreshWorker } from './analyticsRefresh.worker';
export { insightGenerationWorker } from './insight-generation.worker';
export { incidentHandlerWorker } from './incident-handler.worker';
export { onboardingNudgeWorker } from './onboardingNudge.worker';
export { taxReportingWorker } from './tax-reporting.worker';
