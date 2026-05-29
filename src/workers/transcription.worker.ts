import { Worker, Job } from 'bullmq';
import { redisConnection, QUEUE_NAMES } from '../queues/queue.config';
import { TranscriptionService } from '../services/transcription.service';
import { transcriptionQueue, TranscriptionJobData } from '../queues/transcription.queue';
import { logger } from '../utils/logger';

export const transcriptionWorker = new Worker<TranscriptionJobData>(
  QUEUE_NAMES.TRANSCRIPTION,
  async (job: Job<TranscriptionJobData>) => {
    const { transcriptId, bookingId, action } = job.data;

    if (action === 'start') {
      logger.info('[TranscriptionWorker] Starting transcription job', { transcriptId, bookingId });
      await TranscriptionService.startTranscriptionJob(transcriptId);

      // Schedule a poll job to check for completion
      await transcriptionQueue.add(
        'poll',
        { transcriptId, bookingId, action: 'poll' },
        { delay: 60_000 }, // first poll after 1 minute
      );
      return;
    }

    if (action === 'poll') {
      logger.info('[TranscriptionWorker] Polling transcription job', { transcriptId });
      const done = await TranscriptionService.pollAndProcess(transcriptId);

      if (!done) {
        // Re-queue another poll in 30 seconds
        await transcriptionQueue.add(
          'poll',
          { transcriptId, bookingId, action: 'poll' },
          { delay: 30_000 },
        );
      }
    }
  },
  { connection: redisConnection, concurrency: 5 },
);

transcriptionWorker.on('completed', (job) => {
  logger.info('[TranscriptionWorker] Job completed', { jobId: job.id, action: job.data.action });
});

transcriptionWorker.on('failed', (job, err) => {
  logger.error('[TranscriptionWorker] Job failed', {
    jobId: job?.id,
    transcriptId: job?.data?.transcriptId,
    error: err.message,
  });
});

transcriptionWorker.on('error', (err) => {
  logger.error('[TranscriptionWorker] Worker error', { error: err.message });
});
