import { Worker, Job } from 'bullmq';
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from '../config/queue';
import { logger } from '../utils/logger.utils';
import { ThreatDetectionService } from '../services/threat-detection.service';
import { IncidentResponseService } from '../services/incident-response.service';
import type { SecurityAnalysisJobData } from '../queues/security-analysis.queue';

/**
 * Security Analysis Worker
 *
 * Consumes login/access events, runs the heuristic/statistical threat
 * detection engine (ThreatDetectionService, backed by ml-security.service.ts)
 * against them, and hands any detected threat to IncidentResponseService for
 * automated response (account lock, alerting, incident recording).
 */
async function processSecurityAnalysis(
  job: Job<SecurityAnalysisJobData>,
): Promise<void> {
  const { userId, ip, userAgent, timestamp } = job.data;

  logger.info('Processing security analysis job', {
    jobId: job.id,
    userId,
  });

  const detection = await ThreatDetectionService.analyzeLoginEvent(userId, {
    ip,
    userAgent,
    timestamp: new Date(timestamp),
  });

  if (!detection.threatDetected) {
    logger.info('No threat detected', { userId, score: detection.score });
    return;
  }

  logger.warn('Threat detected â€” dispatching incident response', {
    userId,
    incidentType: detection.incidentType,
    severity: detection.severity,
    score: detection.score,
  });

  await IncidentResponseService.handle(userId, detection);
}

export const securityAnalysisWorker = new Worker<SecurityAnalysisJobData>(
  QUEUE_NAMES.SECURITY_ANALYSIS,
  processSecurityAnalysis,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.SECURITY_ANALYSIS,
  },
);

securityAnalysisWorker.on('completed', (job) => {
  logger.info('Security analysis job completed', {
    jobId: job.id,
    userId: job.data.userId,
  });
});

securityAnalysisWorker.on('failed', (job, err) => {
  logger.error('Security analysis job failed', {
    jobId: job?.id,
    userId: job?.data.userId,
    error: err.message,
  });
});

securityAnalysisWorker.on('error', (err) => {
  logger.error('Security analysis worker error', { error: err.message });
});

