import { CalendarService } from '../services/calendar.service';
import HealthService from '../services/health.service';
import { pool } from '../config/database';
import { EncryptionUtil } from '../utils/encryption.utils';
import { google } from 'googleapis';

jest.mock('../config/database');
jest.mock('../utils/encryption.utils');
jest.mock('googleapis');
jest.mock('../utils/logger');
jest.mock('../queues/email.queue', () => ({
  emailQueue: {
    getJobCounts: jest.fn().mockResolvedValue({ active: 5, waiting: 10 }),
  },
}));

describe('Security and Reliability Improvements', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('CalendarService Token Encryption', () => {
    it('should encrypt tokens before storing in connectGoogleCalendar', async () => {
      const mockTokens = {
        access_token: 'raw-access',
        refresh_token: 'raw-refresh',
        expiry_date: Date.now() + 3600000,
      };

      (google.auth.OAuth2.prototype.getToken as jest.Mock).mockResolvedValue({ tokens: mockTokens });
      (EncryptionUtil.encrypt as jest.Mock).mockImplementation((val) => Promise.resolve(`enc-${val}`));
      (EncryptionUtil.getCurrentKeyVersion as jest.Mock).mockResolvedValue('v1');

      await CalendarService.connectGoogleCalendar('user-123', 'auth-code');

      expect(EncryptionUtil.encrypt).toHaveBeenCalledWith('raw-access');
      expect(EncryptionUtil.encrypt).toHaveBeenCalledWith('raw-refresh');
      
      const lastCall = (pool.query as jest.Mock).mock.calls[0];
      expect(lastCall[0]).toContain('encrypted_access_token');
      expect(lastCall[0]).toContain('encrypted_refresh_token');
      expect(lastCall[0]).toContain('pii_encryption_version');
      expect(lastCall[1]).toContain('enc-raw-access');
      expect(lastCall[1]).toContain('enc-raw-refresh');
      expect(lastCall[1]).toContain('v1');
    });

    it('should decrypt tokens when building authed client', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{
          encrypted_access_token: 'enc-access',
          encrypted_refresh_token: 'enc-refresh',
          expiry_date: new Date(),
        }],
      });

      (EncryptionUtil.decrypt as jest.Mock).mockImplementation((val) => 
        Promise.resolve(val.replace('enc-', 'dec-'))
      );

      const client = await CalendarService._buildAuthedClient('user-123');

      expect(EncryptionUtil.decrypt).toHaveBeenCalledWith('enc-access');
      expect(EncryptionUtil.decrypt).toHaveBeenCalledWith('enc-refresh');
      expect(google.auth.OAuth2.prototype.setCredentials).toHaveBeenCalledWith(expect.objectContaining({
        access_token: 'dec-access',
        refresh_token: 'dec-refresh',
      }));
    });
  });

  describe('CalendarService SQL Injection Fix', () => {
    it('should use static column names in createGoogleCalendarEvent', async () => {
      const bookingId = 'booking-456';
      const mentorId = 'mentor-789';
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: bookingId,
            mentor_id: mentorId,
            mentee_id: 'mentee-101',
            scheduled_start: new Date(),
            scheduled_end: new Date(),
            meeting_url: 'https://meet.example.com/test',
          }],
        })
        .mockResolvedValue({}); // for _buildAuthedClient queries

      // Mock google calendar response
      (google.calendar as jest.Mock).mockReturnValue({
        events: {
          insert: jest.fn().mockResolvedValue({ data: { id: 'event-1' } }),
        },
      });

      // Mock _buildAuthedClient to return a dummy client
      jest.spyOn(CalendarService, '_buildAuthedClient').mockResolvedValue({} as any);

      await CalendarService.createGoogleCalendarEvent(bookingId);

      // Check the update queries
      const queries = (pool.query as jest.Mock).mock.calls.map(c => c[0]);
      
      // Verify no dynamic column concatenation is used in the UPDATE query
      // The fix uses "UPDATE bookings SET google_event_id_mentor = $1 WHERE id = $2"
      const updateMentorQuery = queries.find(q => q.includes('UPDATE bookings SET google_event_id_mentor'));
      const updateLearnerQuery = queries.find(q => q.includes('UPDATE bookings SET google_event_id_learner'));

      expect(updateMentorQuery).toBeDefined();
      expect(updateLearnerQuery).toBeDefined();
      expect(updateMentorQuery).not.toContain('${'); // No string interpolation
      expect(updateLearnerQuery).not.toContain('${');
    });
  });

  describe('CalendarService iCal Feed', () => {
    it('should generate iCal feed for user with confirmed bookings', async () => {
      const userId = 'user-123';
      const icalToken = 'test-token-abc';
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      // Mock user lookup by token
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: userId,
            first_name: 'John',
            last_name: 'Doe',
          }],
        })
        // Mock fetchSessionsForUser query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'booking-1',
              scheduled_start: now,
              scheduled_end: oneHourFromNow,
              meeting_url: 'https://meet.example.com/session1',
              status: 'confirmed',
              mentor_first: 'Jane',
              mentor_last: 'Smith',
              mentee_first: 'John',
              mentee_last: 'Doe',
            },
            {
              id: 'booking-2',
              scheduled_start: new Date(now.getTime() + 24 * 60 * 60 * 1000),
              scheduled_end: new Date(oneHourFromNow.getTime() + 24 * 60 * 60 * 1000),
              meeting_url: null,
              status: 'confirmed',
              mentor_first: 'Bob',
              mentor_last: 'Wilson',
              mentee_first: 'John',
              mentee_last: 'Doe',
            },
          ],
        });

      const icalFeed = await CalendarService.getICalFeed(icalToken);

      // Verify the feed contains expected components
      expect(icalFeed).toContain('BEGIN:VCALENDAR');
      expect(icalFeed).toContain('END:VCALENDAR');
      expect(icalFeed).toContain('BEGIN:VEVENT');
      expect(icalFeed).toContain('END:VEVENT');
      expect(icalFeed).toContain('booking-1');
      expect(icalFeed).toContain('booking-2');
      expect(icalFeed).toContain('MentorMinds');
      expect(icalFeed).toContain('Jane Smith');
      expect(icalFeed).toContain('Bob Wilson');

      // Verify the SQL query uses correct column names
      const queries = (pool.query as jest.Mock).mock.calls.map(c => c[0]);
      const sessionsQuery = queries.find(q => q.includes('FROM bookings b'));
      expect(sessionsQuery).toContain('b.mentee_id');
      expect(sessionsQuery).toContain('b.scheduled_start');
      expect(sessionsQuery).toContain('b.scheduled_end');
      expect(sessionsQuery).toContain('b.meeting_url');
      expect(sessionsQuery).not.toContain('b.learner_id');
      expect(sessionsQuery).not.toContain('b.start_time');
      expect(sessionsQuery).not.toContain('b.end_time');
      expect(sessionsQuery).not.toContain('b.meeting_link');
    });

    it('should return empty iCal feed for user with no bookings', async () => {
      const icalToken = 'test-token-empty';

      // Mock user lookup by token
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'user-empty',
            first_name: 'Empty',
            last_name: 'User',
          }],
        })
        // Mock fetchSessionsForUser query - no bookings
        .mockResolvedValueOnce({
          rows: [],
        });

      const icalFeed = await CalendarService.getICalFeed(icalToken);

      // Verify the feed is valid but empty
      expect(icalFeed).toContain('BEGIN:VCALENDAR');
      expect(icalFeed).toContain('END:VCALENDAR');
      expect(icalFeed).not.toContain('BEGIN:VEVENT');
    });

    it('should throw 404 for invalid iCal token', async () => {
      const invalidToken = 'invalid-token';

      // Mock user lookup - no user found
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
      });

      await expect(CalendarService.getICalFeed(invalidToken)).rejects.toThrow('Invalid or expired iCal token');
    });
  });

  describe('Health Check Improvements', () => {
    it('should return simplified health status as requested', async () => {
      // Mock sub-checks
      jest.spyOn(HealthService as any, 'checkDatabase').mockResolvedValue({ status: 'healthy' });
      jest.spyOn(HealthService as any, 'checkRedis').mockResolvedValue({ status: 'healthy' });
      jest.spyOn(HealthService as any, 'checkHorizon').mockResolvedValue({ status: 'healthy' });
      jest.spyOn(HealthService as any, 'checkBullMQ').mockResolvedValue({ 
        status: 'healthy', 
        details: { active: 42 } 
      });

      const status = await HealthService.getSimplifiedStatus();

      expect(status).toEqual({
        stellar: 'OK',
        redis: 'OK',
        queues: {
          active: 42
        }
      });
    });

    it('should report DOWN when components are unhealthy', async () => {
        jest.spyOn(HealthService as any, 'checkHorizon').mockResolvedValue({ status: 'degraded' });
        jest.spyOn(HealthService as any, 'checkRedis').mockResolvedValue({ status: 'unhealthy' });
        jest.spyOn(HealthService as any, 'checkBullMQ').mockResolvedValue({ status: 'healthy', details: { active: 0 } });
  
        const status = await HealthService.getSimplifiedStatus();
  
        expect(status.stellar).toBe('DOWN');
        expect(status.redis).toBe('DOWN');
      });
  });
});
