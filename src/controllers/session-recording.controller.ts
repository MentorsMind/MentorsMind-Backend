import { Response, Request } from 'express';
import { SessionRecordingService } from '../services/session-recording.service';
import { logger } from '../utils/logger';

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
};

export default SessionRecordingController;
