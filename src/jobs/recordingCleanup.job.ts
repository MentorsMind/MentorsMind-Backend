/**
 * Recording Cleanup Job — Issue #449
 *
 * Runs daily via BullMQ repeatable job.
 * Deletes expired session recordings (older than 90 days) from S3 and marks them as deleted in the database.
 * Ensures privacy compliance by automatically removing recordings after the retention period.
 */

import { SessionRecordingService } from '../services/session-recording.service';
import { logger } from '../utils/logger.utils';

/**
 * Main entry point — called by the BullMQ worker daily.
 * Finds all expired recordings and deletes them from S3 and the database.
 */
export async function runRecordingCleanupJob(): Promise<void> {
  try {
    logger.info('[RecordingCleanup] Starting recording cleanup job');

    // Find all expired recordings
    const expiredRecordings = await SessionRecordingService.findExpiredRecordings();

    if (expiredRecordings.length === 0) {
      logger.info('[RecordingCleanup] No expired recordings found');
      return;
    }

    logger.info(`[RecordingCleanup] Found ${expiredRecordings.length} expired recordings`);

    // Process each expired recording
    let successCount = 0;
    let failureCount = 0;

    for (const recording of expiredRecordings) {
      try {
        await SessionRecordingService.cleanupExpiredRecording(recording.id);
        successCount++;
        logger.info(`[RecordingCleanup] Successfully cleaned up recording ${recording.id}`, {
          sessionId: recording.session_id,
          expiresAt: recording.expires_at,
        });
      } catch (error) {
        failureCount++;
        logger.error(`[RecordingCleanup] Failed to clean up recording ${recording.id}`, {
          sessionId: recording.session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue processing remaining recordings — don't let one failure block others
      }
    }

    logger.info('[RecordingCleanup] Recording cleanup job completed', {
      total: expiredRecordings.length,
      success: successCount,
      failure: failureCount,
    });
  } catch (error) {
    logger.error('[RecordingCleanup] Recording cleanup job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error; // Re-throw to let BullMQ handle the failure
  }
}
