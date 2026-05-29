import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import {
  CalendarSyncService,
  CalendarProvider,
} from "../services/calendar-sync.service";
import { env } from "../config/env";

export const CalendarSyncController = {
  async listIntegrations(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const integrations = await CalendarSyncService.listIntegrations(
      req.user!.userId,
    );
    res.json({ success: true, data: integrations });
  },

  async toggleSync(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { provider } = req.params as { provider: CalendarProvider };
    const { enabled } = req.body as { enabled: boolean };
    await CalendarSyncService.toggleSync(req.user!.userId, provider, enabled);
    res.json({
      success: true,
      message: `Sync ${enabled ? "enabled" : "disabled"} for ${provider}`,
    });
  },

  async disconnect(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { provider } = req.params as { provider: CalendarProvider };
    await CalendarSyncService.disconnect(req.user!.userId, provider);
    res.json({ success: true, message: `${provider} calendar disconnected` });
  },

  // ── Outlook ───────────────────────────────────────────────────────────────

  async outlookConnect(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const url = await CalendarSyncService.getOutlookAuthUrl(req.user!.userId);
    res.redirect(url);
  },

  async outlookCallback(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) {
      res
        .status(400)
        .json({ success: false, error: `Outlook OAuth error: ${error}` });
      return;
    }

    let userId: string;
    let csrf: string;
    try {
      ({ userId, csrf } = JSON.parse(state));
    } catch {
      res.status(400).json({ success: false, error: "Invalid OAuth state" });
      return;
    }

    await CalendarSyncService.connectOutlook(userId, code, csrf);
    res.redirect(`${env.APP_CLIENT_URL}/settings/calendar?connected=outlook`);
  },

  // ── Apple CalDAV ──────────────────────────────────────────────────────────

  async appleConnect(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { apple_id, app_password } = req.body as {
      apple_id: string;
      app_password: string;
    };
    if (!apple_id || !app_password) {
      res
        .status(400)
        .json({
          success: false,
          error: "apple_id and app_password are required",
        });
      return;
    }
    await CalendarSyncService.connectApple(
      req.user!.userId,
      apple_id,
      app_password,
    );
    res.json({ success: true, message: "Apple Calendar connected" });
  },
};
