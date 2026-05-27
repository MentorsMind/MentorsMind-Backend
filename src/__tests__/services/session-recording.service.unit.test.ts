/**
 * Unit tests for SessionRecordingService
 */

import { SessionRecordingService } from '../../services/session-recording.service';
import { SessionRecordingModel } from '../../models/session-recording.model';
import { StorageService } from '../../services/storage.service';
import { AuditLogModel } from '../../models/audit-log.model';
import { logger } from '../../utils/logger';

// Mock dependencies
jest.mock('../../models/session-recording.model');
jest.mock('../../services/storage.service');
jest.mock('../../models/audit-log.model');
jest.mock('../../utils/logger');

describe('SessionRecordingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('startRecording', () => {
    it('should start a new recording', async () => {
      const mockRecording = {
        id: 'recording-123',
        s3_key: 'recordings/session-123/recording-123.mp4',
        status: 'recording',
        expires_at: new Date(),
      };

      (SessionRecordingModel.create as jest.Mock).mockResolvedValue(mockRecording);
      (SessionRecordingModel.updateStatus as jest.Mock).mockResolvedValue(mockRecording);
      (AuditLogModel.create as jest.Mock).mockResolvedValue(null);
      (StorageService.buildRecordingKey as jest.Mock).mockReturnValue('recordings/session-123/recording-123.mp4');

      const result = await SessionRecordingService.startRecording({
        sessionId: 'session-123',
        mentorId: 'mentor-123',
        menteeId: 'mentee-123',
        format: 'mp4',
      });

      expect(result.recordingId).toBe('recording-123');
      expect(SessionRecordingModel.create).toHaveBeenCalled();
      expect(SessionRecordingModel.updateStatus).toHaveBeenCalledWith('recording-123', {
        status: 'recording',
        recordingStartedAt: expect.any(Date),
      });
    });
  });

  describe('updateConsent', () => {
    it('should update consent for a recording', async () => {
      const mockRecording = {
        id: 'recording-123',
        mentor_id: 'mentor-123',
        mentee_id: 'mentee-123',
        mentor_consent: false,
        mentee_consent: false,
      };

      (SessionRecordingModel.findById as jest.Mock).mockResolvedValue(mockRecording);
      (SessionRecordingModel.updateConsent as jest.Mock).mockResolvedValue({
        ...mockRecording,
        mentor_consent: true,
      });
      (AuditLogModel.create as jest.Mock).mockResolvedValue(null);

      await SessionRecordingService.updateConsent('recording-123', 'mentor-123', true, '127.0.0.1', 'Mozilla');

      expect(SessionRecordingModel.updateConsent).toHaveBeenCalledWith(
        'recording-123',
        'mentor-123',
        {
          mentorConsent: true,
          consentIpAddress: '127.0.0.1',
          consentUserAgent: 'Mozilla',
        },
      );
    });

    it('should throw error if user is not authorized', async () => {
      const mockRecording = {
        id: 'recording-123',
        mentor_id: 'mentor-123',
        mentee_id: 'mentee-123',
      };

      (SessionRecordingModel.findById as jest.Mock).mockResolvedValue(mockRecording);

      await expect(
        SessionRecordingService.updateConsent('recording-123', 'user-456', true),
      ).rejects.toThrow('User not authorized to update consent for this recording');
    });
  });

  describe('generatePlaybackUrl', () => {
    it('should generate playback URL for ready recording with consent', async () => {
      const mockRecording = {
        id: 'recording-123',
        s3_key: 'recordings/session-123/recording-123.mp4',
        status: 'ready',
        mentor_consent: true,
        mentee_consent: true,
        expires_at: new Date(Date.now() + 86400000), // Tomorrow
      };

      (SessionRecordingModel.findById as jest.Mock).mockResolvedValue(mockRecording);
      (StorageService.generatePlaybackUrl as jest.Mock).mockResolvedValue('https://presigned-url');
      (AuditLogModel.create as jest.Mock).mockResolvedValue(null);

      const result = await SessionRecordingService.generatePlaybackUrl('recording-123', 3600);

      expect(result.url).toBe('https://presigned-url');
      expect(StorageService.generatePlaybackUrl).toHaveBeenCalledWith('recordings/session-123/recording-123.mp4', 3600);
    });

    it('should throw error if recording is not ready', async () => {
      const mockRecording = {
        id: 'recording-123',
        status: 'processing',
      };

      (SessionRecordingModel.findById as jest.Mock).mockResolvedValue(mockRecording);

      await expect(
        SessionRecordingService.generatePlaybackUrl('recording-123'),
      ).rejects.toThrow('Recording is not ready for playback');
    });

    it('should throw error if both parties have not consented', async () => {
      const mockRecording = {
        id: 'recording-123',
        status: 'ready',
        mentor_consent: true,
        mentee_consent: false,
        expires_at: new Date(Date.now() + 86400000),
      };

      (SessionRecordingModel.findById as jest.Mock).mockResolvedValue(mockRecording);

      await expect(
        SessionRecordingService.generatePlaybackUrl('recording-123'),
      ).rejects.toThrow('Both parties must consent to playback');
    });

    it('should throw error if recording has expired', async () => {
      const mockRecording = {
        id: 'recording-123',
        status: 'ready',
        mentor_consent: true,
        mentee_consent: true,
        expires_at: new Date(Date.now() - 86400000), // Yesterday
      };

      (SessionRecordingModel.findById as jest.Mock).mockResolvedValue(mockRecording);

      await expect(
        SessionRecordingService.generatePlaybackUrl('recording-123'),
      ).rejects.toThrow('Recording has expired');
    });
  });

  describe('deleteRecording', () => {
    it('should delete a recording', async () => {
      const mockRecording = {
        id: 'recording-123',
        mentor_id: 'mentor-123',
        mentee_id: 'mentee-123',
        s3_key: 'recordings/session-123/recording-123.mp4',
      };

      (SessionRecordingModel.findById as jest.Mock).mockResolvedValue(mockRecording);
      (StorageService.deleteFile as jest.Mock).mockResolvedValue(undefined);
      (SessionRecordingModel.markAsDeleted as jest.Mock).mockResolvedValue(true);
      (AuditLogModel.create as jest.Mock).mockResolvedValue(null);

      await SessionRecordingService.deleteRecording('recording-123', 'mentor-123');

      expect(StorageService.deleteFile).toHaveBeenCalledWith('recordings/session-123/recording-123.mp4');
      expect(SessionRecordingModel.markAsDeleted).toHaveBeenCalledWith('recording-123');
    });

    it('should throw error if user is not authorized', async () => {
      const mockRecording = {
        id: 'recording-123',
        mentor_id: 'mentor-123',
        mentee_id: 'mentee-123',
      };

      (SessionRecordingModel.findById as jest.Mock).mockResolvedValue(mockRecording);

      await expect(
        SessionRecordingService.deleteRecording('recording-123', 'user-456'),
      ).rejects.toThrow('User not authorized to delete this recording');
    });
  });

  describe('cleanupExpiredRecording', () => {
    it('should cleanup expired recording', async () => {
      const mockRecording = {
        id: 'recording-123',
        s3_key: 'recordings/session-123/recording-123.mp4',
      };

      (SessionRecordingModel.findById as jest.Mock).mockResolvedValue(mockRecording);
      (StorageService.deleteFile as jest.Mock).mockResolvedValue(undefined);
      (SessionRecordingModel.markAsDeleted as jest.Mock).mockResolvedValue(true);

      await SessionRecordingService.cleanupExpiredRecording('recording-123');

      expect(StorageService.deleteFile).toHaveBeenCalledWith('recordings/session-123/recording-123.mp4');
      expect(SessionRecordingModel.markAsDeleted).toHaveBeenCalledWith('recording-123');
    });
  });
});
