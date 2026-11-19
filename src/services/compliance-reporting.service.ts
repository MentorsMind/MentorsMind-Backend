/**
 * Automated Compliance Reporting Service
 *
 * Provides AML transaction monitoring, KYC tracking, suspicious activity
 * detection, and automated regulatory report generation.
 */

import pool from "../config/database";
import { logger } from "../utils/logger.utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AMLAlert {
  id: string;
  userId: string;
  alertType:
    | "unusual-volume"
    | "structuring"
    | "high-risk-country"
    | "velocity";
  severity: "low" | "medium" | "high" | "critical";
  transactions: string[];
  riskScore: number;
  status: "open" | "investigating" | "cleared" | "reported";
  createdAt: Date;
}

export interface ComplianceReport {
  period: string;
  totalTransactions: number;
  flaggedTransactions: number;
  kycCompliance: number;
  amlAlerts: number;
  reportedCases: number;
}

export interface SARReport {
  alertId: string;
  userId: string;
  reportedAt: Date;
  summary: string;
  transactions: string[];
  riskScore: number;
}

export interface KYCStatus {
  userId: string;
  verified: boolean;
  level: "none" | "basic" | "enhanced";
  verifiedAt?: Date;
  expiresAt?: Date;
  riskRating: "low" | "medium" | "high";
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Countries flagged as high-risk for cross-border transaction monitoring */
const HIGH_RISK_COUNTRIES = ["KP", "IR", "SY", "CU", "VE"];

/** Daily transaction volume threshold (USD) that triggers unusual-volume alert */
const UNUSUAL_VOLUME_THRESHOLD_USD = 10_000;

/** Structuring detection: multiple transactions just below CTR threshold */
const STRUCTURING_THRESHOLD_USD = 9_000;
const STRUCTURING_COUNT_THRESHOLD = 3;

/** Velocity: max transactions per hour before velocity alert */
const VELOCITY_HOURLY_LIMIT = 10;

// ─── Service ──────────────────────────────────────────────────────────────────

export class ComplianceReportingService {
  // ── AML Monitoring ─────────────────────────────────────────────────────────

  /**
   * Analyse a batch of recent transactions for AML signals.
   * Returns any newly created alerts.
   */
  async runAMLMonitoring(userId: string): Promise<AMLAlert[]> {
    const alerts: AMLAlert[] = [];

    const [volumeAlert, structuringAlert, velocityAlert] = await Promise.all([
      this.checkUnusualVolume(userId),
      this.checkStructuring(userId),
      this.checkVelocity(userId),
    ]);

    for (const alert of [volumeAlert, structuringAlert, velocityAlert]) {
      if (alert) alerts.push(alert);
    }

    if (alerts.length) {
      logger.warn(
        { userId, alertCount: alerts.length },
        "AML alerts generated",
      );
    }

    return alerts;
  }

  private async checkUnusualVolume(userId: string): Promise<AMLAlert | null> {
    const result = await pool.query<{ total: string; ids: string[] }>(
      `SELECT COALESCE(SUM(amount), 0) AS total,
              ARRAY_AGG(id::text) AS ids
       FROM transactions
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '1 day'`,
      [userId],
    );

    const total = parseFloat(result.rows[0]?.total ?? "0");
    if (total < UNUSUAL_VOLUME_THRESHOLD_USD) return null;

    return this.buildAlert(
      userId,
      "unusual-volume",
      result.rows[0].ids ?? [],
      total,
    );
  }

  private async checkStructuring(userId: string): Promise<AMLAlert | null> {
    const result = await pool.query<{ count: string; ids: string[] }>(
      `SELECT COUNT(*) AS count,
              ARRAY_AGG(id::text) AS ids
       FROM transactions
       WHERE user_id = $1
         AND amount BETWEEN $2 AND $3
         AND created_at >= NOW() - INTERVAL '1 day'`,
      [userId, STRUCTURING_THRESHOLD_USD * 0.9, STRUCTURING_THRESHOLD_USD],
    );

    const count = parseInt(result.rows[0]?.count ?? "0", 10);
    if (count < STRUCTURING_COUNT_THRESHOLD) return null;

    return this.buildAlert(
      userId,
      "structuring",
      result.rows[0].ids ?? [],
      count * 1000,
    );
  }

  private async checkVelocity(userId: string): Promise<AMLAlert | null> {
    const result = await pool.query<{ count: string; ids: string[] }>(
      `SELECT COUNT(*) AS count,
              ARRAY_AGG(id::text) AS ids
       FROM transactions
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '1 hour'`,
      [userId],
    );

    const count = parseInt(result.rows[0]?.count ?? "0", 10);
    if (count < VELOCITY_HOURLY_LIMIT) return null;

    return this.buildAlert(
      userId,
      "velocity",
      result.rows[0].ids ?? [],
      count * 100,
    );
  }

  private buildAlert(
    userId: string,
    alertType: AMLAlert["alertType"],
    transactions: string[],
    riskScore: number,
  ): AMLAlert {
    const severity = this.calculateSeverity(riskScore);
    return {
      id: `aml-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      alertType,
      severity,
      transactions,
      riskScore,
      status: "open",
      createdAt: new Date(),
    };
  }

  private calculateSeverity(riskScore: number): AMLAlert["severity"] {
    if (riskScore >= 50_000) return "critical";
    if (riskScore >= 20_000) return "high";
    if (riskScore >= 10_000) return "medium";
    return "low";
  }

  // ── Cross-border monitoring ─────────────────────────────────────────────────

  async checkHighRiskCountry(
    userId: string,
    countryCode: string,
  ): Promise<AMLAlert | null> {
    if (!HIGH_RISK_COUNTRIES.includes(countryCode.toUpperCase())) return null;

    const result = await pool.query<{ ids: string[] }>(
      `SELECT ARRAY_AGG(id::text) AS ids FROM transactions WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
      [userId],
    );

    return this.buildAlert(
      userId,
      "high-risk-country",
      result.rows[0]?.ids ?? [],
      30_000,
    );
  }

  // ── KYC Tracking ───────────────────────────────────────────────────────────

  async getKYCStatus(userId: string): Promise<KYCStatus> {
    const result = await pool.query(
      `SELECT kyc_verified, kyc_level, kyc_verified_at, kyc_expires_at, kyc_risk_rating
       FROM users WHERE id = $1`,
      [userId],
    );

    const row = result.rows[0];
    if (!row) {
      return { userId, verified: false, level: "none", riskRating: "high" };
    }

    return {
      userId,
      verified: row.kyc_verified ?? false,
      level: row.kyc_level ?? "none",
      verifiedAt: row.kyc_verified_at,
      expiresAt: row.kyc_expires_at,
      riskRating: row.kyc_risk_rating ?? "medium",
    };
  }

  async getKYCComplianceRate(): Promise<number> {
    const result = await pool.query<{ total: string; verified: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE kyc_verified = true) AS verified
       FROM users`,
    );
    const { total, verified } = result.rows[0];
    return parseInt(total, 10) === 0
      ? 100
      : Math.round((parseInt(verified, 10) / parseInt(total, 10)) * 100);
  }

  // ── Compliance Reports ──────────────────────────────────────────────────────

  /**
   * Generate a compliance report for a given calendar period (e.g. "2026-05").
   */
  async generateReport(period: string): Promise<ComplianceReport> {
    const [year, month] = period.split("-").map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const [txResult, kycRate] = await Promise.all([
      pool.query<{ total: string; flagged: string }>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE flagged = true) AS flagged
         FROM transactions
         WHERE created_at >= $1 AND created_at < $2`,
        [start, end],
      ),
      this.getKYCComplianceRate(),
    ]);

    const total = parseInt(txResult.rows[0]?.total ?? "0", 10);
    const flagged = parseInt(txResult.rows[0]?.flagged ?? "0", 10);

    return {
      period,
      totalTransactions: total,
      flaggedTransactions: flagged,
      kycCompliance: kycRate,
      amlAlerts: flagged,
      reportedCases: 0, // populated from SAR store in production
    };
  }

  // ── SAR Generation ─────────────────────────────────────────────────────────

  /**
   * Generate a Suspicious Activity Report from an open AML alert.
   */
  generateSAR(alert: AMLAlert): SARReport {
    if (alert.status !== "open" && alert.status !== "investigating") {
      throw new Error(
        `Cannot generate SAR for alert with status '${alert.status}'`,
      );
    }

    return {
      alertId: alert.id,
      userId: alert.userId,
      reportedAt: new Date(),
      summary: `Suspicious activity detected: ${alert.alertType}. Risk score: ${alert.riskScore}. Severity: ${alert.severity}.`,
      transactions: alert.transactions,
      riskScore: alert.riskScore,
    };
  }

  // ── SAR Pipeline ───────────────────────────────────────────────────────────

  /**
   * Persist a SAR to the database with initial status 'pending_review'.
   * Writes an immutable audit log entry on creation.
   */
  async persistSAR(
    sar: SARReport,
    actorId?: string,
  ): Promise<{ id: string }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO sar_reports
           (alert_id, user_id, summary, transactions, risk_score, status)
         VALUES ($1, $2, $3, $4, $5, 'pending_review')
         RETURNING id`,
        [
          sar.alertId,
          sar.userId,
          sar.summary,
          JSON.stringify(sar.transactions),
          sar.riskScore,
        ],
      );

      const sarId = insertResult.rows[0].id;

      await client.query(
        `INSERT INTO sar_audit_log (sar_id, action, actor_id, metadata)
         VALUES ($1, 'created', $2, $3)`,
        [
          sarId,
          actorId ?? null,
          JSON.stringify({
            alertId: sar.alertId,
            userId: sar.userId,
            riskScore: sar.riskScore,
          }),
        ],
      );

      await client.query("COMMIT");
      logger.info({ sarId, userId: sar.userId }, "SAR persisted");
      return { id: sarId };
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ err }, "Failed to persist SAR");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * List SARs pending admin review (admin queue).
   */
  async listPendingSARs(
    page = 1,
    limit = 20,
  ): Promise<{ items: SARQueueItem[]; total: number }> {
    const offset = (page - 1) * limit;

    const [countResult, itemsResult] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM sar_reports WHERE status = 'pending_review'`,
      ),
      pool.query<SARQueueItem>(
        `SELECT id, alert_id, user_id, summary, risk_score, status, created_at
         FROM sar_reports
         WHERE status = 'pending_review'
         ORDER BY risk_score DESC, created_at ASC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    ]);

    return {
      items: itemsResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  /**
   * Get all SARs for the admin queue (all statuses).
   */
  async getAdminSARQueue(
    page = 1,
    limit = 20,
  ): Promise<{ items: SARQueueItem[]; total: number }> {
    const offset = (page - 1) * limit;

    const [countResult, itemsResult] = await Promise.all([
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM sar_reports`),
      pool.query<SARQueueItem>(
        `SELECT id, alert_id, user_id, summary, risk_score, status,
                reviewer_id, reviewed_at, submitted_at, export_path, created_at
         FROM sar_reports
         ORDER BY
           CASE status WHEN 'pending_review' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
           risk_score DESC,
           created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    ]);

    return {
      items: itemsResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  /**
   * Update a SAR's status (approve / reject / mark submitted).
   * Writes an immutable audit log entry for every transition.
   */
  async updateSARStatus(
    sarId: string,
    status: "approved" | "rejected" | "submitted",
    reviewerId: string,
    notes?: string,
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ status: string }>(
        `SELECT status FROM sar_reports WHERE id = $1 FOR UPDATE`,
        [sarId],
      );
      if (!existing.rows[0]) {
        throw new Error(`SAR ${sarId} not found`);
      }

      const extraFields =
        status === "submitted"
          ? `, submitted_at = NOW()`
          : status === "approved" || status === "rejected"
          ? `, reviewed_at = NOW(), reviewer_id = $3`
          : "";

      if (status === "submitted") {
        await client.query(
          `UPDATE sar_reports SET status = $1, updated_at = NOW()${extraFields}
           WHERE id = $2`,
          [status, sarId],
        );
      } else {
        await client.query(
          `UPDATE sar_reports SET status = $1, updated_at = NOW(), reviewed_at = NOW(), reviewer_id = $3
           WHERE id = $2`,
          [status, sarId, reviewerId],
        );
      }

      await client.query(
        `INSERT INTO sar_audit_log (sar_id, action, actor_id, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          sarId,
          `status_changed_to_${status}`,
          reviewerId,
          JSON.stringify({
            previousStatus: existing.rows[0].status,
            newStatus: status,
            notes: notes ?? null,
          }),
        ],
      );

      await client.query("COMMIT");
      logger.info({ sarId, status, reviewerId }, "SAR status updated");
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ err, sarId }, "Failed to update SAR status");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Export a SAR as a CSV string (file-based adapter; API submission planned).
   */
  async exportSARToCSV(sarId: string): Promise<string> {
    const result = await pool.query<SARQueueItem>(
      `SELECT id, alert_id, user_id, summary, transactions, risk_score, status,
              reviewer_id, reviewed_at, submitted_at, created_at
       FROM sar_reports WHERE id = $1`,
      [sarId],
    );

    if (!result.rows[0]) throw new Error(`SAR ${sarId} not found`);
    const row = result.rows[0];

    const header = [
      "id",
      "alert_id",
      "user_id",
      "summary",
      "transactions",
      "risk_score",
      "status",
      "reviewer_id",
      "reviewed_at",
      "submitted_at",
      "created_at",
    ];

    const escape = (v: unknown): string => {
      const s = v == null ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };

    const dataRow = [
      escape(row.id),
      escape(row.alert_id),
      escape(row.user_id),
      escape(row.summary),
      escape(JSON.stringify(row.transactions)),
      escape(row.risk_score),
      escape(row.status),
      escape(row.reviewer_id),
      escape(row.reviewed_at),
      escape(row.submitted_at),
      escape(row.created_at),
    ];

    // Record export in audit log
    await pool.query(
      `INSERT INTO sar_audit_log (sar_id, action, metadata)
       VALUES ($1, 'exported_csv', $2)`,
      [sarId, JSON.stringify({ format: "csv" })],
    );

    // Mark export path
    await pool.query(
      `UPDATE sar_reports SET export_path = $1, updated_at = NOW() WHERE id = $2`,
      [`csv-export-${sarId}-${Date.now()}`, sarId],
    );

    return [header.join(","), dataRow.join(",")].join("\n");
  }

  /**
   * Get a single SAR by ID.
   */
  async getSARById(sarId: string): Promise<SARQueueItem | null> {
    const result = await pool.query<SARQueueItem>(
      `SELECT id, alert_id, user_id, summary, transactions, risk_score, status,
              reviewer_id, reviewed_at, submitted_at, export_path, created_at, updated_at
       FROM sar_reports WHERE id = $1`,
      [sarId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Get the audit trail for a SAR.
   */
  async getSARAuditLog(
    sarId: string,
  ): Promise<{ action: string; actor_id: string | null; metadata: any; created_at: Date }[]> {
    const result = await pool.query(
      `SELECT action, actor_id, metadata, created_at
       FROM sar_audit_log WHERE sar_id = $1 ORDER BY created_at ASC`,
      [sarId],
    );
    return result.rows;
  }
}

// ── Additional type for DB queue items ────────────────────────────────────────
export interface SARQueueItem {
  id: string;
  alert_id: string;
  user_id: string;
  summary: string;
  transactions: string[];
  risk_score: number;
  status: "pending_review" | "approved" | "rejected" | "submitted";
  reviewer_id?: string;
  reviewed_at?: Date;
  submitted_at?: Date;
  export_path?: string;
  created_at: Date;
  updated_at?: Date;
}

export const complianceReportingService = new ComplianceReportingService();
