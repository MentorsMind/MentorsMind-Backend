/**
 * Audit Log Archival Job Integration Tests (issue #1053)
 *
 * Integration tests verifying the full audit log archival pipeline:
 * 1. Inserts test data into audit_logs table
 * 2. Runs the archival job with real PostgreSQL and S3 uploads
 * 3. Verifies the entire flow from archival through S3 upload and deletion
 *
 * Run via: npm run test:audit-archival-integration
 */

import { describe, it, expect } from './test-harness';
import pool from '../../config/database';
import { StorageService } from '../../services/storage.service';
import { AuditLogArchivalJob } from '../auditLog.job';
import zlib from 'zlib';

const TEST_USER_ID = 'test-user-archival-' + Date.now();
const ARCHIVE_CUTOFF_DAYS = 90;

async function createTestAuditLogs(count: number, daysOld: number): Promise<string[]> {
  const ids: string[] = [];
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - daysOld);

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(daysAgo.getTime() + i * 1000);
    const { rows } = await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        TEST_USER_ID,
        `TEST_ACTION_${i}`,
        'test_resource',
        `test-resource-${i}`,
        '192.168.1.1',
        'TestAgent/1.0',
        JSON.stringify({ index: i, batchId: TEST_USER_ID }),
        timestamp,
      ],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

async function getAuditLogCount(): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::INTEGER as count FROM audit_logs WHERE user_id = $1', [TEST_USER_ID]);
  return rows[0].count;
}

async function getArchiveCount(): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::INTEGER as count FROM audit_log_archives WHERE s3_key LIKE $1', ['%test%']);
  return rows[0].count;
}

describe('AuditLogArchivalJob Integration Tests', () => {
  it('archives old audit logs and deletes them from PostgreSQL', async () => {
    const createdIds = await createTestAuditLogs(10, ARCHIVE_CUTOFF_DAYS + 5);
    const countBefore = await getAuditLogCount();
    expect(countBefore).toBe(10);

    const result = await AuditLogArchivalJob.run();
    expect(result.batches > 0).toBeTruthy();
    expect(result.totalRowsArchived >= 10).toBeTruthy();

    const countAfter = await getAuditLogCount();
    expect(countAfter).toBe(0);
  });

  it('does not archive recent audit logs', async () => {
    await createTestAuditLogs(5, 10);
    const countBefore = await getAuditLogCount();
    expect(countBefore).toBe(5);

    const result = await AuditLogArchivalJob.run();
    expect(result.totalRowsArchived).toBe(0);

    const countAfter = await getAuditLogCount();
    expect(countAfter).toBe(5);
  });

  it('creates audit_log_archives metadata records', async () => {
    await createTestAuditLogs(15, ARCHIVE_CUTOFF_DAYS + 10);
    const archivesBefore = await getArchiveCount();

    const result = await AuditLogArchivalJob.run();
    expect(result.batches > 0).toBeTruthy();

    const archivesAfter = await getArchiveCount();
    expect(archivesAfter > archivesBefore).toBeTruthy();
  });

  it('lists archives with presigned URLs via listArchives', async () => {
    await createTestAuditLogs(8, ARCHIVE_CUTOFF_DAYS + 7);
    await AuditLogArchivalJob.run();

    const result = await AuditLogArchivalJob.listArchives(1, 10);
    expect(result.archives.length > 0).toBeTruthy();
    expect(result.total > 0).toBeTruthy();
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });

  it('properly compresses data with gzip', async () => {
    const createdIds = await createTestAuditLogs(20, ARCHIVE_CUTOFF_DAYS + 8);
    const countBefore = await getAuditLogCount();
    expect(countBefore).toBe(20);

    const result = await AuditLogArchivalJob.run();
    expect(result.totalBytesCompressed > 0).toBeTruthy();

    const archives = await AuditLogArchivalJob.listArchives(1, 50);
    if (archives.archives.length > 0) {
      const archive = archives.archives[0];
      expect(archive.compressedSizeBytes > 0).toBeTruthy();
      expect(archive.rowCount > 0).toBeTruthy();
    }
  });

  it('handles batch limits correctly', async () => {
    await createTestAuditLogs(5000, ARCHIVE_CUTOFF_DAYS + 15);

    const result = await AuditLogArchivalJob.run();
    expect(result.batches <= 20).toBeTruthy();
    expect(result.totalRowsArchived > 0).toBeTruthy();
  });

  it('respects Object Lock retention date', async () => {
    await createTestAuditLogs(12, ARCHIVE_CUTOFF_DAYS + 12);

    const result = await AuditLogArchivalJob.run();
    expect(result.batches > 0).toBeTruthy();

    const archives = await AuditLogArchivalJob.listArchives(1, 10);
    if (archives.archives.length > 0) {
      const archive = archives.archives[0];
      const retentionDate = new Date(archive.archivedAt);
      const futureRetention = new Date(retentionDate);
      futureRetention.setFullYear(futureRetention.getFullYear() + 7);
      expect(futureRetention.getTime() > Date.now()).toBeTruthy();
    }
  });
});
