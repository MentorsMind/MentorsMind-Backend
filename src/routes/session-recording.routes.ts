import express, { Router } from 'express';
import { SessionRecordingController } from '../controllers/session-recording.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import {
  requireSessionParticipant,
  requireRecordingParticipant,
} from '../middleware/session-participant.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { validate } from '../middleware/validation.middleware';
import {
  startRecordingSchema,
  recordingIdParamSchema,
  uploadRecordingSchema,
  completeRecordingSchema,
  updateConsentSchema,
  generatePlaybackUrlSchema,
  startTranscriptionSchema,
  searchTranscriptionsSchema,
  createBookmarkSchema,
  bookmarkIdParamSchema,
  updateBookmarkSchema,
} from '../validators/schemas/session-recording.schemas';

const router = Router();

// All recording routes require authentication
router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// Consent endpoints
// Both participants must consent before a recording can start.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /sessions/:sessionId/recording/consent
 * Grant recording consent for the current user.
 * Accessible to session participants only.
 */
router.post(
  '/sessions/:sessionId/recording/consent',
  requireSessionParticipant,
  asyncHandler(SessionRecordingController.grantRecordingConsent),
);

/**
 * DELETE /sessions/:sessionId/recording/consent
 * Revoke recording consent. Stops any active recording on this session.
 * Accessible to session participants only.
 */
router.delete(
  '/sessions/:sessionId/recording/consent',
  requireSessionParticipant,
  asyncHandler(SessionRecordingController.revokeRecordingConsent),
);

/**
 * GET /sessions/:sessionId/recording/consent
 * Get current consent status for both participants.
 * Accessible to session participants only.
 */
router.get(
  '/sessions/:sessionId/recording/consent',
  requireSessionParticipant,
  asyncHandler(SessionRecordingController.getRecordingConsentStatus),
);

// ─────────────────────────────────────────────────────────────────────────────
// Session-scoped recording endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /sessions/:sessionId/recordings/start
 * Start recording a session.
 * Requires: session participant + both-party consent (checked in controller).
 */
router.post(
  '/sessions/:sessionId/recordings/start',
  requireSessionParticipant,
  asyncHandler(SessionRecordingController.startRecording),
);

// ─────────────────────────────────────────────────────────────────────────────
// Recording-scoped endpoints (participant or admin required)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /recordings/:recordingId/playback-url
 * Generate a playback URL.
 * Participants or admin only.
 */
router.get(
  '/recordings/:recordingId/playback-url',
  requireRecordingParticipant,
  asyncHandler(SessionRecordingController.generatePlaybackUrl),
);

/**
 * GET /recordings/:recordingId
 * Get recording details.
 * Participants or admin only.
 */
router.get(
  '/recordings/:recordingId',
  requireRecordingParticipant,
  asyncHandler(SessionRecordingController.getRecording),
);

/**
 * DELETE /recordings/:recordingId
 * Delete a recording.
 * Participants or admin only.
 */
router.delete(
  '/recordings/:recordingId',
  requireRecordingParticipant,
  asyncHandler(SessionRecordingController.deleteRecording),
);

/**
 * POST /recordings/:recordingId/transcription
 * Start transcription.
 * Participants or admin only.
 */
router.post(
  '/recordings/:recordingId/transcription',
  requireRecordingParticipant,
  asyncHandler(SessionRecordingController.startTranscription),
);

/**
 * GET /recordings/:recordingId/transcription
 * Get transcription.
 * Participants or admin only.
 */
router.get(
  '/recordings/:recordingId/transcription',
  requireRecordingParticipant,
  asyncHandler(SessionRecordingController.getTranscription),
);

// ─────────────────────────────────────────────────────────────────────────────
// Bookmark endpoints (participant-scoped via recording)
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/recordings/:recordingId/bookmarks',
  requireRecordingParticipant,
  asyncHandler(SessionRecordingController.createBookmark),
);

router.get(
  '/recordings/:recordingId/bookmarks',
  requireRecordingParticipant,
  asyncHandler(SessionRecordingController.getBookmarks),
);

router.get(
  '/recordings/:recordingId/bookmarks/export',
  requireRecordingParticipant,
  asyncHandler(SessionRecordingController.exportBookmarks),
);

// ─────────────────────────────────────────────────────────────────────────────
// User-scoped endpoints (authenticated user only, no extra participant check)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /recordings — list recordings for the current user */
router.get(
  '/recordings',
  asyncHandler(SessionRecordingController.getUserRecordings),
);

/** GET /bookmarks — list bookmarks for the current user */
router.get(
  '/bookmarks',
  asyncHandler(SessionRecordingController.getUserBookmarks),
);

router.put(
  '/bookmarks/:bookmarkId',
  validate(updateBookmarkSchema),
  asyncHandler(SessionRecordingController.updateBookmark),
);

router.delete(
  '/bookmarks/:bookmarkId',
  validate(bookmarkIdParamSchema),
  asyncHandler(SessionRecordingController.deleteBookmark),
);

/** GET /transcriptions/search — full-text search across user's transcriptions */
router.get(
  '/transcriptions/search',
  asyncHandler(SessionRecordingController.searchTranscriptions),
);

// ─────────────────────────────────────────────────────────────────────────────
// Upload / completion (internal / service-to-service endpoints)
// These update an existing recording record; the caller must be authenticated.
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/recordings/:recordingId/upload',
  express.json({ limit: '50mb' }),
  asyncHandler(SessionRecordingController.uploadRecording),
);

router.post(
  '/recordings/:recordingId/complete',
  asyncHandler(SessionRecordingController.completeRecording),
);

// Legacy per-recording consent update (kept for backward compatibility)
router.post(
  '/recordings/:recordingId/consent',
  asyncHandler(SessionRecordingController.updateConsent),
);

export default router;
