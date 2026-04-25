import crypto from "crypto";
import { google } from "googleapis";
import { redis } from "../config/redis";
import { pool } from "../config/database";
import { createError } from "../middleware/errorHandler";
import {
  buildICalFeed,
  generateICalToken,
  ICalSession,
} from "../utils/ical.utils";
import { logger } from "../utils/logger";
import { EncryptionUtil } from "../utils/encryption.utils";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

// ---------------------------------------------------------------------------
// iCal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all confirmed/upcoming sessions for a user and map them to ICalSession
 */
async function fetchSessionsForUser(userId: string): Promise<ICalSession[]> {
  const { rows } = await pool.query(
    `SELECT
       b.id,
       b.start_time,
       b.end_time,
       b.meeting_link,
       b.location,
       b.status,
       mentor.first_name  AS mentor_first,
       mentor.last_name   AS mentor_last,
       learner.first_name AS learner_first,
       learner.last_name  AS learner_last
     FROM bookings b
     JOIN users mentor  ON mentor.id  = b.mentor_id
     JOIN users learner ON learner.id = b.learner_id
     WHERE (b.mentor_id = $1 OR b.learner_id = $1)
       AND b.status IN ('confirmed', 'rescheduled')
       AND b.end_time >= NOW()
     ORDER BY b.start_time ASC`,
    [userId],
  );

  return rows.map((row) => ({
    uid: row.id,
    title: `Mentoring Session: ${row.mentor_first} ${row.mentor_last} & ${row.learner_first} ${row.learner_last}`,
    mentorName: `${row.mentor_first} ${row.mentor_last}`,
    learnerName: `${row.learner_first} ${row.learner_last}`,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    meetingLink: row.meeting_link ?? undefined,
    location: row.location ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Public service methods
// ---------------------------------------------------------------------------

export const CalendarService = {
  // ---- iCal ----------------------------------------------------------------

  /**
   * Retrieve a user's iCal token, generating one if it doesn't exist yet
   */
  async getOrCreateICalToken(userId: string): Promise<string> {
    const { rows } = await pool.query(
      "SELECT ical_token FROM users WHERE id = $1",
      [userId],
    );
    if (!rows[0]) throw createError("User not found", 404);

    if (rows[0].ical_token) return rows[0].ical_token;

    const token = generateICalToken();
    await pool.query("UPDATE users SET ical_token = $1 WHERE id = $2", [
      token,
      userId,
    ]);
    return token;
  },

  /**
   * Regenerate a user's iCal token (revokes the old one)
   */
  async regenerateICalToken(userId: string): Promise<string> {
    const token = generateICalToken();
    const { rowCount } = await pool.query(
      "UPDATE users SET ical_token = $1 WHERE id = $2",
      [token, userId],
    );
    if (!rowCount) throw createError("User not found", 404);
    return token;
  },

  /**
   * Build and return the iCal feed for the user identified by the given token
   */
  async getICalFeed(token: string): Promise<string> {
    const { rows } = await pool.query(
      "SELECT id, first_name, last_name FROM users WHERE ical_token = $1 AND is_active = true",
      [token],
    );
    if (!rows[0]) throw createError("Invalid or expired iCal token", 404);

    const user = rows[0];
    const sessions = await fetchSessionsForUser(user.id);
    return buildICalFeed(
      sessions,
      `MentorMinds – ${user.first_name} ${user.last_name}`,
    );
  },

  // ---- Google Calendar OAuth -----------------------------------------------

  /**
   * Generate a Google OAuth2 authorisation URL for the given user
   */
  async getGoogleAuthUrl(userId: string): Promise<string> {
    const csrf = crypto.randomBytes(16).toString("hex");
    // Store CSRF in Redis with 10-minute TTL
    await redis.set(`google_oauth_csrf:${userId}`, csrf, "EX", 600);

    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: GOOGLE_SCOPES,
      state: JSON.stringify({ userId, csrf }),
      prompt: "consent",
    });
  },

  /**
   * Verify and clear the CSRF token from Redis
   */
  async verifyAndClearCsrfToken(userId: string, csrf: string): Promise<boolean> {
    const key = `google_oauth_csrf:${userId}`;
    const storedCsrf = await redis.get(key);

    if (!storedCsrf || storedCsrf !== csrf) {
      return false;
    }

    await redis.del(key);
    return true;
  },

  /**
   * Exchange an OAuth2 code for tokens and persist them for the user
   */
  async connectGoogleCalendar(userId: string, code: string): Promise<void> {
    const { tokens } = await oauth2Client.getToken(code);

    const [encAccess, encRefresh, version] = await Promise.all([
      EncryptionUtil.encrypt(tokens.access_token),
      EncryptionUtil.encrypt(tokens.refresh_token),
      EncryptionUtil.getCurrentKeyVersion(),
    ]);

    await pool.query(
      `UPDATE users
       SET google_calendar_access_token  = NULL,
           google_calendar_refresh_token = NULL,
           google_calendar_token_expiry  = $1,
           google_calendar_connected     = true,
           encrypted_access_token        = $2,
           encrypted_refresh_token       = $3,
           pii_encryption_version        = $4
       WHERE id = $5`,
      [
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        encAccess,
        encRefresh,
        version,
        userId,
      ],
    );
  },

  /**
   * Remove Google Calendar credentials for the user
   */
  async disconnectGoogleCalendar(userId: string): Promise<void> {
    const { rowCount } = await pool.query(
      `UPDATE users
       SET google_calendar_access_token  = NULL,
           google_calendar_refresh_token = NULL,
           google_calendar_token_expiry  = NULL,
           google_calendar_connected     = false,
           encrypted_access_token        = NULL,
           encrypted_refresh_token       = NULL
       WHERE id = $1`,
      [userId],
    );
    if (!rowCount) throw createError("User not found", 404);
  },

  // ---- Google Calendar event management ------------------------------------

  /**
   * Build an OAuth2 client pre-loaded with a user's stored tokens
   */
  async _buildAuthedClient(userId: string) {
    const { rows } = await pool.query(
      `SELECT encrypted_access_token,
              encrypted_refresh_token,
              google_calendar_token_expiry AS expiry_date
       FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows[0]?.encrypted_access_token) return null;

    const [accessToken, refreshToken] = await Promise.all([
      EncryptionUtil.decrypt(rows[0].encrypted_access_token),
      EncryptionUtil.decrypt(rows[0].encrypted_refresh_token),
    ]);

    if (!accessToken) return null;

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken ?? undefined,
      expiry_date: rows[0].expiry_date
        ? new Date(rows[0].expiry_date).getTime()
        : undefined,
    });

    // Persist refreshed tokens automatically
    client.on("tokens", async (freshTokens) => {
      const encAccess = await EncryptionUtil.encrypt(freshTokens.access_token);
      const version = await EncryptionUtil.getCurrentKeyVersion();

      await pool.query(
        `UPDATE users
         SET google_calendar_access_token = NULL,
             encrypted_access_token = $1,
             google_calendar_token_expiry = $2,
             pii_encryption_version = $3
         WHERE id = $4`,
        [
          encAccess,
          freshTokens.expiry_date ? new Date(freshTokens.expiry_date) : null,
          version,
          userId,
        ],
      );
    });

    return client;
  },

  /**
   * Create a Google Calendar event for a booking; stores the event ID on the booking row
   */
  async createGoogleCalendarEvent(bookingId: string): Promise<void> {
    const { rows } = await pool.query(
      `SELECT
         b.id, b.start_time, b.end_time, b.meeting_link, b.location,
         b.mentor_id, b.learner_id,
         mentor.first_name  AS mentor_first,  mentor.last_name  AS mentor_last,
         mentor.email       AS mentor_email,
         learner.first_name AS learner_first, learner.last_name AS learner_last,
         learner.email      AS learner_email
       FROM bookings b
       JOIN users mentor  ON mentor.id  = b.mentor_id
       JOIN users learner ON learner.id = b.learner_id
       WHERE b.id = $1`,
      [bookingId],
    );
    if (!rows[0]) throw createError("Booking not found", 404);
    const booking = rows[0];

    const eventBody = {
      summary: `Mentoring Session: ${booking.mentor_first} ${booking.mentor_last} & ${booking.learner_first} ${booking.learner_last}`,
      location: booking.location ?? booking.meeting_link ?? "",
      description: booking.meeting_link
        ? `Meeting Link: ${booking.meeting_link}`
        : "MentorMinds session",
      start: {
        dateTime: new Date(booking.start_time).toISOString(),
        timeZone: "UTC",
      },
      end: {
        dateTime: new Date(booking.end_time).toISOString(),
        timeZone: "UTC",
      },
      attendees: [
        {
          email: booking.mentor_email,
          displayName: `${booking.mentor_first} ${booking.mentor_last}`,
        },
        {
          email: booking.learner_email,
          displayName: `${booking.learner_first} ${booking.learner_last}`,
        },
      ],
      conferenceData: booking.meeting_link
        ? {
            entryPoints: [
              { entryPointType: "video", uri: booking.meeting_link },
            ],
          }
        : undefined,
    };

    for (const participantId of [booking.mentor_id, booking.learner_id]) {
      try {
        const authClient =
          await CalendarService._buildAuthedClient(participantId);
        if (!authClient) continue;

        const calendar = google.calendar({ version: "v3", auth: authClient });
        const { data } = await calendar.events.insert({
          calendarId: "primary",
          requestBody: eventBody,
          sendUpdates: "all",
        });

        // Store the event ID on the booking (one column per participant)
        if (participantId === booking.mentor_id) {
          await pool.query(
            "UPDATE bookings SET google_event_id_mentor = $1 WHERE id = $2",
            [data.id, bookingId],
          );
        } else {
          await pool.query(
            "UPDATE bookings SET google_event_id_learner = $1 WHERE id = $2",
            [data.id, bookingId],
          );
        }
      } catch (err) {
        logger.error("Failed to create Google Calendar event", {
          bookingId,
          participantId,
          error: err,
        });
      }
    }
  },

  /**
   * Update the Google Calendar event when a booking is rescheduled
   */
  async updateGoogleCalendarEvent(bookingId: string): Promise<void> {
    const { rows } = await pool.query(
      `SELECT
         b.start_time, b.end_time, b.meeting_link, b.location,
         b.mentor_id, b.learner_id,
         b.google_event_id_mentor, b.google_event_id_learner,
         mentor.first_name AS mentor_first, mentor.last_name AS mentor_last,
         learner.first_name AS learner_first, learner.last_name AS learner_last
       FROM bookings b
       JOIN users mentor  ON mentor.id  = b.mentor_id
       JOIN users learner ON learner.id = b.learner_id
       WHERE b.id = $1`,
      [bookingId],
    );
    if (!rows[0]) throw createError("Booking not found", 404);
    const booking = rows[0];

    const participants: Array<{ id: string; eventId: string | null }> = [
      { id: booking.mentor_id, eventId: booking.google_event_id_mentor },
      { id: booking.learner_id, eventId: booking.google_event_id_learner },
    ];

    for (const { id: participantId, eventId } of participants) {
      if (!eventId) continue;
      try {
        const authClient =
          await CalendarService._buildAuthedClient(participantId);
        if (!authClient) continue;

        const calendar = google.calendar({ version: "v3", auth: authClient });
        await calendar.events.patch({
          calendarId: "primary",
          eventId,
          requestBody: {
            start: {
              dateTime: new Date(booking.start_time).toISOString(),
              timeZone: "UTC",
            },
            end: {
              dateTime: new Date(booking.end_time).toISOString(),
              timeZone: "UTC",
            },
            location: booking.location ?? booking.meeting_link ?? "",
          },
          sendUpdates: "all",
        });
      } catch (err) {
        logger.error("Failed to update Google Calendar event", {
          bookingId,
          participantId,
          error: err,
        });
      }
    }
  },

  /**
   * Delete the Google Calendar event when a booking is cancelled
   */
  async deleteGoogleCalendarEvent(bookingId: string): Promise<void> {
    const { rows } = await pool.query(
      `SELECT mentor_id, learner_id, google_event_id_mentor, google_event_id_learner
       FROM bookings WHERE id = $1`,
      [bookingId],
    );
    if (!rows[0]) return;
    const booking = rows[0];

    const participants: Array<{ id: string; eventId: string | null }> = [
      { id: booking.mentor_id, eventId: booking.google_event_id_mentor },
      { id: booking.learner_id, eventId: booking.google_event_id_learner },
    ];

    for (const { id: participantId, eventId } of participants) {
      if (!eventId) continue;
      try {
        const authClient =
          await CalendarService._buildAuthedClient(participantId);
        if (!authClient) continue;

        const calendar = google.calendar({ version: "v3", auth: authClient });
        await calendar.events.delete({
          calendarId: "primary",
          eventId,
          sendUpdates: "all",
        });
      } catch (err) {
        logger.error("Failed to delete Google Calendar event", {
          bookingId,
          participantId,
          error: err,
        });
      }
    }
  },
};
