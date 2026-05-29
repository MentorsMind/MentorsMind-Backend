import { Queue } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config';

export interface TranscriptionJobData {
  transcriptId: string;
  bookingId: string;
  /** 'start' kicks off the AWS Transcribe job; 'poll' checks for completion */
  action: 'start' | 'poll';
}

export const transcriptionQueue = new Queue<TranscriptionJobData>(QUEUE_NAMES.TRANSCRIPTION, {
  connection: redisConnection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 10,
    backoff: { type: 'fixed', delay: 30_000 }, // poll every 30 s
  },
});
