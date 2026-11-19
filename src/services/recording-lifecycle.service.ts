/**
 * Recording Lifecycle Service — Issue #748
 *
 * Manages S3 storage-class tiering for session recordings:
 *   - STANDARD        → default on upload
 *   - STANDARD_IA     → recordings older than 30 days
 *   - GLACIER         → recordings older than 90 days
 *   - deleted         → recordings past retention expiry
 *
 * Works in tandem with the S3 bucket lifecycle rules configured via
 * StorageService.applyLifecycleRules(), providing application-level
 * tracking so the database always reflects the actual storage tier.
 */

import pool from '../config/database';
import { StorageService } from './storage.service';
import { logger } from '../utils/logger.utils';

export const RecordingLifecycleService = {
  /**
   * Transition recordings older than 30 days to STANDARD_IA storage class.
   * Skips recordings already in STANDARD_IA, GLACIER, DEEP_ARCHIVE, or deleted.
   *
   * @returns counts of successfully transitioned recordings and errors encountered
   */
  async tierRecordingsToInfrequentAccess(): Promise<{
    transitioned: number;
    errors: number;
  }> {
    const result = await pool.query<{ id: string; s3_key: string }>(
      `SELECT id, s3_key
       FROM session_recordings
       WHERE status = 'ready'
         AND created_at < NOW() - INTERVAL '30 days'
         AND (storage_tier IS NULL OR storage_tier NOT IN ('STANDARD_IA', 'GLACIER', 'DEEP_ARCHIVE'))
       ORDER BY created_at ASC`,
    );

    let transitioned = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        await StorageService.transitionStorageClass(row.s3_key, 'STANDARD_IA');

        await pool.query(
          `UPDATE session_recordings
           SET storage_tier = 'STANDARD_IA',
               tiered_at = NOW()
           WHERE id = $1`,
          [row.id],
        );

        transitioned++;
        logger.info(
          `[RecordingLifecycle] Transitioned recording ${row.id} to STANDARD_IA`,
          { s3Key: row.s3_key },
        );
      } catch (error) {
        errors++;
        logger.error(
          `[RecordingLifecycle] Failed to transition recording ${row.id} to STANDARD_IA`,
          {
            s3Key: row.s3_key,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return { transitioned, errors };
  },

  /**
   * Transition recordings older than 90 days to GLACIER storage class.
   * Skips recordings already in GLACIER, DEEP_ARCHIVE, or deleted.
   *
   * @returns counts of successfully transitioned recordings and errors encountered
   */
  async tierRecordingsToGlacier(): Promise<{
    transitioned: number;
    errors: number;
  }> {
    const result = await pool.query<{ id: string; s3_key: string }>(
      `SELECT id, s3_key
       FROM session_recordings
       WHERE status = 'ready'
         AND created_at < NOW() - INTERVAL '90 days'
         AND (storage_tier IS NULL OR storage_tier NOT IN ('GLACIER', 'DEEP_ARCHIVE'))
       ORDER BY created_at ASC`,
    );

    let transitioned = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        await StorageService.transitionStorageClass(row.s3_key, 'GLACIER');

        await pool.query(
          `UPDATE session_recordings
           SET storage_tier = 'GLACIER',
               tiered_at = NOW()
           WHERE id = $1`,
          [row.id],
        );

        transitioned++;
        logger.info(
          `[RecordingLifecycle] Transitioned recording ${row.id} to GLACIER`,
          { s3Key: row.s3_key },
        );
      } catch (error) {
        errors++;
        logger.error(
          `[RecordingLifecycle] Failed to transition recording ${row.id} to GLACIER`,
          {
            s3Key: row.s3_key,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return { transitioned, errors };
  },

  /**
   * Delete recordings that have passed their retention expiry date.
   * Removes the object from S3 and marks the DB row as deleted.
   *
   * @returns counts of successfully deleted recordings and errors encountered
   */
  async enforceRetentionPolicy(): Promise<{
    deleted: number;
    errors: number;
  }> {
    const result = await pool.query<{ id: string; s3_key: string }>(
      `SELECT id, s3_key
       FROM session_recordings
       WHERE status != 'deleted'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       ORDER BY expires_at ASC`,
    );

    let deleted = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        await StorageService.deleteFile(row.s3_key);

        await pool.query(
          `UPDATE session_recordings
           SET status = 'deleted',
               storage_tier = 'deleted',
               tiered_at = NOW()
           WHERE id = $1`,
          [row.id],
        );

        deleted++;
        logger.info(
          `[RecordingLifecycle] Deleted expired recording ${row.id}`,
          { s3Key: row.s3_key },
        );
      } catch (error) {
        errors++;
        logger.error(
          `[RecordingLifecycle] Failed to delete expired recording ${row.id}`,
          {
            s3Key: row.s3_key,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return { deleted, errors };
  },

  /**
   * Return a summary of how many recordings exist in each storage tier.
   *
   * @returns counts per tier: standard, standardIA, glacier, deleted
   */
  async getLifecycleReport(): Promise<{
    standard: number;
    standardIA: number;
    glacier: number;
    deleted: number;
  }> {
    const result = await pool.query<{ storage_tier: string | null; count: string }>(
      `SELECT
         COALESCE(storage_tier, 'STANDARD') AS storage_tier,
         COUNT(*) AS count
       FROM session_recordings
       GROUP BY COALESCE(storage_tier, 'STANDARD')`,
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.storage_tier as string] = parseInt(row.count, 10);
    }

    return {
      standard: counts['STANDARD'] ?? 0,
      standardIA: counts['STANDARD_IA'] ?? 0,
      glacier: counts['GLACIER'] ?? 0,
      deleted: counts['deleted'] ?? 0,
    };
  },
};
