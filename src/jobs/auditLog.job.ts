import { Queue, Worker, Job } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from '../config/queue';
import pool from '../config/database';
import { logger } from '../utils/logger';

export interface AuditLogJobData {
    userId: string | null;
    action: string;
    resourceType: string | null;
    resourceId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: Record<string, any>;
}

// Create audit log queue
export const auditLogQueue = new Queue<AuditLogJobData>(QUEUE_NAMES.AUDIT_LOG || 'audit-log-queue', {
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

// Process audit log jobs
async function processAuditLogJob(job: Job<AuditLogJobData>): Promise<void> {
    const { userId, action, resourceType, resourceId, ipAddress, userAgent, metadata } = job.data;

    try {
        const query = `
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

        await pool.query(query, [
            userId,
            action,
            resourceType,
            resourceId,
            ipAddress,
            userAgent,
            JSON.stringify(metadata),
        ]);

        logger.debug('Audit log job completed', { action, userId, jobId: job.id });
    } catch (error) {
        logger.error('Audit log job failed', { error, action, userId, jobId: job.id });
        throw error; // Re-throw to trigger retry
    }
}

// Create audit log worker
export const auditLogWorker = new Worker<AuditLogJobData>(
    QUEUE_NAMES.AUDIT_LOG || 'audit-log-queue',
    processAuditLogJob,
    {
        connection: redisConnection,
        concurrency: 5, // Process up to 5 audit logs concurrently
    }
);

// Worker event handlers
auditLogWorker.on('completed', (job) => {
    logger.debug('Audit log worker completed job', { jobId: job.id, action: job.data.action });
});

auditLogWorker.on('failed', (job, err) => {
    logger.error('Audit log worker job failed', {
        jobId: job?.id,
        action: job?.data?.action,
        error: err.message,
    });
});

auditLogWorker.on('error', (err) => {
    logger.error('Audit log worker error', { error: err.message });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing audit log worker...');
    await auditLogWorker.close();
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, closing audit log worker...');
    await auditLogWorker.close();
});

/**
 * Enqueue an audit log job
 * @param data - Audit log data
 */
export async function enqueueAuditLog(data: AuditLogJobData): Promise<void> {
    await auditLogQueue.add('audit-log', data);
    logger.debug('Audit log job enqueued', { action: data.action, userId: data.userId });
}

/**
 * Get audit log queue statistics
 */
export async function getAuditLogQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        auditLogQueue.getWaitingCount(),
        auditLogQueue.getActiveCount(),
        auditLogQueue.getCompletedCount(),
        auditLogQueue.getFailedCount(),
        auditLogQueue.getDelayedCount(),
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

export default {
    auditLogQueue,
    auditLogWorker,
    enqueueAuditLog,
    getAuditLogQueueStats,
};
