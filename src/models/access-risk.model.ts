/**
 * Access Risk Log Model
 *
 * Persists continuous risk assessments computed by RiskAssessmentService and
 * exposes queries used to derive historical signals (IP/device diversity,
 * recent access patterns) for future assessments.
 *
 * Part of issue #839 "Implement Zero Trust Security Model".
 */

import pool from "../config/database";

export interface AccessRiskLogEntry {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  device_fingerprint: string | null;
  risk_score: number;
  decision: string;
  resource: string | null;
  created_at: Date;
}

export interface RecordAccessRiskPayload {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  riskScore: number;
  decision: string;
  resource?: string | null;
}

export const AccessRiskModel = {
  /** Insert a new risk-assessment record. */
  async record(entry: RecordAccessRiskPayload): Promise<AccessRiskLogEntry> {
    const { rows } = await pool.query<AccessRiskLogEntry>(
      `INSERT INTO access_risk_log
         (user_id, ip_address, user_agent, device_fingerprint, risk_score, decision, resource)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        entry.userId,
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
        entry.deviceFingerprint ?? null,
        entry.riskScore,
        entry.decision,
        entry.resource ?? null,
      ],
    );
    return rows[0];
  },

  /** Fetch a user's recent access-risk log rows within the last `windowMinutes`. */
  async getRecentForUser(
    userId: string,
    windowMinutes: number,
  ): Promise<AccessRiskLogEntry[]> {
    const { rows } = await pool.query<AccessRiskLogEntry>(
      `SELECT * FROM access_risk_log
       WHERE user_id = $1
         AND created_at >= NOW() - ($2 || ' minutes')::interval
       ORDER BY created_at DESC`,
      [userId, windowMinutes],
    );
    return rows;
  },

  /**
   * Count how many distinct IP addresses a user has accessed from since a
   * given timestamp. Used as an "impossible travel" / anomalous-access proxy.
   */
  async countDistinctIpsSince(userId: string, since: Date): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT ip_address) AS count
       FROM access_risk_log
       WHERE user_id = $1
         AND created_at >= $2
         AND ip_address IS NOT NULL`,
      [userId, since],
    );
    return parseInt(rows[0]?.count ?? "0", 10);
  },

  /**
   * Per-day distinct-IP counts for a user over the last `days` days, used to
   * seed/refresh the Redis-backed baseline (see baseline-store.service.ts).
   * Returns one row per UTC day that has at least one log entry — days with
   * no activity are simply absent (callers treat them as 0).
   */
  async getDailyDistinctIpCounts(
    userId: string,
    days: number,
  ): Promise<Array<{ day: string; count: number }>> {
    const { rows } = await pool.query<{ day: string; count: string }>(
      `SELECT created_at::date::text AS day, COUNT(DISTINCT ip_address) AS count
       FROM access_risk_log
       WHERE user_id = $1
         AND created_at >= NOW() - ($2 || ' days')::interval
         AND ip_address IS NOT NULL
       GROUP BY created_at::date
       ORDER BY created_at::date`,
      [userId, days],
    );
    return rows.map((r) => ({ day: r.day, count: parseInt(r.count, 10) }));
  },

  /** Distinct user_ids with any access-risk-log activity in the last `days` days. */
  async getUserIdsWithRecentActivity(days: number): Promise<string[]> {
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT user_id
       FROM access_risk_log
       WHERE created_at >= NOW() - ($1 || ' days')::interval`,
      [days],
    );
    return rows.map((r) => r.user_id);
  },
};
