import { Request, Response } from "express";
import { DeepLinkService, DeepLinkType } from "../services/deepLink.service";
import { extractClientIp } from "../utils/log-formatter.utils";
import { logger } from "../utils/logger";

export const DeepLinkController = {
  /**
   * GET /dl/:type/:id
   * Handles redirection for deep links.
   */
  async handleRedirection(req: Request, res: Response): Promise<void> {
    const { type, id } = req.params;
    const userAgent = req.headers["user-agent"];
    const ipAddress = extractClientIp(req);

    if (!Object.values(DeepLinkType).includes(type as DeepLinkType)) {
      res.status(400).send("Invalid deep link type");
      return;
    }

    try {
      // Track usage
      await DeepLinkService.trackUsage(
        {
          type: type as DeepLinkType,
          id,
          userId: (req as any).user?.id,
        },
        userAgent,
        ipAddress,
      );

      // Return redirection HTML
      const html = DeepLinkService.getRedirectionHtml({
        type: type as DeepLinkType,
        id,
      });

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error) {
      logger.error("Deep link redirection error:", error);
      res.status(500).send("Internal server error");
    }
  },
};
