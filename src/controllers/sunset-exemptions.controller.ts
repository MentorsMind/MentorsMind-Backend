/**
 * Sunset Exemptions Controller
 *
 * Admin management of the per-version sunset exemption allowlist.
 * Exempt users may continue calling an API version after its sunsetAt date.
 */

import { Request, Response } from "express";
import { SunsetExemptionService } from "../services/sunset-exemption.service";
import { API_VERSIONS } from "../config/api-versions.config";

const VERSION_PATTERN = /^v\d+$/;

function isValidVersion(version: unknown): version is string {
  return typeof version === "string" && version in API_VERSIONS;
}

export const SunsetExemptionsController = {
  /** GET /admin/sunset-exemptions?version=v1 */
  async list(req: Request, res: Response): Promise<void> {
    const version = req.query.version as string | undefined;
    if (version !== undefined && !isValidVersion(version)) {
      res.status(400).json({
        success: false,
        error: `Unknown API version '${version}'. Known versions: ${Object.keys(API_VERSIONS).join(", ")}`,
      });
      return;
    }

    const exemptions = await SunsetExemptionService.list(version);
    res.status(200).json({
      success: true,
      data: { count: exemptions.length, exemptions },
    });
  },

  /** POST /admin/sunset-exemptions { userId, apiVersion, reason?, expiresAt? } */
  async grant(req: Request, res: Response): Promise<void> {
    const { userId, apiVersion, reason, expiresAt } = req.body ?? {};

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ success: false, error: "userId is required" });
      return;
    }
    if (!isValidVersion(apiVersion)) {
      res.status(400).json({
        success: false,
        error: `apiVersion is required and must be one of: ${Object.keys(API_VERSIONS).join(", ")}`,
      });
      return;
    }

    let parsedExpiresAt: Date | null = null;
    if (expiresAt !== undefined && expiresAt !== null) {
      parsedExpiresAt = new Date(expiresAt);
      if (Number.isNaN(parsedExpiresAt.getTime())) {
        res.status(400).json({
          success: false,
          error: "expiresAt must be a valid ISO 8601 date",
        });
        return;
      }
    }

    const exemption = await SunsetExemptionService.grant({
      userId,
      apiVersion,
      reason: typeof reason === "string" ? reason : null,
      grantedBy: req.user?.id ?? null,
      expiresAt: parsedExpiresAt,
    });

    res.status(201).json({ success: true, data: exemption });
  },

  /** DELETE /admin/sunset-exemptions/:userId/:apiVersion */
  async revoke(req: Request, res: Response): Promise<void> {
    const { userId, apiVersion } = req.params;

    const userIdStr = Array.isArray(userId) ? userId[0] : userId;
    const apiVersionStr = Array.isArray(apiVersion) ? apiVersion[0] : apiVersion;

    if (!VERSION_PATTERN.test(apiVersionStr ?? "")) {
      res.status(400).json({ success: false, error: "Invalid apiVersion" });
      return;
    }

    const revoked = await SunsetExemptionService.revoke(userIdStr, apiVersionStr);
    if (!revoked) {
      res.status(404).json({
        success: false,
        error: `No exemption found for user '${userId}' on version '${apiVersion}'`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { userId, apiVersion, revoked: true },
    });
  },
};
