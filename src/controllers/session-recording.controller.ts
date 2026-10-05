import { Response } from 'express';
import { SessionRecordingService } from '../services/session-recording.service';
import recordingTranscriptionService from '../services/recording-transcription.service';
import recordingBookmarkService from '../services/recording-bookmark.service';
import { Logger } from "../utils/logger.utils";
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AuditLogService } from '../services/auditLog.service';
import RecordingConsentService from '../services/recording-consent.service';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Resolve the canonical userId from the request user object. */
const resolveUserId = (req: AuthenticatedRequest): string | undefined =>
  req.user?.userId || req.user?.id;

/** Extract client IP (first hop only). */
const resolveIp = (req: AuthenticatedRequest): string | null =>
  (typeof req.headers['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : req.ip) ?? null;

/** Log a recording-access audit event (non-blocking). */
const auditRecordingAccess = (
  req: AuthenticatedRequest,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
) => {
  const userId = resolveUserId(req) ?? null;
  AuditLogService.log({
    userId,
    action,
    resourceType: 'session_recording',
    resourceId,
    ipAddress: resolveIp(req),
    userAgent: req.headers['user-agent'] ?? null,
    metadata,
  }).catch((err) =>
    logger.error('Failed to write recording audit log', { err, action, resourceId }),
  );
};

export const SessionRecordingController = {
  /**
   * POST /api/v1/sessions/:sessionId/recordings/start
   * Start recording a session.
   *
   * Guards (applied in routes):
   *   - authenticate
   *   - requireSessionParticipant   → populates req.sessionParticipants
   *
   * Additional business rule enforced here:
   *   Both mentor and mentee must have granted explicit consent before the
   *   recording can start (recording_consent table).
   */
  async startRecording(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { sessionId } = req.params as Record<string, string>;
      const { format } = req.body as { format?: string };

      // Participant data was attached by requireSessionParticipant middleware
      const participants = req.sessionParticipants;
      if (!participants) {
        return res.status(403).json({ success: false, error: 'Session participant data missing' });
      }

      // Consent gate: both parties must have explicitly consented
      const consented = await RecordingConsentService.bothParticipantsConsented(sessionId);
      if (!consented) {
        const status = await RecordingConsentService.getSessionConsentStatus(sessionId);
        return res.status(403).json({
          success: false,
          error: 'Recording cannot start: both participants must grant consent first',
          data: {
            mentorConsented: status.mentorConsented,
            menteeConsented: status.menteeConsented,
          },
        });
      }

      const result = await SessionRecordingService.startRecording({
        sessionId,
        mentorId: participants.mentorId,
        menteeId: participants.menteeId,
        format,
      });

      auditRecordingAccess(req, 'RECORDING_STARTED', result.recordingId, {
        sessionId,
        format,
      });

      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error starting recording:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start recording',
      });
    }
  },

  /**
   * POST /api/v1/recordings/:recordingId/upload
   * Upload recording data to S3
   */
  async uploadRecording(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;
      
      // This endpoint would typically handle multipart/form-data uploads
      // For now, we'll assume the file is passed as a buffer in the body
      // In production, use multer or similar middleware for file uploads
      
      return res.status(501).json({
        success: false,
        error: 'File upload not implemented - use streaming upload endpoint',
      });
    } catch (error) {
      logger.error('Error uploading recording:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload recording',
      });
    }
  },

  /**
   * POST /api/v1/recordings/:recordingId/complete
   * Mark recording as complete after processing
   */
  async completeRecording(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;
      const { fileSize, durationSeconds, metadata } = req.body as {
        fileSize: number;
        durationSeconds: number;
        metadata?: Record<string, any>;
      };

      await SessionRecordingService.completeRecording(
        recordingId,
        fileSize,
        durationSeconds,
        metadata || {},
      );

      return res.status(200).json({
        success: true,
        message: 'Recording completed successfully',
      });
    } catch (error) {
      logger.error('Error completing recording:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete recording',
      });
    }
  },

  /**
   * POST /api/v1/sessions/:sessionId/recording/consent
   * Grant recording consent for the current user in this session.
   *
   * Guards (applied in routes):
   *   - authenticate
   *   - requireSessionParticipant
   */
  async grantRecordingConsent(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { sessionId } = req.params as Record<string, string>;
      const participants = req.sessionParticipants;
      if (!participants) {
        return res.status(403).json({ success: false, error: 'Session participant data missing' });
      }

      const userRole = userId === participants.mentorId ? 'mentor' : 'mentee';

      const record = await RecordingConsentService.grantConsent({
        sessionId,
        userId,
        userRole,
        ipAddress: resolveIp(req),
        userAgent: req.headers['user-agent'] ?? null,
      });

      // Return updated overall status so the client knows if recording can start
      const status = await RecordingConsentService.getSessionConsentStatus(sessionId);

      return res.status(200).json({
        success: true,
        message: 'Consent granted',
        data: {
          record,
          sessionStatus: {
            mentorConsented: status.mentorConsented,
            menteeConsented: status.menteeConsented,
            bothConsented: status.bothConsented,
          },
        },
      });
    } catch (error) {
      logger.error('Error granting recording consent:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to grant consent',
      });
    }
  },

  /**
   * DELETE /api/v1/sessions/:sessionId/recording/consent
   * Revoke recording consent for the current user.
   *
   * If a recording is currently active on this session it will be stopped.
   *
   * Guards (applied in routes):
   *   - authenticate
   *   - requireSessionParticipant
   */
  async revokeRecordingConsent(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { sessionId } = req.params as Record<string, string>;

      const record = await RecordingConsentService.revokeConsent({
        sessionId,
        userId,
        ipAddress: resolveIp(req),
        userAgent: req.headers['user-agent'] ?? null,
      });

      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'No consent record found for this session',
        });
      }

      // Stop any active recording because consent was revoked
      const stoppedRecordingId = await RecordingConsentService.stopActiveRecordingOnRevocation(
        sessionId,
        userId,
      );

      if (stoppedRecordingId) {
        auditRecordingAccess(req, 'RECORDING_STOPPED_CONSENT_REVOKED', stoppedRecordingId, {
          sessionId,
          revokedByUserId: userId,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Consent revoked',
        data: {
          record,
          recordingStopped: stoppedRecordingId !== null,
          stoppedRecordingId,
        },
      });
    } catch (error) {
      logger.error('Error revoking recording consent:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to revoke consent',
      });
    }
  },

  /**
   * GET /api/v1/sessions/:sessionId/recording/consent
   * Get the current consent status for both participants.
   *
   * Guards (applied in routes):
   *   - authenticate
   *   - requireSessionParticipant
   */
  async getRecordingConsentStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { sessionId } = req.params as Record<string, string>;
      const status = await RecordingConsentService.getSessionConsentStatus(sessionId);

      return res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error) {
      logger.error('Error fetching consent status:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch consent status',
      });
    }
  },

  /**
   * POST /api/v1/recordings/:recordingId/consent
   * Update consent for a recording (legacy endpoint — kept for backward compat)
   */
  async updateConsent(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;
      const { consent } = req.body as { consent: boolean };

      const ipAddress = req.ip || req.connection?.remoteAddress;
      const userAgent = req.get('user-agent');

      await SessionRecordingService.updateConsent(
        recordingId,
        userId,
        consent,
        ipAddress,
        userAgent,
      );

      return res.status(200).json({
        success: true,
        message: 'Consent updated successfully',
      });
    } catch (error) {
      logger.error('Error updating consent:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update consent',
      });
    }
  },

  /**
   * GET /api/v1/recordings/:recordingId/playback-url
   * Generate a playback URL for a recording.
   *
   * Guards (applied in routes):
   *   - authenticate
   *   - requireRecordingParticipant (or requireRole admin)
   */
  async generatePlaybackUrl(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;
      const { expiresIn } = req.query as { expiresIn?: string };

      const result = await SessionRecordingService.generatePlaybackUrl(
        recordingId,
        expiresIn ? parseInt(expiresIn, 10) : 3600,
      );

      auditRecordingAccess(req, 'RECORDING_PLAYBACK_URL_GENERATED', recordingId, {
        expiresIn: expiresIn ?? 3600,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error generating playback URL:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate playback URL',
      });
    }
  },

  /**
   * GET /api/v1/recordings/:recordingId
   * Get recording details.
   *
   * Guards (applied in routes):
   *   - authenticate
   *   - requireRecordingParticipant (or requireRole admin)
   */
  async getRecording(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;

      const recording = await SessionRecordingService.getRecording(recordingId, userId);

      auditRecordingAccess(req, 'RECORDING_ACCESSED', recordingId, {});

      return res.status(200).json({
        success: true,
        data: recording,
      });
    } catch (error) {
      logger.error('Error getting recording:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get recording',
      });
    }
  },

  /**
   * GET /api/v1/recordings
   * Get all recordings for the current user
   */
  async getUserRecordings(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const recordings = await SessionRecordingService.getUserRecordings(userId);

      return res.status(200).json({
        success: true,
        data: recordings,
      });
    } catch (error) {
      logger.error('Error getting user recordings:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get recordings',
      });
    }
  },

  /**
   * DELETE /api/v1/recordings/:recordingId
   * Delete a recording
   */
  async deleteRecording(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;

      await SessionRecordingService.deleteRecording(recordingId, userId);

      auditRecordingAccess(req, 'RECORDING_DELETED', recordingId, {});

      return res.status(200).json({
        success: true,
        message: 'Recording deleted successfully',
      });
    } catch (error) {
      logger.error('Error deleting recording:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete recording',
      });
    }
  },

  /**
   * POST /api/v1/recordings/:recordingId/transcription
   * Start transcription for a recording
   */
  async startTranscription(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;
      const { language = 'en' } = req.body as { language?: string };

      const transcriptionId = await recordingTranscriptionService.startTranscription({
        recordingId,
        language,
      });

      auditRecordingAccess(req, 'RECORDING_TRANSCRIPTION_STARTED', recordingId, { language });

      return res.status(200).json({
        success: true,
        data: { transcriptionId },
      });
    } catch (error) {
      logger.error('Failed to start transcription:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start transcription',
      });
    }
  },

  /**
   * GET /api/v1/recordings/:recordingId/transcription
   * Get transcription for a recording.
   *
   * Guards (applied in routes):
   *   - authenticate
   *   - requireRecordingParticipant (or requireRole admin)
   */
  async getTranscription(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;

      const transcriptions = await recordingTranscriptionService.getTranscriptionsByRecording(recordingId);

      // Access is already enforced by requireRecordingParticipant middleware;
      // no inline DB check needed here.

      auditRecordingAccess(req, 'RECORDING_TRANSCRIPT_ACCESSED', recordingId, {});

      return res.status(200).json({
        success: true,
        data: transcriptions,
      });
    } catch (error) {
      logger.error('Failed to get transcription:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get transcription',
      });
    }
  },

  /**
   * GET /api/v1/transcriptions/search
   * Search transcriptions
   */
  async searchTranscriptions(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { query } = req.query as { query?: string };

      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Search query is required',
        });
      }

      const results = await recordingTranscriptionService.searchTranscriptions(query, userId);

      return res.status(200).json({
        success: true,
        data: results,
      });
    } catch (error) {
      logger.error('Failed to search transcriptions:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search transcriptions',
      });
    }
  },

  /**
   * POST /api/v1/recordings/:recordingId/bookmarks
   * Create a bookmark
   */
  async createBookmark(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;
      const { type, timestampSeconds, title, note, color, durationSeconds, isPrivate } = req.body as {
        type?: 'bookmark' | 'annotation' | 'highlight';
        timestampSeconds: number;
        title?: string;
        note?: string;
        color?: string;
        durationSeconds?: number;
        isPrivate?: boolean;
      };

      const bookmark = await recordingBookmarkService.createBookmark({
        recordingId,
        userId,
        type,
        timestampSeconds,
        title,
        note,
        color,
        durationSeconds,
        isPrivate,
      });

      return res.status(201).json({
        success: true,
        data: bookmark,
      });
    } catch (error) {
      logger.error('Failed to create bookmark:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create bookmark',
      });
    }
  },

  /**
   * GET /api/v1/recordings/:recordingId/bookmarks
   * Get bookmarks for a recording
   */
  async getBookmarks(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;

      const bookmarks = await recordingBookmarkService.getBookmarksByRecording(recordingId, userId);

      return res.status(200).json({
        success: true,
        data: bookmarks,
      });
    } catch (error) {
      logger.error('Failed to get bookmarks:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get bookmarks',
      });
    }
  },

  /**
   * GET /api/v1/bookmarks
   * Get user's bookmarks
   */
  async getUserBookmarks(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const bookmarks = await recordingBookmarkService.getBookmarksByUser(userId);

      return res.status(200).json({
        success: true,
        data: bookmarks,
      });
    } catch (error) {
      logger.error('Failed to get user bookmarks:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get user bookmarks',
      });
    }
  },

  /**
   * PUT /api/v1/bookmarks/:bookmarkId
   * Update a bookmark
   */
  async updateBookmark(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { bookmarkId } = req.params as Record<string, string>;
      const updates = req.body as {
        title?: string;
        note?: string;
        color?: string;
        isPrivate?: boolean;
      };

      const bookmark = await recordingBookmarkService.updateBookmark(bookmarkId, userId, updates);

      return res.status(200).json({
        success: true,
        data: bookmark,
      });
    } catch (error) {
      logger.error('Failed to update bookmark:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update bookmark',
      });
    }
  },

  /**
   * DELETE /api/v1/bookmarks/:bookmarkId
   * Delete a bookmark
   */
  async deleteBookmark(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { bookmarkId } = req.params as Record<string, string>;

      await recordingBookmarkService.deleteBookmark(bookmarkId, userId);

      return res.status(200).json({
        success: true,
        message: 'Bookmark deleted successfully',
      });
    } catch (error) {
      logger.error('Failed to delete bookmark:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete bookmark',
      });
    }
  },

  /**
   * GET /api/v1/recordings/:recordingId/bookmarks/export
   * Export bookmarks for a recording
   */
  async exportBookmarks(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = resolveUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params as Record<string, string>;

      const exportData = await recordingBookmarkService.exportBookmarks(recordingId, userId);

      return res.status(200).json({
        success: true,
        data: exportData,
      });
    } catch (error) {
      logger.error('Failed to export bookmarks:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export bookmarks',
      });
    }
  },
};

export default SessionRecordingController;
