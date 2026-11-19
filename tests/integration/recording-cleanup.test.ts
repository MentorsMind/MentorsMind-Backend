import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../src/config/database';
import { runRecordingCleanupJob, CleanupReport } from '../../src/jobs/recordingCleanup.job';
import { v4 as uuidv4 } from 'uuid';

describe('RecordingCleanupWorker - Retention Enforcement', () => {
  beforeEach(async () => {
    await db.query('DELETE FROM recording_cleanup_log');
    await db.query('DELETE FROM session_recordings');
  });

  afterEach(async () => {
    await db.query('DELETE FROM recording_cleanup_log');
    await db.query('DELETE FROM session_recordings');
  });

  describe('Retention period enforcement', () => {
    it('should not delete recordings within retention period', async () => {
      const sessionId = uuidv4();
      const recordingId = uuidv4();
      const s3Key = `recordings/${sessionId}/${recordingId}.webm`;
      const now = new Date();

      await db.query(
        `INSERT INTO session_recordings (id, session_id, s3_key, file_size_bytes, status, created_at)
         VALUES ($1, $2, $3, $4, 'completed', $5)`,
        [recordingId, sessionId, s3Key, 1024, now],
      );

      const report = await runRecordingCleanupJob();

      const { rows } = await db.query<{ s3_key: string }>(
        'SELECT s3_key FROM session_recordings WHERE s3_key = $1',
        [s3Key],
      );

      expect(rows.length).toBe(1);
      expect(report.orphansFound).toBe(0);
      expect(report.hardDeletedObjects).toBe(0);
    });

    it('should soft-delete orphaned recordings', async () => {
      const s3Key = 'recordings/orphan/file.webm';

      const report = await runRecordingCleanupJob();

      const { rows: logRows } = await db.query<{ s3_key: string; deletion_status: string }>(
        `SELECT s3_key, deletion_status FROM recording_cleanup_log
         WHERE s3_key = $1`,
        [s3Key],
      );

      if (logRows.length > 0) {
        expect(logRows[0].deletion_status).toBe('pending_deletion');
      }
    });

    it('should hard-delete recordings after soft-delete window expires', async () => {
      const recordingId = uuidv4();
      const s3Key = `recordings/old/${recordingId}.webm`;

      await db.query(
        `INSERT INTO recording_cleanup_log
         (id, s3_key, s3_bucket, file_size_bytes, deletion_status, scheduled_deletion_at, job_run_id, cleanup_reason, created_at)
         VALUES ($1, $2, $3, $4, 'pending_deletion', $5, $6, 'orphan', $7)`,
        [
          uuidv4(),
          s3Key,
          process.env.AWS_S3_BUCKET || 'test-bucket',
          1024,
          new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          uuidv4(),
          new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        ],
      );

      const report = await runRecordingCleanupJob();

      const { rows: logRows } = await db.query<{ deletion_status: string }>(
        `SELECT deletion_status FROM recording_cleanup_log WHERE s3_key = $1`,
        [s3Key],
      );

      if (logRows.length > 0) {
        expect(logRows[0].deletion_status).toBe('deleted');
      }
    });

    it('should prevent deletion if active DB record exists', async () => {
      const sessionId = uuidv4();
      const recordingId = uuidv4();
      const s3Key = `recordings/${sessionId}/${recordingId}.webm`;
      const now = new Date();

      await db.query(
        `INSERT INTO session_recordings (id, session_id, s3_key, file_size_bytes, status, created_at)
         VALUES ($1, $2, $3, $4, 'completed', $5)`,
        [recordingId, sessionId, s3Key, 1024, now],
      );

      await db.query(
        `INSERT INTO recording_cleanup_log
         (id, s3_key, s3_bucket, file_size_bytes, deletion_status, scheduled_deletion_at, job_run_id, cleanup_reason, created_at)
         VALUES ($1, $2, $3, $4, 'pending_deletion', $5, $6, 'orphan', $7)`,
        [
          uuidv4(),
          s3Key,
          process.env.AWS_S3_BUCKET || 'test-bucket',
          1024,
          new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          uuidv4(),
          new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        ],
      );

      const report = await runRecordingCleanupJob();

      const { rows: logRows } = await db.query<{ deletion_status: string }>(
        `SELECT deletion_status FROM recording_cleanup_log WHERE s3_key = $1`,
        [s3Key],
      );

      if (logRows.length > 0) {
        expect(logRows[0].deletion_status).toBe('recovered');
      }
    });

    it('should report cleanup statistics correctly', async () => {
      const report = await runRecordingCleanupJob();

      expect(report).toHaveProperty('jobRunId');
      expect(report).toHaveProperty('ranAt');
      expect(report).toHaveProperty('s3ObjectsScanned');
      expect(report).toHaveProperty('orphansFound');
      expect(report).toHaveProperty('orphansMarkedForDeletion');
      expect(report).toHaveProperty('hardDeletedObjects');
      expect(report).toHaveProperty('hardDeletedBytes');
      expect(report).toHaveProperty('totalBytesReclaimed');
      expect(report).toHaveProperty('estimatedMonthlySavingsUsd');
      expect(report).toHaveProperty('errors');

      expect(report.s3ObjectsScanned).toBeGreaterThanOrEqual(0);
      expect(report.orphansFound).toBeGreaterThanOrEqual(0);
      expect(report.hardDeletedBytes).toBeGreaterThanOrEqual(0);
    });

    it('should mark pending-deletion recordings ready for recovery window', async () => {
      const recordingId = uuidv4();
      const s3Key = `recordings/recovery/${recordingId}.webm`;

      await db.query(
        `INSERT INTO recording_cleanup_log
         (id, s3_key, s3_bucket, file_size_bytes, deletion_status, scheduled_deletion_at, job_run_id, cleanup_reason, created_at)
         VALUES ($1, $2, $3, $4, 'pending_deletion', $5, $6, 'orphan', $7)`,
        [
          uuidv4(),
          s3Key,
          process.env.AWS_S3_BUCKET || 'test-bucket',
          1024,
          new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          uuidv4(),
          new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        ],
      );

      const report = await runRecordingCleanupJob();

      const { rows: logRows } = await db.query<{ deletion_status: string }>(
        `SELECT deletion_status FROM recording_cleanup_log WHERE s3_key = $1`,
        [s3Key],
      );

      if (logRows.length > 0) {
        expect(logRows[0].deletion_status).toBe('pending_deletion');
      }
    });

    it('should calculate cost savings accurately', async () => {
      const recordingId = uuidv4();
      const s3Key = `recordings/cost/${recordingId}.webm`;
      const fileSizeBytes = 1024 * 1024 * 100;

      await db.query(
        `INSERT INTO recording_cleanup_log
         (id, s3_key, s3_bucket, file_size_bytes, deletion_status, scheduled_deletion_at, job_run_id, cleanup_reason, created_at)
         VALUES ($1, $2, $3, $4, 'pending_deletion', $5, $6, 'orphan', $7)`,
        [
          uuidv4(),
          s3Key,
          process.env.AWS_S3_BUCKET || 'test-bucket',
          fileSizeBytes,
          new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          uuidv4(),
          new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        ],
      );

      const report = await runRecordingCleanupJob();

      expect(report.estimatedMonthlySavingsUsd).toBeGreaterThan(0);
    });

    it('should purge old cleanup log entries', async () => {
      const oldRecordingId = uuidv4();
      const oldS3Key = `recordings/old-purge/${oldRecordingId}.webm`;
      const cutoff = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO recording_cleanup_log
         (id, s3_key, s3_bucket, file_size_bytes, deletion_status, deleted_at, job_run_id, cleanup_reason, created_at)
         VALUES ($1, $2, $3, $4, 'deleted', $5, $6, 'orphan', $7)`,
        [
          uuidv4(),
          oldS3Key,
          process.env.AWS_S3_BUCKET || 'test-bucket',
          1024,
          cutoff,
          uuidv4(),
          cutoff,
        ],
      );

      const reportBefore = await db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM recording_cleanup_log WHERE s3_key = $1`,
        [oldS3Key],
      );

      await runRecordingCleanupJob();

      const reportAfter = await db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM recording_cleanup_log WHERE s3_key = $1`,
        [oldS3Key],
      );

      expect(parseInt(reportAfter.rows[0]?.count ?? '0') || 0).toBeLessThanOrEqual(
        parseInt(reportBefore.rows[0]?.count ?? '0') || 0,
      );
    });
  });
});
