import { Queue } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config';

export interface OnboardingNudgeJobData {
  jobType: 'onboarding-nudge';
  mentorId?: string;
  triggeredAt?: string;
}

export const onboardingNudgeQueue = new Queue<OnboardingNudgeJobData>(
  QUEUE_NAMES.ONBOARDING_NUDGE,
  { connection: redisConnection, defaultJobOptions },
);
