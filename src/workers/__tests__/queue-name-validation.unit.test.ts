/**
 * Startup validation in workers/index.ts must fail fast when a queue name used
 * by a worker is missing from QUEUE_NAMES.
 */
const REQUIRED_QUEUE_KEYS = [
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
];

const toQueueNames = (keys: string[]): Record<string, string> =>
  Object.fromEntries(keys.map((key) => [key, `${key.toLowerCase()}-queue`]));

function loadWorkersIndex(queueNames: Record<string, string>) {
  jest.resetModules();

  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const stubWorker = () => ({ name: 'stub', id: 'stub', opts: {}, on: jest.fn() });

  jest.doMock('../../config/queue', () => ({ QUEUE_NAMES: queueNames }));
  jest.doMock('../../utils/logger.utils', () => ({ logger }));
  jest.doMock('@sentry/node', () => ({ captureException: jest.fn() }));

  jest.doMock('../email.worker', () => ({ emailWorker: stubWorker() }));
  jest.doMock('../payment.worker', () => ({ paymentWorker: stubWorker() }));
  jest.doMock('../escrow-release.worker', () => ({ escrowReleaseWorker: stubWorker() }));
  jest.doMock('../report.worker', () => ({ reportWorker: stubWorker() }));
  jest.doMock('../sessionReminder.worker', () => ({ sessionReminderWorker: stubWorker() }));
  jest.doMock('../session-no-show.worker', () => ({ sessionNoShowWorker: stubWorker() }));
  jest.doMock('../notificationCleanup.worker', () => ({ notificationCleanupWorker: stubWorker() }));
  jest.doMock('../maintenance.worker', () => ({ maintenanceWorker: stubWorker() }));
  jest.doMock('../../jobs/stellarTx.worker', () => ({ stellarTxWorker: stubWorker() }));
  jest.doMock('../../jobs/escrowCheck.worker', () => ({ escrowCheckWorker: stubWorker() }));
  jest.doMock('../../jobs/notifications.worker', () => ({ notificationsWorker: stubWorker() }));
  jest.doMock('../../jobs/webhookDelivery.job', () => ({ webhookDeliveryWorker: stubWorker() }));
  jest.doMock('../transcription.worker', () => ({ transcriptionWorker: stubWorker() }));
  jest.doMock('../domain-events.worker', () => ({ domainEventsWorker: stubWorker() }));
  jest.doMock('../quality-score.worker', () => ({ qualityScoreWorker: stubWorker() }));
  jest.doMock('../recordingCleanup.worker', () => ({ recordingCleanupWorker: stubWorker() }));
  jest.doMock('../analyticsRefresh.worker', () => ({ analyticsRefreshWorker: stubWorker() }));
  jest.doMock('../insight-generation.worker', () => ({ insightGenerationWorker: stubWorker() }));
  jest.doMock('../incident-handler.worker', () => ({ incidentHandlerWorker: stubWorker() }));
  jest.doMock('../onboardingNudge.worker', () => ({ onboardingNudgeWorker: stubWorker() }));
  jest.doMock('../tax-reporting.worker', () => ({ taxReportingWorker: stubWorker() }));
  jest.doMock('../scheduler', () => ({
    startScheduler: jest.fn(),
    stopScheduler: jest.fn(),
  }));
  jest.doMock('../retention-enforcement.worker', () => ({
    startRetentionEnforcementWorker: jest.fn(),
    stopRetentionEnforcementWorker: jest.fn(),
  }));

  return { logger, load: () => require('../index') };
}

describe('workers/index queue name validation', () => {
  it('starts when every required queue name exists in QUEUE_NAMES', () => {
    const { logger, load } = loadWorkersIndex(toQueueNames(REQUIRED_QUEUE_KEYS));

    expect(() => load()).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('fails startup when RETENTION_ENFORCEMENT is missing from QUEUE_NAMES', () => {
    const { logger, load } = loadWorkersIndex(
      toQueueNames(REQUIRED_QUEUE_KEYS.filter((key) => key !== 'RETENTION_ENFORCEMENT')),
    );

    expect(() => load()).toThrow(
      'Queue name RETENTION_ENFORCEMENT is used by a worker but not defined in QUEUE_NAMES',
    );
    expect(logger.error).toHaveBeenCalledWith('[Workers] Startup validation failed', {
      error: expect.stringContaining('RETENTION_ENFORCEMENT'),
    });
  });

  it('fails startup for any other missing required queue name', () => {
    const { load } = loadWorkersIndex(
      toQueueNames(REQUIRED_QUEUE_KEYS.filter((key) => key !== 'EMAIL')),
    );

    expect(() => load()).toThrow(
      'Queue name EMAIL is used by a worker but not defined in QUEUE_NAMES',
    );
  });
});
