import { Worker, Job } from "bullmq";
import { redisConnection, QUEUE_NAMES } from "../config/queue";
import { logger } from "../utils/logger.utils";
import { stellarService } from "../services/stellar.service";
import pool from "../config/database";
import { EnhancedReferralService } from "../services/referral-enhanced.service";

/**
 * Referral Payout Worker
 * Processes referral reward payouts after 7-day hold period
 * Retries on Stellar network failure
 */

interface ReferralPayoutJob {
  referrerId: string;
  refereeId: string;
  bookingId: string;
  rewardAmount: number;
  referrerStellarKey: string;
}

const worker = new Worker<ReferralPayoutJob>(
  QUEUE_NAMES.REFERRAL_REWARD,
  async (job: Job<ReferralPayoutJob>) => {
    const { referrerId, refereeId, bookingId, rewardAmount, referrerStellarKey } = job.data;

    logger.info('Processing referral payout', {
      jobId: job.id,
      referrerId,
      refereeId,
      rewardAmount
    });

    try {
      // Step 1: Verify booking still exists and is completed
      const { rows: bookingRows } = await pool.query(
        `SELECT status FROM bookings WHERE id = $1`,
        [bookingId]
      );

      if (bookingRows.length === 0 || bookingRows[0].status !== 'completed') {
        logger.warn('Booking not found or not completed - rejecting payout', {
          bookingId,
          status: bookingRows[0]?.status
        });

        // Log rejected reward
        await EnhancedReferralService.logReferralEvent({
          eventType: 'reward_paid',
          referrerId,
          refereeId,
          referralCode: 'SYSTEM',
          rewardAmount,
          rewardCurrency: 'XLM',
          rewardStatus: 'rejected',
          qualifyingBookingId: bookingId,
          payoutCompletedAt: new Date(),
          metadata: {
            rejection_reason: 'booking_not_completed',
            booking_status: bookingRows[0]?.status
          }
        });

        return { success: false, reason: 'booking_not_completed' };
      }

      // Step 2: Check for chargebacks or disputes
      const { rows: disputeRows } = await pool.query(
        `SELECT COUNT(*) as count FROM disputes 
         WHERE booking_id = $1 AND status IN ('pending', 'investigating', 'resolved_refund')`,
        [bookingId]
      );

      if (parseInt(disputeRows[0].count, 10) > 0) {
        logger.warn('Dispute detected - delaying payout', {
          bookingId,
          referrerId
        });

        // Delay for another 7 days
        throw new Error('Dispute detected - retrying later');
      }

      // Step 3: Build and submit Stellar transaction
      logger.info('Building Stellar refund transaction for referral reward', {
        referrerId,
        referrerStellarKey,
        rewardAmount
      });

      const txXdr = await stellarService.buildRefundTransaction(
        referrerStellarKey,
        rewardAmount.toString()
      );

      // Submit transaction to Stellar network
      const submitResult = await stellarService.submitTransaction(txXdr);

      if (!submitResult.successful) {
        throw new Error(`Stellar transaction failed: ${submitResult.result_xdr}`);
      }

      const txHash = submitResult.hash;

      logger.info('Stellar transaction successful', {
        txHash,
        referrerId,
        rewardAmount
      });

      // Step 4: Record transaction in database
      await pool.query(
        `INSERT INTO transactions (
          user_id, type, status, amount, currency,
          stellar_tx_hash, from_address, to_address,
          booking_id, processed_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)`,
        [
          referrerId,
          'referral_reward',
          'completed',
          rewardAmount,
          'XLM',
          txHash,
          process.env.STELLAR_PLATFORM_PUBLIC_KEY,
          referrerStellarKey,
          bookingId,
          JSON.stringify({
            referee_id: refereeId,
            reward_type: 'first_booking'
          })
        ]
      );

      // Step 5: Log successful payout event
      await EnhancedReferralService.logReferralEvent({
        eventType: 'reward_paid',
        referrerId,
        refereeId,
        referralCode: 'SYSTEM',
        rewardAmount,
        rewardCurrency: 'XLM',
        rewardStatus: 'paid',
        qualifyingBookingId: bookingId,
        stellarTxHash: txHash,
        payoutCompletedAt: new Date(),
        metadata: {
          stellar_ledger: submitResult.ledger,
          payout_job_id: job.id
        }
      });

      logger.info('Referral payout completed successfully', {
        jobId: job.id,
        referrerId,
        refereeId,
        txHash,
        rewardAmount
      });

      return {
        success: true,
        txHash,
        rewardAmount
      };

    } catch (error) {
      logger.error('Referral payout failed', {
        jobId: job.id,
        referrerId,
        refereeId,
        attempt: job.attemptsMade,
        error: error instanceof Error ? error.message : error
      });

      // If max retries exhausted, mark as failed
      if (job.attemptsMade >= (job.opts.attempts || 5)) {
        await EnhancedReferralService.logReferralEvent({
          eventType: 'reward_paid',
          referrerId,
          refereeId,
          referralCode: 'SYSTEM',
          rewardAmount,
          rewardCurrency: 'XLM',
          rewardStatus: 'rejected',
          qualifyingBookingId: bookingId,
          payoutCompletedAt: new Date(),
          metadata: {
            rejection_reason: 'max_retries_exceeded',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            attempts: job.attemptsMade
          }
        });

        logger.error('Referral payout permanently failed after max retries', {
          jobId: job.id,
          referrerId,
          attempts: job.attemptsMade
        });
      }

      throw error; // Re-throw to trigger retry
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
    limiter: {
      max: 10, // Max 10 payouts per minute to avoid Stellar rate limits
      duration: 60000
    }
  }
);

worker.on("completed", (job) => {
  logger.info("Referral payout job completed", {
    jobId: job.id,
    referrerId: job.data.referrerId
  });
});

worker.on("failed", (job, error) => {
  logger.error("Referral payout job failed", {
    jobId: job?.id,
    referrerId: job?.data.referrerId,
    error: error.message
  });
});

worker.on("error", (error) => {
  logger.error("Referral payout worker error", { error: error.message });
});

logger.info("Referral payout worker started", {
  queue: QUEUE_NAMES.REFERRAL_REWARD
});

export default worker;
