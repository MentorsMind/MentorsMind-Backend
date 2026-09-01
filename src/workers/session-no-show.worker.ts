import { Worker, Job } from 'bullmq';
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from '../config/queue';
import { pool } from '../config/database';
import { PresenceService } from '../services/presence.service';
import { SorobanEscrowService } from '../services/sorobanEscrow.service';
import { NotificationService } from '../services/notification.service';
import { logger } from '../utils/logger.utils';
import { AuditLoggerService } from '../services/audit-logger.service';
import { LogLevel, AuditAction } from '../utils/log-formatter.utils';
import { redisClient } from '../config/redis';
import type { SessionNoShowJobData } from '../queues/session-no-show.queue';

const SYSTEM_USER_ID = 'system';
const presenceService = new PresenceService(redisClient);
const sorobanEscrowService = new SorobanEscrowService();

/**
 * Penalty configuration (configurable via env)
 * - NO_SHOW_DISPUTE_WINDOW_HOURS: how long the offender has to dispute (default 24h)
 * - NO_SHOW_MENTEE_REFUND_PERCENT: percentage of escrow refunded to the mentee when
 *   the MENTOR no-shows (default 100 — full refund). Lowering this implements a partial
 *   refund so the mentor still receives a reduced payout.
 * - NO_SHOW_MENTOR_PAYOUT_PERCENT: percentage of escrow paid out to the mentor when
 *   the MENTEE no-shows (default 50 — reduced payout vs. 100 on completion).
 */
const DISPUTE_WINDOW_HOURS = parseInt(
  process.env.NO_SHOW_DISPUTE_WINDOW_HOURS || '24',
  10
);
const MENTOR_NO_SHOW_MENTEE_REFUND_PERCENT = parseFloat(
  process.env.NO_SHOW_MENTEE_REFUND_PERCENT || '100'
);
const MENTEE_NO_SHOW_MENTOR_PAYOUT_PERCENT = parseFloat(
  process.env.NO_SHOW_MENTOR_PAYOUT_PERCENT || '50'
);

/** Progressive penalty points by offense count: 1st = 5, 2nd = 10, 3+ = 25 */
function computePenaltyPoints(priorNoShows: number): number {
  if (priorNoShows <= 0) return 5;
  if (priorNoShows === 1) return 10;
  return 25;
}

/**
 * Compute a percentage split of the escrow amount as a decimal string.
 * Amounts are stored as atomic units (strigified), so the percentage is
 * applied on the numeric value and the result is rounded down to a whole token.
 */
function computeSplitAmount(amount: string, percent: number): string {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return `0`;
  }
  const safePercent = Math.max(0, Math.min(100, percent));
  return String(Math.floor((numericAmount * safePercent) / 100));
}

/**
 * Session No-Show Detection Worker
 * 
 * Runs at scheduled_start + grace_period (default: 10 minutes) for each confirmed booking.
 * 
 * Logic:
 * 1. Check if mentor/mentee has joined (mentor_joined_at / mentee_joined_at is set)
 * 2. If not joined, verify the offender is not currently online
 * 3. Update booking status to 'no_show' and set the offender role
 * 4. Apply configurable penalty split (partial refund to mentee, reduced payout to mentor)
 * 5. Initiate automatic Soroban escrow refund to mentee
 * 6. Record a no_show_penalty strike + opening dispute window (default 24h)
 * 7. Send notifications to both mentor and mentee
 * 8. Log audit trail
 * 
 * Idempotency: Uses booking status check to prevent duplicate processing
 */
async function processNoShowCheck(
  job: Job<SessionNoShowJobData>,
): Promise<void> {
  const { bookingId, mentorId, menteeId, scheduledStart, gracePeriodMinutes } = job.data;

  logger.info('Processing no-show check', { 
    jobId: job.id, 
    bookingId,
    scheduledStart,
    gracePeriodMinutes,
  });

  // Fetch current booking state from database (authoritative source)
  const { rows } = await pool.query<{
    id: string;
    status: string;
    mentor_joined_at: Date | null;
    mentee_joined_at: Date | null;
    escrow_id: string | null;
    escrow_contract_address: string | null;
    amount: string;
    currency: string;
  }>(
    `SELECT id, status, mentor_joined_at, mentee_joined_at, 
            escrow_id, escrow_contract_address, amount, currency
     FROM bookings 
     WHERE id = $1`,
    [bookingId]
  );

  const booking = rows[0];

  if (!booking) {
    logger.warn('Booking not found during no-show check', { bookingId });
    return;
  }

  // Skip if booking is no longer in 'confirmed' status
  // This handles cases where booking was cancelled, completed, or already marked as no_show
  if (booking.status !== 'confirmed') {
    logger.info('No-show check skipped — booking status changed', {
      bookingId,
      status: booking.status,
    });
    return;
  }

  const mentorJoined = Boolean(booking.mentor_joined_at);
  const menteeJoined = Boolean(booking.mentee_joined_at);

  // If both participants joined, the session happened — nothing to do.
  if (mentorJoined && menteeJoined) {
    logger.info('No-show check skipped — both participants joined', {
      bookingId,
    });
    return;
  }

  // Determine the offender. If the mentor joined, the mentee is the no-show.
  // If neither joined, the mentor is treated as the offender (the party that
  // owns the session slot) and the mentee receives a (partial) refund.
  const offenderRole: 'mentor' | 'mentee' = mentorJoined ? 'mentee' : 'mentor';
  const offenderId = offenderRole === 'mentor' ? mentorId : menteeId;

  if (offenderRole === 'mentor') {
    // Double-check mentor presence (in case they just joined and DB hasn't updated yet)
    const mentorActive = await presenceService.isMentorActive(mentorId);
    if (mentorActive) {
      logger.info('No-show check skipped — mentor is currently active', {
        bookingId,
        mentorId,
      });
      return;
    }
  } else {
    // Mentor joined but mentee didn't — verify the mentee is not currently active
    const menteeActive = await presenceService.isUserActive(menteeId);
    if (menteeActive) {
      logger.info('No-show check skipped — mentee is currently active', {
        bookingId,
        menteeId,
      });
      return;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CONFIRMED NO-SHOW: Offender did not join within grace period
  // ══════════════════════════════════════════════════════════════════════════

  const noShowDetectedAt = new Date();
  const disputeDeadline = new Date(
    noShowDetectedAt.getTime() + DISPUTE_WINDOW_HOURS * 60 * 60 * 1000
  );

  // Count this user's prior no-shows so the penalty escalates on repeat offenses
  const priorCountResult = await pool.query<{ no_show_count: number }>(
    `SELECT no_show_count FROM users WHERE id = $1`,
    [offenderId]
  );
  const priorNoShows = Number(priorCountResult.rows[0]?.no_show_count) || 0;
  const penaltyPoints = computePenaltyPoints(priorNoShows);

  // Compute the configurable penalty split for the escrow.
  // - Mentor no-show → mentee gets e.g. 100% back (partial if configured lower)
  // - Mentee no-show → mentor gets reduced payout (e.g. 50%)
  const refundPercent =
    offenderRole === 'mentor'
      ? MENTOR_NO_SHOW_MENTEE_REFUND_PERCENT
      : 100 - MENTEE_NO_SHOW_MENTOR_PAYOUT_PERCENT;
  const payoutPercent =
    offenderRole === 'mentor'
      ? 100 - MENTOR_NO_SHOW_MENTEE_REFUND_PERCENT
      : MENTEE_NO_SHOW_MENTOR_PAYOUT_PERCENT;

  logger.warn('No-show detected — initiating penalty + refund process', {
    bookingId,
    offenderRole,
    offenderId,
    priorNoShows,
    penaltyPoints,
    refundPercent,
    payoutPercent,
    scheduledStart,
    gracePeriodMinutes,
    noShowDetectedAt,
    disputeDeadline,
  });

  // Step 1: Update booking status to 'no_show' and record offender / dispute window
  await pool.query(
    `UPDATE bookings 
     SET status = $1, 
         no_show_detected_at = $2,
         no_show_offender_role = $3,
         no_show_dispute_deadline = $4,
         no_show_dispute_status = 'none',
         no_show_penalty_points = $5,
         no_show_refund_percent = $6,
         no_show_payout_percent = $7,
         no_show_refund_amount = $8,
         no_show_payout_amount = $9,
         updated_at = NOW()
     WHERE id = $10`,
    [
      'no_show',
      noShowDetectedAt,
      offenderRole,
      disputeDeadline,
      penaltyPoints,
      refundPercent,
      payoutPercent,
      refundPercent >= 100 ? booking.amount : computeSplitAmount(booking.amount, refundPercent),
      computeSplitAmount(booking.amount, payoutPercent),
      bookingId,
    ]
  );

  logger.info('Booking status updated to no_show', {
    bookingId,
    offenderRole,
    penaltyPoints,
    disputeDeadline,
  });

  // Step 2: Initiate Soroban escrow refund (if escrow exists)
  let refundTxHash: string | null = null;

  if (booking.escrow_id && booking.escrow_contract_address) {
    try {
      // Partial refund to mentee when configured below 100%
      const refundAmount =
        refundPercent >= 100
          ? undefined
          : computeSplitAmount(booking.amount, refundPercent);

      const refundResult = await sorobanEscrowService.refund({
        escrowId: booking.escrow_id,
        contractAddress: booking.escrow_contract_address,
        refundedBy: SYSTEM_USER_ID,
        amount: refundAmount,
      });

      refundTxHash = refundResult.txHash;

      // Record refund transaction hash
      await pool.query(
        `UPDATE bookings 
         SET no_show_refund_tx_hash = $1,
             payment_status = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [refundTxHash, refundPercent < 100 ? 'partially_refunded' : 'refunded', bookingId]
      );

      logger.info('Escrow refund initiated successfully', {
        bookingId,
        escrowId: booking.escrow_id,
        refundAmount,
        txHash: refundTxHash,
      });
    } catch (error) {
      logger.error('Failed to initiate escrow refund', {
        bookingId,
        escrowId: booking.escrow_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Continue with notifications even if refund fails
      // Manual intervention may be required for refund
    }
  } else {
    logger.warn('No escrow found for no-show booking', {
      bookingId,
      escrowId: booking.escrow_id,
    });
  }

  // Step 3: Record no-show penalty strike with dispute window
  await pool.query(
    `INSERT INTO no_show_penalties
       (booking_id, offender_id, offender_role, penalty_points, status, dispute_deadline)
     VALUES ($1, $2, $3, $4, 'applied', $5)
     ON CONFLICT (booking_id) DO NOTHING`,
    [bookingId, offenderId, offenderRole, penaltyPoints, disputeDeadline]
  ).catch((error) => {
    // Penalty ledger is best-effort; the booking status is the source of truth
    logger.warn('Failed to record no-show penalty', {
      bookingId,
      offenderId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });

  // Step 4: Update offender's aggregate no-show count and penalty points
  await pool.query(
    `UPDATE users 
     SET no_show_count = no_show_count + 1,
         active_penalty_points = active_penalty_points + $1,
         updated_at = NOW()
     WHERE id = $2`,
    [penaltyPoints, offenderId]
  ).catch((error) => {
    logger.warn('Failed to update user no-show aggregates', {
      userId: offenderId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });

  // Step 5: Send notifications to both parties
  const refundPercentLabel = `${refundPercent}%`;
  const payoutPercentLabel = `${payoutPercent}%`;
  try {
    if (offenderRole === 'mentor') {
      // Notify mentee (received automatic partial/full refund)
      await NotificationService.sendNotification({
        userId: menteeId,
        type: 'session_no_show',
        title:
          refundPercent >= 100
            ? 'Session No-Show - Automatic Refund Issued'
            : 'Session No-Show - Partial Refund Issued',
        message:
          refundPercent >= 100
            ? `Your mentor did not join the session scheduled for ${new Date(scheduledStart).toLocaleString()}. A full refund has been automatically processed to your wallet.`
            : `Your mentor did not join the session scheduled for ${new Date(scheduledStart).toLocaleString()}. A partial refund (${refundPercentLabel}) has been processed; the rest is held pending the dispute window.`,
        channels: ['email', 'in_app', 'push'],
        data: {
          bookingId,
          mentorId,
          scheduledStart,
          refundAmount: computeSplitAmount(booking.amount, refundPercent),
          refundPercent,
          currency: booking.currency,
          refundTxHash,
        },
      });

      // Notify mentor (warning about no-show + dispute window)
      await NotificationService.sendNotification({
        userId: mentorId,
        type: 'session_no_show',
        title: 'Session No-Show Recorded - Dispute Window Open',
        message: `You did not join the session scheduled for ${new Date(scheduledStart).toLocaleString()}. The mentee has been refunded and ${penaltyPoints} penalty points were levied. You can dispute this within ${DISPUTE_WINDOW_HOURS}h (until ${disputeDeadline.toLocaleString()}).`,
        channels: ['email', 'in_app', 'push'],
        data: {
          bookingId,
          menteeId,
          scheduledStart,
          gracePeriodMinutes,
          penaltyPoints,
          disputeDeadline,
          disputeWindowHours: DISPUTE_WINDOW_HOURS,
        },
      });
    } else {
      // Notify mentor (receives reduced payout as compensation)
      await NotificationService.sendNotification({
        userId: mentorId,
        type: 'session_no_show',
        title: 'Session No-Show - Reduced Payout Issued',
        message: `The mentee did not join the session scheduled for ${new Date(scheduledStart).toLocaleString()}. You will receive a reduced payout of ${payoutPercentLabel} for the attended session time.`,
        channels: ['email', 'in_app', 'push'],
        data: {
          bookingId,
          menteeId,
          scheduledStart,
          payoutPercent,
          payoutAmount: computeSplitAmount(booking.amount, payoutPercent),
          currency: booking.currency,
        },
      });

      // Notify mentee (warning about no-show + dispute window)
      await NotificationService.sendNotification({
        userId: menteeId,
        type: 'session_no_show',
        title: 'Session No-Show Recorded - Dispute Window Open',
        message: `You did not join the session scheduled for ${new Date(scheduledStart).toLocaleString()}. ${penaltyPoints} penalty points were levied. You can dispute this within ${DISPUTE_WINDOW_HOURS}h (until ${disputeDeadline.toLocaleString()}).`,
        channels: ['email', 'in_app', 'push'],
        data: {
          bookingId,
          mentorId,
          scheduledStart,
          gracePeriodMinutes,
          penaltyPoints,
          disputeDeadline,
          disputeWindowHours: DISPUTE_WINDOW_HOURS,
        },
      });
    }

    logger.info('No-show notifications sent', {
      bookingId,
      mentorId,
      menteeId,
      offenderRole,
    });
  } catch (error) {
    logger.error('Failed to send no-show notifications', {
      bookingId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  // Step 6: Log audit trail
  await AuditLoggerService.logEvent({
    level: LogLevel.WARN,
    action: AuditAction.ADMIN_ACTION,
    message: `Session no-show detected and processed`,
    userId: SYSTEM_USER_ID,
    entityType: 'booking',
    entityId: bookingId,
    metadata: {
      mentorId,
      menteeId,
      offenderRole,
      offenderId,
      scheduledStart,
      gracePeriodMinutes,
      noShowDetectedAt,
      penaltyPoints,
      refundPercent,
      payoutPercent,
      disputeDeadline,
      refundTxHash,
      escrowId: booking.escrow_id,
      trigger: 'auto-no-show-detection',
    },
  });

  logger.info('No-show processing completed', {
    bookingId,
    offenderRole,
    penaltyPoints,
    refundTxHash,
  });
}

/**
 * Worker instance for session no-show detection
 */
export const sessionNoShowWorker = new Worker<SessionNoShowJobData>(
  QUEUE_NAMES.SESSION_NO_SHOW,
  processNoShowCheck,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.SESSION_NO_SHOW,
  },
);

sessionNoShowWorker.on('completed', (job) => {
  logger.info('No-show check job completed', {
    jobId: job.id,
    bookingId: job.data.bookingId,
  });
});

sessionNoShowWorker.on('failed', (job, err) => {
  logger.error('No-show check job failed', {
    jobId: job?.id,
    bookingId: job?.data.bookingId,
    error: err.message,
  });
});

sessionNoShowWorker.on('error', (err) => {
  logger.error('Session no-show worker error', { error: err.message });
});
