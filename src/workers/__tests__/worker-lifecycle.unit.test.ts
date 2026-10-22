import { EventEmitter } from 'events';

describe('worker lifecycle logging', () => {
  it('logs failed jobs and captures the error with job context', () => {
    const emailWorker = Object.assign(new EventEmitter(), {
      name: 'email-queue',
      id: 'worker-1',
      opts: { concurrency: 1 },
    });
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
    };
    const captureException = jest.fn();

    jest.resetModules();
    jest.doMock('../../config/queue', () => ({
      QUEUE_NAMES: Object.fromEntries([
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
        'RETENTION_ENFORCEMENT',
      ].map((name) => [name, name])),
    }));
    jest.doMock('../../utils/logger.utils', () => ({ logger }));
    jest.doMock('@sentry/node', () => ({ captureException }));

    const unusedWorker = () => new EventEmitter();
    jest.doMock('../email.worker', () => ({ emailWorker }));
    jest.doMock('../payment.worker', () => ({ paymentWorker: unusedWorker() }));
    jest.doMock('../escrow-release.worker', () => ({ escrowReleaseWorker: unusedWorker() }));
    jest.doMock('../report.worker', () => ({ reportWorker: unusedWorker() }));
    jest.doMock('../sessionReminder.worker', () => ({ sessionReminderWorker: unusedWorker() }));
    jest.doMock('../session-no-show.worker', () => ({ sessionNoShowWorker: unusedWorker() }));
    jest.doMock('../notificationCleanup.worker', () => ({ notificationCleanupWorker: unusedWorker() }));
    jest.doMock('../maintenance.worker', () => ({ maintenanceWorker: unusedWorker() }));
    jest.doMock('../../jobs/stellarTx.worker', () => ({ stellarTxWorker: unusedWorker() }));
    jest.doMock('../../jobs/escrowCheck.worker', () => ({ escrowCheckWorker: unusedWorker() }));
    jest.doMock('../../jobs/notifications.worker', () => ({ notificationsWorker: unusedWorker() }));
    jest.doMock('../../jobs/webhookDelivery.job', () => ({ webhookDeliveryWorker: unusedWorker() }));
    jest.doMock('../transcription.worker', () => ({ transcriptionWorker: unusedWorker() }));
    jest.doMock('../domain-events.worker', () => ({ domainEventsWorker: unusedWorker() }));
    jest.doMock('../quality-score.worker', () => ({ qualityScoreWorker: unusedWorker() }));
    jest.doMock('../recordingCleanup.worker', () => ({ recordingCleanupWorker: unusedWorker() }));
    jest.doMock('../analyticsRefresh.worker', () => ({ analyticsRefreshWorker: unusedWorker() }));
    jest.doMock('../insight-generation.worker', () => ({ insightGenerationWorker: unusedWorker() }));
    jest.doMock('../incident-handler.worker', () => ({ incidentHandlerWorker: unusedWorker() }));
    jest.doMock('../onboardingNudge.worker', () => ({ onboardingNudgeWorker: unusedWorker() }));
    jest.doMock('../tax-reporting.worker', () => ({ taxReportingWorker: unusedWorker() }));
    jest.doMock('../scheduler', () => ({
      startScheduler: jest.fn(),
      stopScheduler: jest.fn(),
    }));
    jest.doMock('../retention-enforcement.worker', () => ({
      startRetentionEnforcementWorker: jest.fn(),
      stopRetentionEnforcementWorker: jest.fn(),
    }));

    require('../index');

    const job = {
      id: 'job-42',
      name: 'send-email',
      attemptsMade: 5,
    };
    const error = new Error('SMTP unavailable');

    emailWorker.emit('failed', job, error);

    expect(logger.error).toHaveBeenCalledWith(
      {
        queueName: 'email-queue',
        jobId: 'job-42',
        jobName: 'send-email',
        attemptsMade: 5,
        error: 'SMTP unavailable',
      },
      'Job failed after all retries',
      error,
    );
    expect(captureException).toHaveBeenCalledWith(error, {
      extra: {
        queueName: 'email-queue',
        jobId: 'job-42',
        jobName: 'send-email',
        attemptsMade: 5,
      },
    });

    emailWorker.emit('failed', null, error);
    expect(logger.error).toHaveBeenLastCalledWith(
      {
        queueName: 'email-queue',
        jobId: undefined,
        jobName: undefined,
        attemptsMade: undefined,
        error: 'SMTP unavailable',
      },
      'Job failed after all retries',
      error,
    );
  });
});
