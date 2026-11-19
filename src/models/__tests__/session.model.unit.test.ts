import { SessionModel } from '../session.model';
import pool from '../../config/database';
import { createError } from '../../middleware/errorHandler';
import { ErrorCode } from '../../errors/error-codes';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
  db: { query: jest.fn(), connect: jest.fn() },
}));

const queryMock = (pool.query as jest.Mock);

describe('SessionModel updateMeetingUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('valid URL validation', () => {
    it('accepts valid HTTPS URL', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{
          id: 'session-1',
          meeting_url: 'https://example.com/meeting',
          meeting_provider: null,
          meeting_room_id: null,
          meeting_expires_at: null,
          updated_at: new Date()
        }]
      });

      const result = await SessionModel.updateMeetingUrl('session-1', {
        meetingUrl: 'https://example.com/meeting',
        meetingProvider: 'zoom',
        meetingRoomId: 'room-1',
        meetingExpiresAt: new Date('2024-01-01')
      });

      expect(result?.meeting_url).toBe('https://example.com/meeting');
    });

    it('rejects HTTP URL (#1305: https-only)', async () => {
      await expect(
        SessionModel.updateMeetingUrl('session-1', {
          meetingUrl: 'http://example.com/meeting',
          meetingProvider: 'daily',
          meetingRoomId: 'room-2',
          meetingExpiresAt: new Date('2024-01-01')
        })
      ).rejects.toThrow('meetingUrl must be a valid https:// URL');
      expect(queryMock).not.toHaveBeenCalled();
    });
  });

  describe('invalid URL rejection', () => {
    it('throws VALIDATION_ERROR for invalid URL string', async () => {
      queryMock.mockRejectedValueOnce(
        createError(ErrorCode.VALIDATION_ERROR, 400)
      );

      await expect(
        SessionModel.updateMeetingUrl('session-1', {
          meetingUrl: 'not-a-valid-url',
          meetingProvider: 'zoom',
          meetingRoomId: 'room-1',
          meetingExpiresAt: new Date('2024-01-01')
        })
      ).rejects.toThrow('meetingUrl must be a valid https:// URL');
    });
  });

  describe('empty meeting URL', () => {
    it('rejects empty string (#1305)', async () => {
      await expect(
        SessionModel.updateMeetingUrl('session-1', {
          meetingUrl: '',
          meetingProvider: 'zoom',
          meetingRoomId: 'room-1',
          meetingExpiresAt: new Date('2024-01-01')
        })
      ).rejects.toThrow('meetingUrl must be a non-empty https:// URL');
      expect(queryMock).not.toHaveBeenCalled();
    });
  });
});
