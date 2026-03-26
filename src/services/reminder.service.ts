import { DateTime } from 'luxon';
import { CronJob } from 'cron';
import { logger } from '../utils/logger.utils';
import { formatInTimezone } from '../utils/timezone.utils';
import { enqueueEmail } from '../queues/email.queue';
import pool from '../config/database';

/**
 * Session Reminder Service
 * Sends 24h and 1h reminders via email/SMS (placeholder for actual integration)
 * Uses node-cron for scheduling (upgrade to BullMQ with Issue #B29)
 */

interface SessionRecord {
  id: string;
  mentor_id: string;
  mentee_id: string;
  scheduled_at_utc: string; // UTC ISO
  duration_minutes: number;
  topic: string;
  mentor_timezone: string;
  mentee_timezone: string;
  status: string;
}

export class ReminderService {
  private cronJobs: CronJob[] = [];
  private isInitialized = false;

  /**
   * Initialize reminder service
   * Call this after database is ready
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Reminder service already initialized');
      return;
    }

    await this.ensureReminderColumns();
    this.scheduleReminders();
    this.isInitialized = true;
    logger.info('Reminder service initialized');
  }

  /**
   * Ensure sessions table has reminder tracking columns
   */
  private async ensureReminderColumns(): Promise<void> {
    try {
      const query = `
        DO $$ 
        BEGIN
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sessions') THEN
            ALTER TABLE sessions 
            ADD COLUMN IF NOT EXISTS reminded_24h TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS reminded_1h TIMESTAMP WITH TIME ZONE;
          END IF;
        END $$;
      `;
      await pool.query(query);
    } catch (error) {
      logger.error('Error ensuring reminder columns:', error);
    }
  }

  /**
   * Schedule reminders for all upcoming sessions
   * Run on app startup and after new bookings
   */
  private scheduleReminders(): void {
    // Clear existing jobs
    this.cronJobs.forEach((job) => job.stop());
    this.cronJobs = [];

    // Check every 5 minutes for sessions needing reminders
    const reminderChecker = new CronJob('*/5 * * * *', async () => {
      await this.checkAndScheduleReminders();
    });
    reminderChecker.start();
    this.cronJobs.push(reminderChecker);

    logger.info('Reminder cron jobs scheduled');
  }

  /**
   * Check database for sessions needing 24h/1h reminders
   */
  private async checkAndScheduleReminders(): Promise<void> {
    try {
      const now = DateTime.now().toUTC();

      // Sessions needing 24h reminder (scheduled 24h from now, ±15min window)
      const tomorrow24h = now.plus({ hours: 24 });
      const sessions24h = await this.getSessionsNeedingReminder(
        '24h',
        tomorrow24h.minus({ minutes: 15 }).toISO()!,
        tomorrow24h.plus({ minutes: 15 }).toISO()!
      );

      for (const session of sessions24h) {
        await this.send24hReminder(session);
      }

      // Sessions needing 1h reminder (scheduled 1h from now, ±5min window)
      const oneHourLater = now.plus({ hours: 1 });
      const sessions1h = await this.getSessionsNeedingReminder(
        '1h',
        oneHourLater.minus({ minutes: 5 }).toISO()!,
        oneHourLater.plus({ minutes: 5 }).toISO()!
      );

      for (const session of sessions1h) {
        await this.send1hReminder(session);
      }
    } catch (error) {
      logger.error('Error checking reminders:', error);
    }
  }

  /**
   * Query sessions needing reminder
   * Mark as reminded in DB after sending
   */
  private async getSessionsNeedingReminder(
    reminderType: '24h' | '1h',
    startWindow: string,
    endWindow: string
  ): Promise<SessionRecord[]> {
    const reminderColumn = reminderType === '24h' ? 'reminded_24h' : 'reminded_1h';
    
    const query = `
      SELECT 
        s.id,
        s.mentor_id,
        s.mentee_id,
        s.scheduled_at_utc,
        s.duration_minutes,
        s.topic,
        s.status,
        COALESCE(m.timezone, 'UTC') as mentor_timezone,
        COALESCE(u.timezone, 'UTC') as mentee_timezone
      FROM sessions s
      LEFT JOIN users m ON s.mentor_id = m.id
      LEFT JOIN users u ON s.mentee_id = u.id
      WHERE s.scheduled_at_utc BETWEEN $1 AND $2
      AND s.status = 'confirmed'
      AND s.${reminderColumn} IS NULL
      LIMIT 100
    `;

    try {
      const result = await pool.query(query, [startWindow, endWindow]);
      return result.rows as SessionRecord[];
    } catch (error) {
      // Table might not exist yet
      logger.debug(`Sessions table not ready for reminders: ${error}`);
      return [];
    }
  }

  /**
   * Send 24h confirmation reminder to both parties
   */
  private async send24hReminder(session: SessionRecord): Promise<void> {
    try {
      const mentorTime = formatInTimezone(
        session.scheduled_at_utc,
        session.mentor_timezone,
        'EEEE, MMMM d \'at\' h:mm a zzz'
      );
      const menteeTime = formatInTimezone(
        session.scheduled_at_utc,
        session.mentee_timezone,
        'EEEE, MMMM d \'at\' h:mm a zzz'
      );

      // Mentor reminder
      await this.sendNotification(session.mentor_id, {
        subject: 'Upcoming Session Reminder - 24 Hours',
        body: `Your session "${session.topic}" is scheduled for ${mentorTime}. Duration: ${session.duration_minutes} minutes.`,
        type: 'email',
      });

      // Mentee reminder
      await this.sendNotification(session.mentee_id, {
        subject: 'Session Confirmation - 24 Hours',
        body: `Your mentoring session is scheduled for ${menteeTime}. Topic: ${session.topic}. Duration: ${session.duration_minutes} minutes.`,
        type: 'email',
      });

      // Mark as sent
      await this.markReminderSent(session.id, '24h');

      logger.info(`24h reminder sent for session ${session.id}`);
    } catch (error) {
      logger.error(`Error sending 24h reminder for session ${session.id}:`, error);
    }
  }

  /**
   * Send 1h final reminder
   */
  private async send1hReminder(session: SessionRecord): Promise<void> {
    try {
      const mentorTime = formatInTimezone(
        session.scheduled_at_utc,
        session.mentor_timezone,
        'h:mm a zzz'
      );
      const menteeTime = formatInTimezone(
        session.scheduled_at_utc,
        session.mentee_timezone,
        'h:mm a zzz'
      );

      await this.sendNotification(session.mentor_id, {
        subject: 'Session Starting in 1 Hour!',
        body: `Your session "${session.topic}" starts at ${mentorTime}. Please prepare and join on time.`,
        type: 'email',
      });

      await this.sendNotification(session.mentee_id, {
        subject: 'Session in 1 Hour!',
        body: `Your mentoring session starts at ${menteeTime}. Duration: ${session.duration_minutes} minutes. Get ready!`,
        type: 'email',
      });

      await this.markReminderSent(session.id, '1h');

      logger.info(`1h reminder sent for session ${session.id}`);
    } catch (error) {
      logger.error(`Error sending 1h reminder for session ${session.id}:`, error);
    }
  }

  /**
   * Send notification via email queue.
   * Resolves the user's email from the database and enqueues the job.
   */
  private async sendNotification(
    userId: string,
    content: { subject: string; body: string; type: 'email' | 'sms' }
  ): Promise<void> {
    if (content.type !== 'email') {
      logger.info(`[${content.type.toUpperCase()}] To user ${userId}: ${content.subject}`);
      return;
    }

    try {
      const { rows } = await pool.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [userId],
      );

      if (!rows[0]?.email) {
        logger.warn(`Reminder: no email found for user ${userId}`);
        return;
      }

      await enqueueEmail({
        to: [rows[0].email],
        subject: content.subject,
        templateId: 'session_reminder',
        templateData: { subject: content.subject, body: content.body },
        textContent: content.body,
        htmlContent: content.body.replace(/\n/g, '<br>'),
      });

      logger.info(`Reminder email enqueued for user ${userId}: ${content.subject}`);
    } catch (error) {
      logger.error(`Failed to enqueue reminder for user ${userId}:`, error);
    }
  }

  /**
   * Mark reminder as sent in database
   */
  private async markReminderSent(
    sessionId: string,
    type: '24h' | '1h'
  ): Promise<void> {
    const column = type === '24h' ? 'reminded_24h' : 'reminded_1h';
    try {
      await pool.query(
        `UPDATE sessions SET ${column} = NOW() WHERE id = $1`,
        [sessionId]
      );
    } catch (error) {
      logger.error(`Error marking reminder sent for session ${sessionId}:`, error);
    }
  }

  /**
   * Schedule reminder for specific new booking
   * Triggers immediate check for upcoming reminders
   */
  async scheduleForBooking(sessionId: string): Promise<void> {
    logger.info(`Scheduling reminders for new booking: ${sessionId}`);
    // Immediate check for reminders needed soon
    await this.checkAndScheduleReminders();
  }

  /**
   * Shutdown gracefully
   */
  shutdown(): void {
    this.cronJobs.forEach((job) => job.stop());
    this.isInitialized = false;
    logger.info('Reminder service stopped');
  }
}

// Singleton instance
export const reminderService = new ReminderService();
