import { Queue } from 'bullmq';
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from './queue.config';

export type ReportType = 'weekly-earnings';

export interface ReportJobData {
  reportType: ReportType;
  /** ISO date string for the report period start */
  periodStart: string;
  /** ISO date string for the report period end */
  periodEnd: string;
  /** Optional mentor ID — if omitted, generates platform-wide report */
  mentorId?: string;
}

export const reportQueue = new Queue<ReportJobData>(QUEUE_NAMES.REPORT, {
  connection: redisConnection,
  defaultJobOptions,
});

/**
 * Enqueue a weekly earnings report generation job.
 */
export async function enqueueWeeklyEarningsReport(
  mentorId?: string,
): Promise<void> {
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  await reportQueue.add(
    'weekly-earnings',
    { reportType: 'weekly-earnings', periodStart, periodEnd, mentorId },
    {
      jobId: `weekly-earnings:${mentorId ?? 'platform'}:${periodStart.slice(0, 10)}`,
    },
  );
}
