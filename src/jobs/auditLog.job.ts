import { Queue, Worker, Job } from 'bullmq';
import zlib from 'zlib';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from '../config/queue';
import pool from '../config/database';
import { Logger } from "../utils/logger.utils";
import { env } from '../config/env';
import { StorageService } from '../services/storage.service';

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

// ─── Archival Pipeline (issue #772) ─────────────────────────────────────────
//
// audit_logs rows older than AUDIT_ARCHIVE_AFTER_DAYS are compressed to NDJSON,
// uploaded to S3 under an Object Lock (WORM) retention equal to
// RETENTION_AUDIT_LOGS_YEARS, and only then deleted from PostgreSQL. This
// bridges the gap between "keep in hot DB storage" and the 7-year regulatory
// retention (SOX/PCI DSS) that stale-data-cleanup.job.ts alone cannot satisfy
// cost-effectively.

const ARCHIVE_BATCH_SIZE = 5000;
/** Caps a single run's duration; remaining rows are picked up on the next scheduled run. */
const MAX_BATCHES_PER_RUN = 20;

export interface AuditLogArchiveResult {
    batches: number;
    totalRowsArchived: number;
    totalBytesCompressed: number;
}

export interface AuditLogArchiveRecord {
    id: string;
    s3Key: string;
    rowCount: number;
    fromDate: Date;
    toDate: Date;
    compressedSizeBytes: number;
    archivedAt: Date;
    downloadUrl: string;
}

export interface PaginatedAuditLogArchives {
    archives: AuditLogArchiveRecord[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

function buildArchiveS3Key(now: Date): string {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `audit-archive/${year}/${month}/${day}/audit-logs-${now.getTime()}.ndjson.gz`;
}

export const AuditLogArchivalJob = {
    /**
     * Archives audit_logs rows older than AUDIT_ARCHIVE_AFTER_DAYS to S3 in
     * batches, in NDJSON + gzip format, under Object Lock (WORM) retention.
     * Rows are only deleted from PostgreSQL after their batch's S3 upload and
     * archive-metadata insert have both succeeded.
     */
    async run(): Promise<AuditLogArchiveResult> {
        const archiveAfterDays = parseInt(env.AUDIT_ARCHIVE_AFTER_DAYS, 10);
        const retentionYears = parseInt(env.RETENTION_AUDIT_LOGS_YEARS, 10);

        let batches = 0;
        let totalRowsArchived = 0;
        let totalBytesCompressed = 0;

        while (batches < MAX_BATCHES_PER_RUN) {
            const { rows } = await pool.query(
                `SELECT * FROM audit_logs
         WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
         ORDER BY created_at ASC
         LIMIT $2`,
                [archiveAfterDays, ARCHIVE_BATCH_SIZE],
            );

            if (rows.length === 0) break;

            const ndjson = rows.map((row: Record<string, unknown>) => JSON.stringify(row)).join('\n') + '\n';
            const compressed = zlib.gzipSync(Buffer.from(ndjson, 'utf-8'));

            const fromDate = new Date(rows[0].created_at);
            const toDate = new Date(rows[rows.length - 1].created_at);
            const now = new Date();
            const s3Key = buildArchiveS3Key(now);

            const retainUntilDate = new Date(now);
            retainUntilDate.setFullYear(retainUntilDate.getFullYear() + retentionYears);

            // 1. Upload to S3 first — rows are only deleted from PostgreSQL once
            //    this succeeds, so a failed upload just gets retried next run.
            await StorageService.uploadFileWithRetention(
                s3Key,
                compressed,
                'application/gzip',
                retainUntilDate,
                { rowCount: String(rows.length) },
            );

            const ids = rows.map((row: { id: string }) => row.id);

            // 2. Record archive metadata and delete the archived rows atomically.
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(
                    `INSERT INTO audit_log_archives (s3_key, row_count, from_date, to_date, compressed_size_bytes)
           VALUES ($1, $2, $3, $4, $5)`,
                    [s3Key, rows.length, fromDate, toDate, compressed.length],
                );
                await client.query(`DELETE FROM audit_logs WHERE id = ANY($1)`, [ids]);
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }

            batches++;
            totalRowsArchived += rows.length;
            totalBytesCompressed += compressed.length;

            logger.info('[AuditLogArchivalJob] Archived batch', {
                s3Key,
                rowCount: rows.length,
                compressedSizeBytes: compressed.length,
            });

            if (rows.length < ARCHIVE_BATCH_SIZE) break;
        }

        if (totalRowsArchived > 0) {
            logger.info('[AuditLogArchivalJob] Run complete', {
                batches,
                totalRowsArchived,
                totalBytesCompressed,
            });
        }

        return { batches, totalRowsArchived, totalBytesCompressed };
    },

    /** GET /admin/audit-log/archives — lists archived batches with presigned download links. */
    async listArchives(page = 1, limit = 20): Promise<PaginatedAuditLogArchives> {
        const offset = (page - 1) * limit;

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT * FROM audit_log_archives ORDER BY archived_at DESC LIMIT $1 OFFSET $2`,
                [limit, offset],
            ),
            pool.query(`SELECT COUNT(*) FROM audit_log_archives`),
        ]);

        const archives: AuditLogArchiveRecord[] = await Promise.all(
            dataResult.rows.map(async (row: Record<string, any>) => ({
                id: row.id,
                s3Key: row.s3_key,
                rowCount: row.row_count,
                fromDate: row.from_date,
                toDate: row.to_date,
                compressedSizeBytes: Number(row.compressed_size_bytes),
                archivedAt: row.archived_at,
                downloadUrl: await StorageService.generatePresignedUrl(row.s3_key, 3600),
            })),
        );

        const total = parseInt(countResult.rows[0].count, 10);
        return { archives, total, page, limit, totalPages: Math.ceil(total / limit) };
    },
};

export default {
    auditLogQueue,
    auditLogWorker,
    enqueueAuditLog,
    getAuditLogQueueStats,
    AuditLogArchivalJob,
};
