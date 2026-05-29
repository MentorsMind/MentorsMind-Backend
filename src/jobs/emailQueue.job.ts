import { Queue, Worker, Job } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from '../config/queue';
import { EmailService, EmailRequest } from '../services/email.service';
import { logger } from '../utils/logger';

export interface EmailJobData extends EmailRequest {
    jobType: 'send-email';
    templateName?: string;
    recipient?: string;
}

// Create email queue
export const emailQueue = new Queue<EmailJobData>(QUEUE_NAMES.EMAIL, {
    connection: redisConnection,
    defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 3, // Retry up to 3 times
        backoff: {
            type: 'exponential',
            delay: 1000, // 1s → 2s → 4s
        },
    },
});

// Email service instance
const emailService = new EmailService();

// Process email jobs
async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
    const { jobType: _jobType, templateName, recipient, ...emailRequest } = job.data;

    const logData = {
        jobId: job.id,
        templateName: templateName || 'unknown',
        recipient: recipient || emailRequest.to.join(', '),
        subject: emailRequest.subject,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
    };

    logger.info('Email job started', logData);

    try {
        const result = await emailService.sendEmail(emailRequest);

        if (!result.success) {
            const error = result.error || 'Email send failed';

            logger.error('Email job failed', {
                ...logData,
                error,
                deliveryStatus: result.deliveryStatus,
            });

            throw new Error(error);
        }

        logger.info('Email job completed successfully', {
            ...logData,
            messageId: result.messageId,
            deliveryStatus: result.deliveryStatus,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        logger.error('Email job threw exception', {
            ...logData,
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
        });

        throw error; // Re-throw to trigger retry
    }
}

// Create email worker
export const emailWorker = new Worker<EmailJobData>(
    QUEUE_NAMES.EMAIL,
    processEmailJob,
    {
        connection: redisConnection,
        concurrency: 10, // Process up to 10 emails concurrently
    },
);

// Worker event handlers
emailWorker.on('completed', (job) => {
    logger.info('Email worker completed job', {
        jobId: job.id,
        templateName: job.data.templateName,
        recipient: job.data.recipient || job.data.to.join(', '),
    });
});

emailWorker.on('failed', (job, err) => {
    logger.error('Email worker job failed', {
        jobId: job?.id,
        templateName: job?.data?.templateName,
        recipient: job?.data?.recipient || job?.data?.to?.join(', '),
        attempt: job?.attemptsMade,
        maxAttempts: job?.opts?.attempts,
        error: err.message,
    });
});

emailWorker.on('error', (err) => {
    logger.error('Email worker error', {
        error: err.message,
        stack: err.stack,
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing email worker...');
    await emailWorker.close();
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, closing email worker...');
    await emailWorker.close();
});

/**
 * Enqueue an email send job
 * @param data - Email request payload
 * @param options - Optional job options (priority, delay, etc.)
 */
export async function enqueueEmail(
    data: EmailJobData,
    options?: {
        priority?: number;
        delay?: number;
        attempts?: number;
    }
): Promise<void> {
    const jobOptions = {
        priority: options?.priority,
        delay: options?.delay,
        attempts: options?.attempts || 3,
    };

    await emailQueue.add('send-email', data, jobOptions);

    logger.info('Email job enqueued', {
        templateName: data.templateName,
        recipient: data.recipient || data.to.join(', '),
        subject: data.subject,
        priority: options?.priority,
        delay: options?.delay,
    });
}

/**
 * Get email queue statistics
 */
export async function getEmailQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        emailQueue.getWaitingCount(),
        emailQueue.getActiveCount(),
        emailQueue.getCompletedCount(),
        emailQueue.getFailedCount(),
        emailQueue.getDelayedCount(),
    ]);

    return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed,
    };
}

/**
 * Clean old jobs from the queue
 */
export async function cleanEmailQueue(
    gracePeriodMs: number = 24 * 60 * 60 * 1000 // 24 hours
): Promise<void> {
    await emailQueue.clean(gracePeriodMs, 100, 'completed');
    await emailQueue.clean(gracePeriodMs, 100, 'failed');

    logger.info('Email queue cleaned', { gracePeriodMs });
}

export default {
    emailQueue,
    emailWorker,
    enqueueEmail,
    getEmailQueueStats,
    cleanEmailQueue,
};
