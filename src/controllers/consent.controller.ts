import { Response } from "express";
import pool from "../config/database";
import { AuthenticatedRequest } from "../types/api.types";
import { ResponseUtil } from "../utils/response.utils";
import { anonymizeIp } from "../utils/sanitization.utils";

export interface ConsentRecord {
  id: string;
  user_id: string;
  analytics_consent: boolean;
  marketing_consent: boolean;
  functional_consent: boolean;
  consent_timestamp: Date;
  ip_address: string;
  user_agent: string;
  created_at: Date;
}

export const ConsentController = {
  /**
   * POST /api/v1/consent
   * Record user's cookie consent choices
   */
  async recordConsent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      ResponseUtil.unauthorized(
        res,
        "User must be authenticated to record consent",
      );
      return;
    }

    const { analytics_consent, marketing_consent, functional_consent } =
      req.body;

    // Basic validation
    if (
      typeof analytics_consent !== "boolean" ||
      typeof marketing_consent !== "boolean" ||
      typeof functional_consent !== "boolean"
    ) {
      ResponseUtil.error(
        res,
        "All consent choices (analytics, marketing, functional) must be boolean values",
        400,
      );
      return;
    }

    const ipAddress = anonymizeIp(
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket.remoteAddress ||
        "",
    );
    const userAgent = req.headers["user-agent"] || "";

    const query = `
      INSERT INTO consent_records (
        user_id, 
        analytics_consent, 
        marketing_consent, 
        functional_consent, 
        ip_address, 
        user_agent
      ) 
      VALUES ($1, $2, $3, $4, $5, $6) 
      RETURNING *
    `;
    const values = [
      userId,
      analytics_consent,
      marketing_consent,
      functional_consent,
      ipAddress,
      userAgent,
    ];

    try {
      const { rows } = await pool.query<ConsentRecord>(query, values);
      ResponseUtil.created(
        res,
        rows[0],
        "Consent choices recorded successfully",
      );
    } catch (error) {
      ResponseUtil.error(
        res,
        "Failed to record consent choices",
        500,
        (error as Error).message,
      );
    }
  },

  /**
   * GET /api/v1/consent
   * Retrieve current consent record for authenticated user
   */
  async getConsent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      ResponseUtil.unauthorized(res, "User must be authenticated");
      return;
    }

    const query = `
      SELECT * FROM consent_records 
      WHERE user_id = $1 
      ORDER BY consent_timestamp DESC 
      LIMIT 1
    `;

    try {
      const { rows } = await pool.query<ConsentRecord>(query, [userId]);
      if (rows.length === 0) {
        ResponseUtil.success(
          res,
          null,
          "No consent record found for this user",
        );
        return;
      }
      ResponseUtil.success(
        res,
        rows[0],
        "Current consent choices retrieved successfully",
      );
    } catch (error) {
      ResponseUtil.error(
        res,
        "Failed to retrieve consent choices",
        500,
        (error as Error).message,
      );
    }
  },

  /**
   * PUT /api/v1/consent
   * Update consent preferences (append-only)
   */
  async updateConsent(req: AuthenticatedRequest, res: Response): Promise<void> {
    // Per requirement: "Consent records are append-only (new record per change, never update)"
    // So PUT is essentially a POST to create a new record.
    return ConsentController.recordConsent(req, res);
  },

  /**
   * GET /api/v1/admin/consent/stats
   * Aggregate consent rates by type
   */
  async getConsentStats(
    _req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const statsQuery = `
      WITH LatestConsents AS (
          SELECT DISTINCT ON (user_id) 
              analytics_consent, 
              marketing_consent, 
              functional_consent
          FROM consent_records
          ORDER BY user_id, consent_timestamp DESC
      )
      SELECT 
          COUNT(*) AS total_users,
          COUNT(*) FILTER (WHERE analytics_consent = TRUE) AS analytics_opt_in,
          COUNT(*) FILTER (WHERE marketing_consent = TRUE) AS marketing_opt_in,
          COUNT(*) FILTER (WHERE functional_consent = TRUE) AS functional_opt_in
      FROM LatestConsents;
    `;

    try {
      const { rows } = await pool.query(statsQuery);
      const stats = rows[0];
      const total = parseInt(stats.total_users, 10) || 0;

      const responseData = {
        total_unique_users: total,
        analytics: {
          opt_in_count: parseInt(stats.analytics_opt_in, 10) || 0,
          opt_in_rate:
            total > 0
              ? parseFloat(
                  (
                    (parseInt(stats.analytics_opt_in, 10) / total) *
                    100
                  ).toFixed(2),
                )
              : 0,
        },
        marketing: {
          opt_in_count: parseInt(stats.marketing_opt_in, 10) || 0,
          opt_in_rate:
            total > 0
              ? parseFloat(
                  (
                    (parseInt(stats.marketing_opt_in, 10) / total) *
                    100
                  ).toFixed(2),
                )
              : 0,
        },
        functional: {
          opt_in_count: parseInt(stats.functional_opt_in, 10) || 0,
          opt_in_rate:
            total > 0
              ? parseFloat(
                  (
                    (parseInt(stats.functional_opt_in, 10) / total) *
                    100
                  ).toFixed(2),
                )
              : 0,
        },
      };

      ResponseUtil.success(
        res,
        responseData,
        "Consent statistics aggregated successfully",
      );
    } catch (error) {
      ResponseUtil.error(
        res,
        "Failed to aggregate consent stats",
        500,
        (error as Error).message,
      );
    }
  },
};
