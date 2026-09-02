/**
 * Consent Controller
 *
 * Manages granular GDPR consent preferences (GDPR Article 7).
 *
 * Each data processing purpose requires separate, explicit consent:
 *   - analytics_consent        — analytics and usage tracking
 *   - marketing_consent        — marketing emails and promotions
 *   - functional_consent       — functional cookies and preferences
 *   - session_recording_consent — video/audio session recording
 *   - ai_analysis_consent      — AI analysis of session content
 *   - data_sharing_consent     — sharing anonymised data with third parties
 *
 * Records are append-only (new record per change, never updated in-place).
 * This provides a full GDPR-compliant audit trail of all consent changes.
 */

import { Response } from "express";
import { z } from "zod";
import pool from "../config/database";
import { AuthenticatedRequest } from "../types/api.types";
import { ResponseUtil } from "../utils/response.utils";
import { anonymizeIp } from "../utils/sanitization.utils";

// ── Validation schemas ───────────────────────────────────────────────────────

const consentFieldsSchema = z.object({
  analytics_consent: z.boolean({
    required_error: "analytics_consent is required",
    invalid_type_error: "analytics_consent must be a boolean",
  }),
  marketing_consent: z.boolean({
    required_error: "marketing_consent is required",
    invalid_type_error: "marketing_consent must be a boolean",
  }),
  functional_consent: z.boolean({
    required_error: "functional_consent is required",
    invalid_type_error: "functional_consent must be a boolean",
  }),
  session_recording_consent: z.boolean({
    required_error: "session_recording_consent is required",
    invalid_type_error: "session_recording_consent must be a boolean",
  }),
  ai_analysis_consent: z.boolean({
    required_error: "ai_analysis_consent is required",
    invalid_type_error: "ai_analysis_consent must be a boolean",
  }),
  data_sharing_consent: z.boolean({
    required_error: "data_sharing_consent is required",
    invalid_type_error: "data_sharing_consent must be a boolean",
  }),
  consent_version: z
    .string()
    .trim()
    .max(20)
    .optional()
    .default("1.0"),
});

const withdrawalSchema = z.object({
  withdrawal_reason: z
    .string()
    .trim()
    .max(1000)
    .optional(),
});

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface ConsentRecord {
  id: string;
  user_id: string;
  analytics_consent: boolean;
  marketing_consent: boolean;
  functional_consent: boolean;
  session_recording_consent: boolean;
  ai_analysis_consent: boolean;
  data_sharing_consent: boolean;
  consent_version: string;
  consent_timestamp: Date;
  ip_address: string;
  user_agent: string;
  withdrawn_at: Date | null;
  withdrawal_reason: string | null;
  created_at: Date;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientMeta(req: AuthenticatedRequest): {
  ipAddress: string;
  userAgent: string;
} {
  return {
    ipAddress: anonymizeIp(
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        "",
    ),
    userAgent: (req.headers["user-agent"] as string) || "",
  };
}

// ── Controller ───────────────────────────────────────────────────────────────

export const ConsentController = {
  /**
   * POST /api/v1/consent
   * Record user's consent choices for all processing purposes.
   */
  async recordConsent(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      ResponseUtil.unauthorized(
        res,
        "User must be authenticated to record consent",
      );
      return;
    }

    const parsed = consentFieldsSchema.safeParse(req.body);
    if (!parsed.success) {
      ResponseUtil.error(
        res,
        "Validation failed",
        400,
        parsed.error.errors.map((e) => e.message).join("; "),
      );
      return;
    }

    const data = parsed.data;
    const { ipAddress, userAgent } = getClientMeta(req);

    const query = `
      INSERT INTO consent_records (
        user_id,
        analytics_consent,
        marketing_consent,
        functional_consent,
        session_recording_consent,
        ai_analysis_consent,
        data_sharing_consent,
        consent_version,
        ip_address,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      userId,
      data.analytics_consent,
      data.marketing_consent,
      data.functional_consent,
      data.session_recording_consent,
      data.ai_analysis_consent,
      data.data_sharing_consent,
      data.consent_version,
      ipAddress,
      userAgent,
    ];

    try {
      const { rows } = await pool.query<ConsentRecord>(query, values);
      ResponseUtil.created(res, rows[0], "Consent choices recorded successfully");
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
   * Retrieve the most recent consent record for the authenticated user.
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
        ResponseUtil.success(res, null, "No consent record found for this user");
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
   * Update consent preferences — creates a new append-only record.
   */
  async updateConsent(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    // Consent records are append-only: a PUT creates a new record, never updates in-place.
    return ConsentController.recordConsent(req, res);
  },

  /**
   * POST /api/v1/consent/withdraw
   * Withdraw all consent — inserts a new record with all fields set to false
   * and sets withdrawn_at to now.
   *
   * Body (optional):
   *   { "withdrawal_reason": "string" }
   */
  async withdrawConsent(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      ResponseUtil.unauthorized(res, "User must be authenticated");
      return;
    }

    const parsed = withdrawalSchema.safeParse(req.body);
    if (!parsed.success) {
      ResponseUtil.error(
        res,
        "Validation failed",
        400,
        parsed.error.errors.map((e) => e.message).join("; "),
      );
      return;
    }

    const { withdrawal_reason } = parsed.data;
    const { ipAddress, userAgent } = getClientMeta(req);
    const now = new Date();

    const query = `
      INSERT INTO consent_records (
        user_id,
        analytics_consent,
        marketing_consent,
        functional_consent,
        session_recording_consent,
        ai_analysis_consent,
        data_sharing_consent,
        consent_version,
        ip_address,
        user_agent,
        withdrawn_at,
        withdrawal_reason
      )
      VALUES ($1, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    // Fetch the current consent_version from the latest record
    let currentVersion = "1.0";
    try {
      const versionResult = await pool.query<{ consent_version: string }>(
        `SELECT consent_version FROM consent_records WHERE user_id = $1 ORDER BY consent_timestamp DESC LIMIT 1`,
        [userId],
      );
      if (versionResult.rows.length > 0) {
        currentVersion = versionResult.rows[0].consent_version;
      }
    } catch {
      // Use default version
    }

    const values = [
      userId,
      currentVersion,
      ipAddress,
      userAgent,
      now,
      withdrawal_reason || null,
    ];

    try {
      const { rows } = await pool.query<ConsentRecord>(query, values);
      ResponseUtil.created(
        res,
        rows[0],
        "Consent has been withdrawn. All data processing will cease as required by GDPR Article 7.",
      );
    } catch (error) {
      ResponseUtil.error(
        res,
        "Failed to withdraw consent",
        500,
        (error as Error).message,
      );
    }
  },

  /**
   * GET /api/v1/consent/history
   * Retrieve the full consent history for the authenticated user (paginated).
   *
   * Provides a complete audit trail of all consent changes as required by GDPR.
   */
  async getConsentHistory(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      ResponseUtil.unauthorized(res, "User must be authenticated");
      return;
    }

    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt((req.query.limit as string) || "20", 10)),
    );
    const offset = (page - 1) * limit;

    const countQuery = `SELECT COUNT(*) FROM consent_records WHERE user_id = $1`;
    const dataQuery = `
      SELECT * FROM consent_records
      WHERE user_id = $1
      ORDER BY consent_timestamp DESC
      LIMIT $2 OFFSET $3
    `;

    try {
      const [countResult, dataResult] = await Promise.all([
        pool.query<{ count: string }>(countQuery, [userId]),
        pool.query<ConsentRecord>(dataQuery, [userId, limit, offset]),
      ]);

      const total = parseInt(countResult.rows[0].count, 10);

      ResponseUtil.success(
        res,
        dataResult.rows,
        "Consent history retrieved successfully",
        200,
        {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      );
    } catch (error) {
      ResponseUtil.error(
        res,
        "Failed to retrieve consent history",
        500,
        (error as Error).message,
      );
    }
  },

  /**
   * GET /api/v1/consent/stats   (admin only)
   * Aggregate consent rates across all six consent types.
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
          functional_consent,
          session_recording_consent,
          ai_analysis_consent,
          data_sharing_consent,
          withdrawn_at
        FROM consent_records
        ORDER BY user_id, consent_timestamp DESC
      )
      SELECT
        COUNT(*) AS total_users,
        COUNT(*) FILTER (WHERE withdrawn_at IS NULL) AS active_consents,
        COUNT(*) FILTER (WHERE withdrawn_at IS NOT NULL) AS withdrawn_consents,
        COUNT(*) FILTER (WHERE analytics_consent = TRUE AND withdrawn_at IS NULL) AS analytics_opt_in,
        COUNT(*) FILTER (WHERE marketing_consent = TRUE AND withdrawn_at IS NULL) AS marketing_opt_in,
        COUNT(*) FILTER (WHERE functional_consent = TRUE AND withdrawn_at IS NULL) AS functional_opt_in,
        COUNT(*) FILTER (WHERE session_recording_consent = TRUE AND withdrawn_at IS NULL) AS session_recording_opt_in,
        COUNT(*) FILTER (WHERE ai_analysis_consent = TRUE AND withdrawn_at IS NULL) AS ai_analysis_opt_in,
        COUNT(*) FILTER (WHERE data_sharing_consent = TRUE AND withdrawn_at IS NULL) AS data_sharing_opt_in
      FROM LatestConsents;
    `;

    try {
      const { rows } = await pool.query(statsQuery);
      const stats = rows[0];
      const active = parseInt(stats.active_consents, 10) || 0;

      const rate = (count: string): number =>
        active > 0
          ? parseFloat(((parseInt(count, 10) / active) * 100).toFixed(2))
          : 0;

      const responseData = {
        total_unique_users: parseInt(stats.total_users, 10) || 0,
        active_consents: active,
        withdrawn_consents: parseInt(stats.withdrawn_consents, 10) || 0,
        consent_rates: {
          analytics: {
            opt_in_count: parseInt(stats.analytics_opt_in, 10) || 0,
            opt_in_rate: rate(stats.analytics_opt_in),
          },
          marketing: {
            opt_in_count: parseInt(stats.marketing_opt_in, 10) || 0,
            opt_in_rate: rate(stats.marketing_opt_in),
          },
          functional: {
            opt_in_count: parseInt(stats.functional_opt_in, 10) || 0,
            opt_in_rate: rate(stats.functional_opt_in),
          },
          session_recording: {
            opt_in_count: parseInt(stats.session_recording_opt_in, 10) || 0,
            opt_in_rate: rate(stats.session_recording_opt_in),
          },
          ai_analysis: {
            opt_in_count: parseInt(stats.ai_analysis_opt_in, 10) || 0,
            opt_in_rate: rate(stats.ai_analysis_opt_in),
          },
          data_sharing: {
            opt_in_count: parseInt(stats.data_sharing_opt_in, 10) || 0,
            opt_in_rate: rate(stats.data_sharing_opt_in),
          },
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
