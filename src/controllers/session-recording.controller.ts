import { Response, Request } from 'express';
import { SessionRecordingService } from '../services/session-recording.service';
import recordingTranscriptionService from '../services/recording-transcription.service';
import recordingBookmarkService from '../services/recording-bookmark.service';
import { logger } from '../utils/logger';
import pool from '../config/database';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    userId: string;
    role: string;
  };
  params: any;
  body: any;
  query: any;
  ip?: string;
  connection?: {
    remoteAddress?: string;
  };
  get(header: string): string | undefined;
}

export const SessionRecordingController = {
  /**
   * POST /api/v1/sessions/:sessionId/recordings/start
   * Start recording a session
   */
  async startRecording(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { sessionId } = req.params;
      const { format } = req.body as { format?: string };

      // TODO: Verify user is part of the session (mentor or mentee)
      // For now, we'll assume the session exists and user is authorized

      const result = await SessionRecordingService.startRecording({
        sessionId,
        mentorId: userId, // This should be determined from session data
        menteeId: userId, // This should be determined from session data
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
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;
      
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
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;
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
   * POST /api/v1/recordings/:recordingId/consent
   * Update consent for a recording
   */
  async updateConsent(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;
      const { consent } = req.body as { consent: boolean };

      const ipAddress = req.ip || req.connection.remoteAddress;
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
   * Generate a playback URL for a recording
   */
  async generatePlaybackUrl(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;
      const { expiresIn } = req.query as { expiresIn?: string };

      const result = await SessionRecordingService.generatePlaybackUrl(
        recordingId,
        expiresIn ? parseInt(expiresIn, 10) : 3600,
      );

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
   * Get recording details
   */
  async getRecording(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;

      const recording = await SessionRecordingService.getRecording(recordingId, userId);

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
      const userId = req.user?.userId || (req as any).user?.id;
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
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;

      await SessionRecordingService.deleteRecording(recordingId, userId);

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
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;
      const { language = 'en' } = req.body as { language?: string };

      const transcriptionId = await recordingTranscriptionService.startTranscription({
        recordingId,
        language,
      });

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
   * Get transcription for a recording
   */
  async getTranscription(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;

      const transcriptions = await recordingTranscriptionService.getTranscriptionsByRecording(recordingId);

      // Verify user has access to the recording
      if (transcriptions.length > 0) {
        const recordingQuery = `
          SELECT mentor_id, mentee_id FROM session_recordings WHERE id = $1
        `;
        const { rows } = await pool.query(recordingQuery, [recordingId]);
        
        if (rows.length > 0) {
          const recording = rows[0];
          if (recording.mentor_id !== userId && recording.mentee_id !== userId) {
            return res.status(403).json({
              success: false,
              error: 'Not authorized to access this transcription',
            });
          }
        }
      }

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
      const userId = req.user?.userId || (req as any).user?.id;
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
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;
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
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;

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
      const userId = req.user?.userId || (req as any).user?.id;
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
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { bookmarkId } = req.params;
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
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { bookmarkId } = req.params;

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
      const userId = req.user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { recordingId } = req.params;

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
