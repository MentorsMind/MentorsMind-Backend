import { Router } from 'express';
import { SessionSummaryController } from '../controllers/session-summary.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';

const router = Router();

// All summary routes require authentication
router.use(authenticate);

// Generate a session summary for a booking
router.post(
  '/bookings/:bookingId/summaries',
  asyncHandler(SessionSummaryController.generateSummary),
);

// Get session summary by booking ID
router.get(
  '/bookings/:bookingId/summaries',
  asyncHandler(SessionSummaryController.getSummaryByBooking),
);

// Get session summary by session ID
router.get(
  '/sessions/:sessionId/summary',
  asyncHandler(SessionSummaryController.getSummaryBySession),
);

// Get session summary by ID
router.get(
  '/summaries/:id',
  asyncHandler(SessionSummaryController.getSummaryById),
);

// Get all summaries for the current user
router.get(
  '/summaries',
  asyncHandler(SessionSummaryController.getUserSummaries),
);

// Regenerate a session summary
router.post(
  '/summaries/:id/regenerate',
  asyncHandler(SessionSummaryController.regenerateSummary),
);

// Delete a session summary
router.delete(
  '/summaries/:id',
  asyncHandler(SessionSummaryController.deleteSummary),
);

export default router;
