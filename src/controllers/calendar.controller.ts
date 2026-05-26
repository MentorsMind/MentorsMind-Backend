import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { CalendarService } from "../services/calendar.service";
import { env } from "../config/env";
import { createError } from "../middleware/errorHandler";
import { logger } from "../utils/logger";

export const CalendarController = {
  // ---- iCal ----------------------------------------------------------------

  /**
   * GET /api/v1/calendar/ical/:token
   * Public endpoint — serves the raw iCal feed identified by the token.
   */
  async getICalFeed(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { token } = req.params;

    // Audit log: record every access to the public iCal feed with the requesting IP
    logger.info("iCal feed accessed", {
      ip: req.ip,
      tokenPrefix: (token as string).slice(0, 8),
    });

    const feed = await CalendarService.getICalFeed(token as string);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="mentorminds.ics"',
    );
    // private: disallow CDN/proxy caching of personal schedule data
    // no-store: do not persist the response body in any cache
    res.setHeader("Cache-Control", "private, no-store");
    res.send(feed);
  },

  /**
   * POST /api/v1/calendar/ical/regenerate
   * Authenticated — regenerates the user's iCal token, revoking the old one.
   */
  async regenerateICalToken(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const userId = req.user!.id;
    const token = await CalendarService.regenerateICalToken(userId);

    res.json({
      status: "success",
      message: "iCal token regenerated. Your old feed URL is now invalid.",
      data: {
        icalUrl: `${env.APP_BASE_URL}/api/v1/calendar/ical/${token}`,
      },
    });
  },

  /**
   * GET /api/v1/calendar/ical/token
   * Authenticated — returns (or lazily creates) the user's current iCal feed URL.
   */
  async getICalToken(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const token = await CalendarService.getOrCreateICalToken(userId);

    res.json({
      status: "success",
      data: {
        icalUrl: `${env.APP_BASE_URL}/api/v1/calendar/ical/${token}`,
      },
    });
  },

  // ---- Google Calendar OAuth -----------------------------------------------

  /**
   * GET /api/v1/calendar/google/connect
   * Redirects the authenticated user to Google's OAuth2 consent screen.
   */
  async googleConnect(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const url = await CalendarService.getGoogleAuthUrl(userId);
    res.redirect(url);
  },

  /**
   * GET /api/v1/calendar/google/callback
   * OAuth2 callback — exchanges the code for tokens and stores them.
   */
  async googleCallback(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      throw createError(`Google OAuth error: ${error}`, 400);
    }
    if (!code || !state) {
      throw createError("Missing OAuth code or state", 400);
    }

    let userId: string;
    let csrf: string;

    try {
      const parsedState = JSON.parse(state);
      userId = parsedState.userId;
      csrf = parsedState.csrf;
    } catch (e) {
      throw createError("Invalid OAuth state format", 400);
    }

    if (!userId || !csrf) {
      throw createError("Incomplete OAuth state", 400);
    }

    const isValid = await CalendarService.verifyAndClearCsrfToken(userId, csrf);
    if (!isValid) {
      throw createError("Invalid or expired CSRF token", 403);
    }

    await CalendarService.connectGoogleCalendar(userId, code);

    // Redirect to a success page in the client app
    res.redirect(
      `${env.APP_CLIENT_URL}/settings/calendar?connected=true`,
    );
  },

  /**
   * DELETE /api/v1/calendar/google/disconnect
   * Authenticated — removes the user's stored Google Calendar credentials.
   */
  async googleDisconnect(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const userId = req.user!.id;
    await CalendarService.disconnectGoogleCalendar(userId);

    res.json({
      status: "success",
      message: "Google Calendar disconnected successfully.",
    });
  },
};
