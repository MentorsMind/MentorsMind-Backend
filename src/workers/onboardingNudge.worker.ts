import { Worker, Job } from 'bullmq';
import { redisConnection, CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { runOnboardingNudgeJob } from '../jobs/onboardingNudge.job';
import { logger } from '../utils/logger.utils';
import type { OnboardingNudgeJobData } from '../queues/onboarding-nudge.queue';

async function processOnboardingNudgeJob(job: Job<OnboardingNudgeJobData>): Promise<void> {
  logger.info('[OnboardingNudgeWorker] Running onboarding nudge job', { jobId: job.id });
  await runOnboardingNudgeJob();
}

export const onboardingNudgeWorker = new Worker<OnboardingNudgeJobData>(
  QUEUE_NAMES.ONBOARDING_NUDGE,
  processOnboardingNudgeJob,
  { connection: redisConnection, concurrency: CONCURRENCY.ONBOARDING_NUDGE },
);

onboardingNudgeWorker.on('completed', (job) => {
  logger.info('[OnboardingNudgeWorker] Job completed', { jobId: job.id });
});

onboardingNudgeWorker.on('failed', (job, err) => {
  logger.error('[OnboardingNudgeWorker] Job failed', {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

onboardingNudgeWorker.on('error', (err) => {
  logger.error('[OnboardingNudgeWorker] Worker error', { error: err.message });
});
