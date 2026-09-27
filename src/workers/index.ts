/**
 * Workers index — import once in server.ts to activate all background workers.
 */
import { QUEUE_NAMES } from '../config/queue';
import type { Worker } from 'bullmq';
import { logger } from '../utils/logger.utils';

import { emailWorker } from './email.worker';
import { paymentWorker } from './payment.worker';
import { escrowReleaseWorker } from './escrow-release.worker';
import { reportWorker } from './report.worker';
import { sessionReminderWorker } from './sessionReminder.worker';
import { sessionNoShowWorker } from './session-no-show.worker';
import { notificationCleanupWorker } from './notificationCleanup.worker';
import { maintenanceWorker } from './maintenance.worker';
import { stellarTxWorker } from '../jobs/stellarTx.worker';
import { escrowCheckWorker } from '../jobs/escrowCheck.worker';
import { notificationsWorker } from '../jobs/notifications.worker';
import { webhookDeliveryWorker } from '../jobs/webhookDelivery.job';
import { transcriptionWorker } from './transcription.worker';
import { domainEventsWorker } from './domain-events.worker';
import { qualityScoreWorker } from './quality-score.worker';
import { recordingCleanupWorker } from './recordingCleanup.worker';
import { analyticsRefreshWorker } from './analyticsRefresh.worker';
import { insightGenerationWorker } from './insight-generation.worker';
import { incidentHandlerWorker } from './incident-handler.worker';
import { onboardingNudgeWorker } from './onboardingNudge.worker';
import { taxReportingWorker } from './tax-reporting.worker';
import {
    startScheduler,
    stopScheduler,
} from './scheduler';
import {
    startRetentionEnforcementWorker,
    stopRetentionEnforcementWorker,
} from './retention-enforcement.worker';

function registerWorkerLifecycleLogging(worker: Worker): Worker {
    let jobsCompleted = 0;

    worker.on('completed', () => {
        jobsCompleted += 1;
    });

    worker.on('ready', () => {
        logger.info({
            queueName: worker.name,
            concurrency: worker.opts.concurrency,
            workerId: worker.id,
            timestamp: new Date().toISOString(),
        }, 'Worker ready');
    });

    worker.on('closed', () => {
        logger.info({
            queueName: worker.name,
            jobsCompleted,
            timestamp: new Date().toISOString(),
        }, 'Worker closed');
    });

    worker.on('error', (error) => {
        logger.error({
            queueName: worker.name,
            workerId: worker.id,
            err: error,
            timestamp: new Date().toISOString(),
        }, 'Worker error');
    });

    return worker;
}

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
    'REPUTATION_SYNC',
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

[
    emailWorker,
    paymentWorker,
    escrowReleaseWorker,
    reportWorker,
    sessionReminderWorker,
    sessionNoShowWorker,
    notificationCleanupWorker,
    maintenanceWorker,
    stellarTxWorker,
    escrowCheckWorker,
    notificationsWorker,
    webhookDeliveryWorker,
    transcriptionWorker,
    domainEventsWorker,
    qualityScoreWorker,
    recordingCleanupWorker,
    analyticsRefreshWorker,
    insightGenerationWorker,
    incidentHandlerWorker,
    onboardingNudgeWorker,
    taxReportingWorker,
].forEach(registerWorkerLifecycleLogging);

export {
    emailWorker,
    paymentWorker,
    escrowReleaseWorker,
    reportWorker,
    sessionReminderWorker,
    sessionNoShowWorker,
    notificationCleanupWorker,
    maintenanceWorker,
    startScheduler,
    stopScheduler,
    stellarTxWorker,
    escrowCheckWorker,
    notificationsWorker,
    webhookDeliveryWorker,
    transcriptionWorker,
    domainEventsWorker,
    qualityScoreWorker,
    startRetentionEnforcementWorker,
    stopRetentionEnforcementWorker,
    recordingCleanupWorker,
    analyticsRefreshWorker,
    insightGenerationWorker,
    incidentHandlerWorker,
    onboardingNudgeWorker,
    taxReportingWorker,
};
