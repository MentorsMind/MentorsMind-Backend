import { Router } from 'express';
import { SessionRecordingController } from '../controllers/session-recording.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';

const router = Router();

// All recording routes require authentication
router.use(authenticate);

// Start recording for a session
router.post(
  '/sessions/:sessionId/recordings/start',
  asyncHandler(SessionRecordingController.startRecording),
);

// Upload recording data (typically for streaming or multipart uploads)
router.post(
  '/recordings/:recordingId/upload',
  asyncHandler(SessionRecordingController.uploadRecording),
);

// Mark recording as complete after processing
router.post(
  '/recordings/:recordingId/complete',
  asyncHandler(SessionRecordingController.completeRecording),
);

// Update consent for a recording
router.post(
  '/recordings/:recordingId/consent',
  asyncHandler(SessionRecordingController.updateConsent),
);

// Generate playback URL for a recording
router.get(
  '/recordings/:recordingId/playback-url',
  asyncHandler(SessionRecordingController.generatePlaybackUrl),
);

// Get recording details
router.get(
  '/recordings/:recordingId',
  asyncHandler(SessionRecordingController.getRecording),
);

// Get all recordings for the current user
router.get(
  '/recordings',
  asyncHandler(SessionRecordingController.getUserRecordings),
);

// Delete a recording
router.delete(
  '/recordings/:recordingId',
  asyncHandler(SessionRecordingController.deleteRecording),
);

// Transcription endpoints
router.post(
  '/recordings/:recordingId/transcription',
  asyncHandler(SessionRecordingController.startTranscription),
);

router.get(
  '/recordings/:recordingId/transcription',
  asyncHandler(SessionRecordingController.getTranscription),
);

router.get(
  '/transcriptions/search',
  asyncHandler(SessionRecordingController.searchTranscriptions),
);

// Bookmark endpoints
router.post(
  '/recordings/:recordingId/bookmarks',
  asyncHandler(SessionRecordingController.createBookmark),
);

router.get(
  '/recordings/:recordingId/bookmarks',
  asyncHandler(SessionRecordingController.getBookmarks),
);

router.get(
  '/bookmarks',
  asyncHandler(SessionRecordingController.getUserBookmarks),
);

router.put(
  '/bookmarks/:bookmarkId',
  asyncHandler(SessionRecordingController.updateBookmark),
);

router.delete(
  '/bookmarks/:bookmarkId',
  asyncHandler(SessionRecordingController.deleteBookmark),
);

router.get(
  '/recordings/:recordingId/bookmarks/export',
  asyncHandler(SessionRecordingController.exportBookmarks),
);

export default router;
