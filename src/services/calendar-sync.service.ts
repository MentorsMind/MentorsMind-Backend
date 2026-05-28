/**
 * CalendarSyncService — Outlook (Microsoft Graph) and Apple (CalDAV) integrations.
 * Google Calendar is handled by the existing CalendarService.
 */
import crypto from "crypto";
import { pool } from "../config/database";
import { redis } from "../config/redis";
import { EncryptionUtil } from "../utils/encryption.utils";
import { createError } from "../middleware/errorHandler";
import { logger } from "../utils/logger";

export type CalendarProvider = "google" | "outlook" | "apple";

export interface CalendarIntegration {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  calendar_id: string | null;
  sync_enabled: boolean;
  last_sync_at: Date | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Outlook (Microsoft Graph) OAuth helpers
// ---------------------------------------------------------------------------

const MS_AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";
const MS_SCOPES = "Calendars.ReadWrite offline_access";

function getMsRedirectUri(): string {
  return process.env.OUTLOOK_REDIRECT_URI ?? "";
}

// ---------------------------------------------------------------------------
// Apple CalDAV helpers
// ---------------------------------------------------------------------------

const APPLE_CALDAV_BASE = "https://caldav.icloud.com";

async function caldavRequest(
  url: string,
  method: string,
  username: string,
  password: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const { default: https } = await import("https");
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "text/calendar; charset=utf-8",
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public service
// ---------------------------------------------------------------------------

export const CalendarSyncService = {
  // ── Shared ────────────────────────────────────────────────────────────────

  async listIntegrations(userId: string): Promise<CalendarIntegration[]> {
    const { rows } = await pool.query<CalendarIntegration>(
      `SELECT id, user_id, provider, calendar_id, sync_enabled, last_sync_at, created_at
       FROM calendar_integrations WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return rows;
  },

  async toggleSync(
    userId: string,
    provider: CalendarProvider,
    enabled: boolean,
  ): Promise<void> {
    await pool.query(
      `UPDATE calendar_integrations SET sync_enabled = $1, updated_at = NOW()
       WHERE user_id = $2 AND provider = $3`,
      [enabled, userId, provider],
    );
  },

  async disconnect(userId: string, provider: CalendarProvider): Promise<void> {
    await pool.query(
      `DELETE FROM calendar_integrations WHERE user_id = $1 AND provider = $2`,
      [userId, provider],
    );
  },

  // ── Outlook ───────────────────────────────────────────────────────────────

  async getOutlookAuthUrl(userId: string): Promise<string> {
    const csrf = crypto.randomBytes(16).toString("hex");
    await redis.set(`outlook_oauth_csrf:${userId}`, csrf, "EX", 600);

    const params = new URLSearchParams({
      client_id: process.env.OUTLOOK_CLIENT_ID ?? "",
      response_type: "code",
      redirect_uri: getMsRedirectUri(),
      scope: MS_SCOPES,
      state: JSON.stringify({ userId, csrf }),
      response_mode: "query",
    });
    return `${MS_AUTH_BASE}/authorize?${params}`;
  },

  async connectOutlook(
    userId: string,
    code: string,
    csrf: string,
  ): Promise<void> {
    const stored = await redis.get(`outlook_oauth_csrf:${userId}`);
    if (!stored || stored !== csrf)
      throw createError("Invalid CSRF token", 403);
    await redis.del(`outlook_oauth_csrf:${userId}`);

    const params = new URLSearchParams({
      client_id: process.env.OUTLOOK_CLIENT_ID ?? "",
      client_secret: process.env.OUTLOOK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: getMsRedirectUri(),
      grant_type: "authorization_code",
    });

    const resp = await fetch(`${MS_AUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!resp.ok)
      throw createError("Failed to exchange Outlook OAuth code", 502);

    const tokens = (await resp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const [encAccess, encRefresh] = await Promise.all([
      EncryptionUtil.encrypt(tokens.access_token),
      tokens.refresh_token
        ? EncryptionUtil.encrypt(tokens.refresh_token)
        : Promise.resolve(null),
    ]);

    const expiry = new Date(Date.now() + tokens.expires_in * 1000);

    await pool.query(
      `INSERT INTO calendar_integrations (user_id, provider, access_token, refresh_token, token_expiry)
       VALUES ($1, 'outlook', $2, $3, $4)
       ON CONFLICT (user_id, provider) DO UPDATE
         SET access_token = $2, refresh_token = COALESCE($3, calendar_integrations.refresh_token),
             token_expiry = $4, sync_enabled = TRUE, updated_at = NOW()`,
      [userId, encAccess, encRefresh, expiry],
    );
  },

  async createOutlookEvent(
    userId: string,
    subject: string,
    startIso: string,
    endIso: string,
    location?: string,
  ): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT access_token, refresh_token, token_expiry FROM calendar_integrations
       WHERE user_id = $1 AND provider = 'outlook' AND sync_enabled = TRUE`,
      [userId],
    );
    if (!rows.length || !rows[0].access_token) return null;

    let accessToken = await EncryptionUtil.decrypt(rows[0].access_token);

    // Refresh if expired
    if (rows[0].token_expiry && new Date(rows[0].token_expiry) <= new Date()) {
      accessToken = await CalendarSyncService._refreshOutlookToken(
        userId,
        rows[0].refresh_token,
      );
      if (!accessToken) return null;
    }

    const body = {
      subject,
      start: { dateTime: startIso, timeZone: "UTC" },
      end: { dateTime: endIso, timeZone: "UTC" },
      location: location ? { displayName: location } : undefined,
    };

    const resp = await fetch("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      logger.error("Failed to create Outlook event", {
        userId,
        status: resp.status,
      });
      return null;
    }

    const data = (await resp.json()) as { id: string };
    return data.id;
  },

  async _refreshOutlookToken(
    userId: string,
    encRefreshToken: string | null,
  ): Promise<string | null> {
    if (!encRefreshToken) return null;
    try {
      const refreshToken = await EncryptionUtil.decrypt(encRefreshToken);
      const params = new URLSearchParams({
        client_id: process.env.OUTLOOK_CLIENT_ID ?? "",
        client_secret: process.env.OUTLOOK_CLIENT_SECRET ?? "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      const resp = await fetch(`${MS_AUTH_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (!resp.ok) return null;
      const tokens = (await resp.json()) as {
        access_token: string;
        expires_in: number;
      };
      const encAccess = await EncryptionUtil.encrypt(tokens.access_token);
      const expiry = new Date(Date.now() + tokens.expires_in * 1000);
      await pool.query(
        `UPDATE calendar_integrations SET access_token = $1, token_expiry = $2, updated_at = NOW()
         WHERE user_id = $3 AND provider = 'outlook'`,
        [encAccess, expiry, userId],
      );
      return tokens.access_token;
    } catch (err) {
      logger.error("Failed to refresh Outlook token", { userId, err });
      return null;
    }
  },

  // ── Apple CalDAV ──────────────────────────────────────────────────────────

  /**
   * Connect Apple Calendar via CalDAV (app-specific password).
   * Apple does not use OAuth; credentials are stored encrypted.
   */
  async connectApple(
    userId: string,
    appleId: string,
    appPassword: string,
  ): Promise<void> {
    // Verify credentials by doing a PROPFIND on the CalDAV principal
    const principalUrl = `${APPLE_CALDAV_BASE}/`;
    const result = await caldavRequest(
      principalUrl,
      "PROPFIND",
      appleId,
      appPassword,
      undefined,
      {
        Depth: "0",
      },
    );
    if (result.status !== 207 && result.status !== 200) {
      throw createError(
        "Invalid Apple ID credentials or app-specific password",
        401,
      );
    }

    const [encUser, encPass] = await Promise.all([
      EncryptionUtil.encrypt(appleId),
      EncryptionUtil.encrypt(appPassword),
    ]);

    await pool.query(
      `INSERT INTO calendar_integrations (user_id, provider, access_token, refresh_token)
       VALUES ($1, 'apple', $2, $3)
       ON CONFLICT (user_id, provider) DO UPDATE
         SET access_token = $2, refresh_token = $3, sync_enabled = TRUE, updated_at = NOW()`,
      [userId, encUser, encPass],
    );
  },

  async createAppleEvent(
    userId: string,
    uid: string,
    summary: string,
    startIso: string,
    endIso: string,
    location?: string,
  ): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT access_token, refresh_token, calendar_id FROM calendar_integrations
       WHERE user_id = $1 AND provider = 'apple' AND sync_enabled = TRUE`,
      [userId],
    );
    if (!rows.length) return false;

    const [appleId, appPassword] = await Promise.all([
      EncryptionUtil.decrypt(rows[0].access_token),
      EncryptionUtil.decrypt(rows[0].refresh_token),
    ]);

    const calendarId = rows[0].calendar_id ?? `${appleId}/calendars/`;
    const eventUrl = `${APPLE_CALDAV_BASE}/${calendarId}${uid}.ics`;

    const icsBody = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MentorMinds//EN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `SUMMARY:${summary}`,
      `DTSTART:${startIso.replace(/[-:]/g, "").replace(".000Z", "Z")}`,
      `DTEND:${endIso.replace(/[-:]/g, "").replace(".000Z", "Z")}`,
      location ? `LOCATION:${location}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .filter(Boolean)
      .join("\r\n");

    const result = await caldavRequest(
      eventUrl,
      "PUT",
      appleId,
      appPassword,
      icsBody,
    );
    return result.status === 201 || result.status === 204;
  },
};
