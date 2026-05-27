/**
 * Verification Expiry Job — Issue #448
 *
 * Runs daily via BullMQ repeatable job.
 * Flags expired mentor verifications (older than 1 year) and removes verified status.
 */

import { VerificationService } from '../services/verification.service';
import { logger } from '../utils/logger.utils';

/**
 * Main entry point — called by the BullMQ worker daily.
 * Finds all expired verifications and updates their status.
 */
export async function runVerificationExpiryJob(): Promise<void> {
  try {
    logger.info('[VerificationExpiry] Starting verification expiry job');

    const expiredCount = await VerificationService.flagExpiredVerifications();

    logger.info('[VerificationExpiry] Verification expiry job completed', {
      expiredCount,
    });
  } catch (error) {
    logger.error('[VerificationExpiry] Verification expiry job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error; // Re-throw to let BullMQ handle the failure
  }
}
