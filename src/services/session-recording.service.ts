import { SessionRecordingModel, CreateRecordingPayload, UpdateRecordingStatusPayload } from '../models/session-recording.model';
import { StorageService } from './storage.service';
import { AuditLogModel } from '../models/audit-log.model';
import { logger } from '../utils/logger';
import { DateTime } from 'luxon';
import videoRecordingService from './video-recording.service';
import recordingTranscriptionService from './recording-transcription.service';
import recordingConfig from '../config/recording.config';

export interface RecordingMetadata extends Record<string, any> {
  format?: string;
  codec?: string;
  resolution?: string;
  bitrate?: number;
  framerate?: number;
}

export interface StartRecordingOptions {
  sessionId: string;
  mentorId: string;
  menteeId: string;
  format?: string;
}

export interface RecordingResult {
  recordingId: string;
  s3Key: string;
  status: string;
  expiresAt: Date;
}

export interface PlaybackUrlResult {
  url: string;
  expiresIn: number;
  expiresAt: Date;
}

/**
 * Session Recording Service - Handles recording lifecycle, consent, and playback
 */
export const SessionRecordingService = {
  /**
   * Start a new recording for a session
   */
  async startRecording(options: StartRecordingOptions): Promise<RecordingResult> {
    const { sessionId, mentorId, menteeId, format = 'mp4' } = options;

    // Calculate expiry date based on config
    const expiresAt = DateTime.now().plus({ days: recordingConfig.retentionDays }).toJSDate();

    // Generate S3 key
    const recordingId = crypto.randomUUID();
    const s3Key = StorageService.buildRecordingKey(sessionId, recordingId, format);

    // Create recording record
    const recording = await SessionRecordingModel.create({
      sessionId,
      mentorId,
      menteeId,
      s3Key,
      s3Bucket: process.env.AWS_S3_BUCKET as string,
      expiresAt,
    });

    // Start video recording if using IVS or Agora
    if (recordingConfig.provider !== 'manual') {
      try {
        const stream = await videoRecordingService.startRecording({
          sessionId,
          quality: 'medium',
          format,
        });
        
        // Store stream info in metadata
        await SessionRecordingModel.updateStatus(recording.id, {
          status: 'recording',
          recordingStartedAt: new Date(),
          metadata: {
            streamId: stream.streamId,
            streamUrl: stream.streamUrl,
            ingestUrl: stream.ingestUrl,
            playbackUrl: stream.playbackUrl,
            provider: recordingConfig.provider,
          },
        });
      } catch (error) {
        logger.error('Failed to start video recording:', error);
        // Continue with manual recording as fallback
        await SessionRecordingModel.updateStatus(recording.id, {
          status: 'recording',
          recordingStartedAt: new Date(),
        });
      }
    } else {
      // Manual recording
      await SessionRecordingModel.updateStatus(recording.id, {
        status: 'recording',
        recordingStartedAt: new Date(),
      });
    }

    // Log audit event
    await AuditLogModel.create({
      level: 'info',
      action: 'recording.started',
      message: `Recording started for session ${sessionId}`,
      user_id: mentorId,
      entity_type: 'session_recording',
      entity_id: recording.id,
      metadata: {
        sessionId,
        recordingId: recording.id,
        s3Key,
        provider: recordingConfig.provider,
      },
      ip_address: null,
      user_agent: null,
    });

    logger.info(`Recording started for session ${sessionId}, recording ID: ${recording.id}, provider: ${recordingConfig.provider}`);

    return {
      recordingId: recording.id,
      s3Key: recording.s3_key,
      status: recording.status,
      expiresAt: recording.expires_at,
    };
  },

  /**
   * Upload recording data to S3
   */
  async uploadRecording(
    recordingId: string,
    buffer: Buffer,
    contentType: string,
    metadata: RecordingMetadata = {},
  ): Promise<void> {
    const recording = await SessionRecordingModel.findById(recordingId);
    if (!recording) {
      throw new Error('Recording not found');
    }

    // Upload to S3
    await StorageService.uploadFile(recording.s3_key, buffer, contentType, metadata);

    logger.info(`Recording uploaded to S3: ${recording.s3_key}`);
  },

  /**
   * Mark recording as ready after processing
   */
  async completeRecording(
    recordingId: string,
    fileSize: number,
    durationSeconds: number,
    metadata: RecordingMetadata = {},
  ): Promise<void> {
    const recording = await SessionRecordingModel.findById(recordingId);
    if (!recording) {
      throw new Error('Recording not found');
    }

    // Stop video recording if using IVS or Agora
    if (recordingConfig.provider !== 'manual') {
      try {
        await videoRecordingService.stopRecording({
          sessionId: recording.session_id,
          recordingId,
        });
      } catch (error) {
        logger.error('Failed to stop video recording:', error);
      }
    }

    // Update status to ready
    await SessionRecordingModel.updateStatus(recordingId, {
      status: 'ready',
      fileSize,
      durationSeconds,
      recordingEndedAt: new Date(),
      metadata,
    });

    // Log audit event
    await AuditLogModel.create({
      level: 'info',
      action: 'recording.completed',
      message: `Recording completed for session ${recording.session_id}`,
      user_id: recording.mentor_id,
      entity_type: 'session_recording',
      entity_id: recording.id,
      metadata: {
        sessionId: recording.session_id,
        recordingId,
        fileSize,
        durationSeconds,
      },
      ip_address: null,
      user_agent: null,
    });

    logger.info(`Recording completed: ${recordingId}`);

    // Start automatic transcription if enabled
    if (recordingConfig.transcriptionEnabled && recording.mentor_consent && recording.mentee_consent) {
      try {
        await recordingTranscriptionService.startTranscription({
          recordingId,
          language: 'en',
        });
        logger.info(`Started automatic transcription for recording ${recordingId}`);
      } catch (error) {
        logger.error('Failed to start automatic transcription:', error);
      }
    }
  },

  /**
   * Update consent for a recording
   */
  async updateConsent(
    recordingId: string,
    userId: string,
    consent: boolean,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const recording = await SessionRecordingModel.findById(recordingId);
    if (!recording) {
      throw new Error('Recording not found');
    }

    const isMentor = recording.mentor_id === userId;
    const isMentee = recording.mentee_id === userId;

    if (!isMentor && !isMentee) {
      throw new Error('User not authorized to update consent for this recording');
    }

    const consentField = isMentor ? 'mentorConsent' : 'menteeConsent';
    await SessionRecordingModel.updateConsent(recordingId, userId, {
      [consentField]: consent,
      consentIpAddress: ipAddress,
      consentUserAgent: userAgent,
    });

    // Log audit event
    await AuditLogModel.create({
      level: 'info',
      action: 'recording.consent_updated',
      message: `Recording consent updated by ${isMentor ? 'mentor' : 'mentee'}`,
      user_id: userId,
      entity_type: 'session_recording',
      entity_id: recording.id,
      metadata: {
        sessionId: recording.session_id,
        recordingId,
        role: isMentor ? 'mentor' : 'mentee',
        consent,
      },
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
    });

    logger.info(`Consent updated for recording ${recordingId} by user ${userId}: ${consent}`);
  },

  /**
   * Generate a playback URL for a recording
   */
  async generatePlaybackUrl(recordingId: string, expiresIn: number = 3600): Promise<PlaybackUrlResult> {
    const recording = await SessionRecordingModel.findById(recordingId);
    if (!recording) {
      throw new Error('Recording not found');
    }

    // Check if recording is ready
    if (recording.status !== 'ready') {
      throw new Error('Recording is not ready for playback');
    }

    // Check if both parties have consented
    if (!recording.mentor_consent || !recording.mentee_consent) {
      throw new Error('Both parties must consent to playback');
    }

    // Check if recording has expired
    if (new Date() > recording.expires_at) {
      throw new Error('Recording has expired');
    }

    // Generate presigned URL
    const url = await StorageService.generatePlaybackUrl(recording.s3_key, expiresIn);
    const expiresAt = DateTime.now().plus({ seconds: expiresIn }).toJSDate();

    // Log audit event
    await AuditLogModel.create({
      level: 'info',
      action: 'recording.playback_url_generated',
      message: `Playback URL generated for recording ${recordingId}`,
      user_id: null,
      entity_type: 'session_recording',
      entity_id: recording.id,
      metadata: {
        sessionId: recording.session_id,
        recordingId,
        expiresIn,
      },
      ip_address: null,
      user_agent: null,
    });

    return {
      url,
      expiresIn,
      expiresAt,
    };
  },

  /**
   * Get recording details
   */
  async getRecording(recordingId: string, userId: string): Promise<any> {
    const recording = await SessionRecordingModel.findById(recordingId);
    if (!recording) {
      throw new Error('Recording not found');
    }

    // Check if user is authorized
    if (recording.mentor_id !== userId && recording.mentee_id !== userId) {
      throw new Error('User not authorized to access this recording');
    }

    // Return recording details without sensitive info
    return {
      id: recording.id,
      sessionId: recording.session_id,
      status: recording.status,
      mentorConsent: recording.mentor_consent,
      menteeConsent: recording.mentee_consent,
      durationSeconds: recording.duration_seconds,
      fileSize: recording.file_size,
      createdAt: recording.created_at,
      expiresAt: recording.expires_at,
      metadata: recording.metadata,
    };
  },

  /**
   * Get all recordings for a user
   */
  async getUserRecordings(userId: string): Promise<any[]> {
    const recordings = await SessionRecordingModel.findAccessibleByUserId(userId);

    return recordings.map((recording) => ({
      id: recording.id,
      sessionId: recording.session_id,
      status: recording.status,
      durationSeconds: recording.duration_seconds,
      createdAt: recording.created_at,
      expiresAt: recording.expires_at,
    }));
  },

  /**
   * Delete a recording
   */
  async deleteRecording(recordingId: string, userId: string): Promise<void> {
    const recording = await SessionRecordingModel.findById(recordingId);
    if (!recording) {
      throw new Error('Recording not found');
    }

    // Check if user is authorized (either mentor or mentee)
    if (recording.mentor_id !== userId && recording.mentee_id !== userId) {
      throw new Error('User not authorized to delete this recording');
    }

    // Delete from S3
    try {
      await StorageService.deleteFile(recording.s3_key);
    } catch (error) {
      logger.error(`Failed to delete recording from S3: ${recording.s3_key}`, error);
    }

    // Mark as deleted in database
    await SessionRecordingModel.markAsDeleted(recordingId);

    // Log audit event
    await AuditLogModel.create({
      level: 'info',
      action: 'recording.deleted',
      message: `Recording deleted by user ${userId}`,
      user_id: userId,
      entity_type: 'session_recording',
      entity_id: recording.id,
      metadata: {
        sessionId: recording.session_id,
        recordingId,
      },
      ip_address: null,
      user_agent: null,
    });

    logger.info(`Recording deleted: ${recordingId}`);
  },

  /**
   * Find expired recordings for cleanup
   */
  async findExpiredRecordings(): Promise<any[]> {
    return await SessionRecordingModel.findExpired();
  },

  /**
   * Cleanup expired recording
   */
  async cleanupExpiredRecording(recordingId: string): Promise<void> {
    const recording = await SessionRecordingModel.findById(recordingId);
    if (!recording) {
      logger.warn(`Recording not found for cleanup: ${recordingId}`);
      return;
    }

    // Delete from S3
    try {
      await StorageService.deleteFile(recording.s3_key);
      logger.info(`Deleted expired recording from S3: ${recording.s3_key}`);
    } catch (error) {
      logger.error(`Failed to delete expired recording from S3: ${recording.s3_key}`, error);
    }

    // Mark as deleted in database
    await SessionRecordingModel.markAsDeleted(recordingId);

    logger.info(`Cleaned up expired recording: ${recordingId}`);
  },
};

export default SessionRecordingService;
