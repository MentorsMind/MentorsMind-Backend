import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { TranscriptionService } from '../services/transcription.service';
import { transcriptionQueue } from '../queues/transcription.queue';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';
import pool from '../config/database';
import { logger } from '../utils/logger';

export const TranscriptionController = {
  /**
   * POST /api/v1/bookings/:id/transcription
   * Trigger transcription for a completed session.
   * Body: { mediaS3Key: string }
   */
  triggerTranscription: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id: bookingId } = req.params;
    const userId = req.user?.userId;
    const { mediaS3Key } = req.body;

    if (!mediaS3Key) {
      return ResponseUtil.error(res, 'mediaS3Key is required', 400);
    }

    // Verify the user is a participant of this booking
    const { rows } = await pool.query(
      'SELECT id, status, mentor_id, mentee_id FROM bookings WHERE id = $1',
      [bookingId],
    );
    const booking = rows[0];
    if (!booking) return ResponseUtil.error(res, 'Booking not found', 404);
    if (booking.mentor_id !== userId && booking.mentee_id !== userId) {
      return ResponseUtil.error(res, 'Forbidden', 403);
    }
    if (!['completed', 'in_progress'].includes(booking.status)) {
      return ResponseUtil.error(res, 'Transcription is only available for completed sessions', 400);
    }

    const transcript = await TranscriptionService.createTranscriptRecord(bookingId, mediaS3Key);

    await transcriptionQueue.add('start', {
      transcriptId: transcript.id,
      bookingId,
      action: 'start',
    });

    logger.info('[TranscriptionController] Transcription queued', { bookingId, transcriptId: transcript.id });

    return ResponseUtil.success(res, { transcript }, 'Transcription started', 202);
  }),

  /**
   * GET /api/v1/bookings/:id/transcription
   * Get transcript status and content for a booking.
   */
  getTranscript: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id: bookingId } = req.params;
    const userId = req.user?.userId;

    const { rows } = await pool.query(
      'SELECT mentor_id, mentee_id FROM bookings WHERE id = $1',
      [bookingId],
    );
    const booking = rows[0];
    if (!booking) return ResponseUtil.error(res, 'Booking not found', 404);
    if (booking.mentor_id !== userId && booking.mentee_id !== userId) {
      return ResponseUtil.error(res, 'Forbidden', 403);
    }

    const transcript = await TranscriptionService.getByBookingId(bookingId);
    if (!transcript) return ResponseUtil.error(res, 'Transcript not found', 404);

    return ResponseUtil.success(res, { transcript });
  }),

  /**
   * GET /api/v1/bookings/:id/transcription/download?format=pdf|txt
   * Download transcript as PDF or TXT.
   */
  downloadTranscript: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id: bookingId } = req.params;
    const userId = req.user?.userId;
    const format = (req.query.format as string) ?? 'txt';

    if (!['pdf', 'txt'].includes(format)) {
      return ResponseUtil.error(res, 'format must be pdf or txt', 400);
    }

    const { rows } = await pool.query(
      'SELECT mentor_id, mentee_id FROM bookings WHERE id = $1',
      [bookingId],
    );
    const booking = rows[0];
    if (!booking) return ResponseUtil.error(res, 'Booking not found', 404);
    if (booking.mentor_id !== userId && booking.mentee_id !== userId) {
      return ResponseUtil.error(res, 'Forbidden', 403);
    }

    const transcript = await TranscriptionService.getByBookingId(bookingId);
    if (!transcript) return ResponseUtil.error(res, 'Transcript not found', 404);
    if (transcript.status !== 'completed') {
      return ResponseUtil.error(res, 'Transcript is not yet ready', 409);
    }

    const s3Key = format === 'pdf' ? transcript.pdf_s3_key : transcript.txt_s3_key;
    if (!s3Key) return ResponseUtil.error(res, 'Export file not available', 404);

    const url = await TranscriptionService.getDownloadUrl(s3Key, 300);
    return ResponseUtil.success(res, { url, expiresIn: 300 });
  }),

  /**
   * GET /api/v1/transcriptions/search?q=...&limit=20&offset=0
   * Full-text search across the user's transcripts.
   */
  searchTranscripts: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    const q = (req.query.q as string)?.trim();
    const limit = Math.min(parseInt((req.query.limit as string) ?? '20', 10), 100);
    const offset = parseInt((req.query.offset as string) ?? '0', 10);

    if (!q || q.length < 2) {
      return ResponseUtil.error(res, 'Query must be at least 2 characters', 400);
    }

    const results = await TranscriptionService.search(userId!, q, limit, offset);
    return ResponseUtil.success(res, { results, total: results.length });
  }),
};
