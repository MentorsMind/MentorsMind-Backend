import pool from "../config/database";
import {
  TenantContext,
  withCurrentTenantFilter,
} from "../utils/tenant-context.utils";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";

export type DisputeStatus =
  | "open"
  | "investigating"
  | "mediation"
  | "resolved"
  | "dismissed"
  | "escalated";
export type DisputeType = "payment" | "quality" | "conduct" | "cancellation";

export interface DisputeRecord {
  id: string;
  tenant_id: string | null;
  session_id: string;
  filed_by_id: string;
  respondent_id: string | null;
  type: DisputeType;
  reason: string;
  status: DisputeStatus;
  resolution_notes: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

export interface DisputeEvidenceRecord {
  id: string;
  dispute_id: string;
  submitter_id: string;
  text_content: string | null;
  file_url: string | null;
  created_at: Date;
}

export const DisputeModel = {
  async create(data: {
    session_id: string;
    filed_by_id: string;
    respondent_id: string;
    type: DisputeType;
    reason: string;
    status?: DisputeStatus;
  }, client?: any): Promise<DisputeRecord> {
    const tenantId = TenantContext.hasTenantContext()
      ? TenantContext.getTenantId()
      : null;

    const existingDispute = await this.findOpenBySessionId(data.session_id, client);
    if (existingDispute) {
      throw createError(ErrorCode.DISPUTE_ALREADY_EXISTS, 409);
    }

    const dbClient = client || pool;
    const { rows } = await dbClient.query<DisputeRecord>(
      `INSERT INTO disputes (tenant_id, session_id, filed_by_id, respondent_id, type, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        tenantId,
        data.session_id,
        data.filed_by_id,
        data.respondent_id,
        data.type,
        data.reason,
        data.status || 'open',
      ],
    );
    return rows[0];
  },

  /**
   * Finds an active or open dispute for a given session/booking (status not resolved or dismissed).
   */
  async findOpenBySessionId(
    sessionId: string,
    client?: any,
  ): Promise<DisputeRecord | null> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM disputes
       WHERE session_id = $1
       AND status NOT IN ('resolved', 'dismissed')
       LIMIT 1`,
      [sessionId],
    );
    const dbClient = client || pool;
    const { rows } = await dbClient.query<DisputeRecord>(query, params);
    return rows[0] || null;
  },

  /**
   * Alias for findOpenBySessionId.
   */
  async findActiveBySessionId(
    sessionId: string,
    client?: any,
  ): Promise<DisputeRecord | null> {
    return this.findOpenBySessionId(sessionId, client);
  },

  /**
   * Returns all disputes associated with a session/booking.
   */
  async findBySessionId(
    sessionId: string,
    client?: any,
  ): Promise<DisputeRecord[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM disputes WHERE session_id = $1 ORDER BY created_at DESC`,
      [sessionId],
    );
    const dbClient = client || pool;
    const { rows } = await dbClient.query<DisputeRecord>(query, params);
    return rows;
  },

  async findById(id: string): Promise<DisputeRecord | null> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM disputes WHERE id = $1`,
      [id],
    );
    const { rows } = await pool.query<DisputeRecord>(query, params);
    return rows[0] || null;
  },

  async findByUserId(userId: string): Promise<DisputeRecord[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM disputes WHERE filed_by_id = $1 OR respondent_id = $1`,
      [userId],
    );
    const { rows } = await pool.query<DisputeRecord>(
      `${query} ORDER BY created_at DESC`,
      params,
    );
    return rows;
  },

  /**
   * findAll is intentionally cross-tenant (admin use only).
   * When called in a tenant context it still filters by tenant_id so that
   * tenant-level admins can only see their own disputes.
   */
  async findAll(limit = 50, offset = 0): Promise<DisputeRecord[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM disputes`,
      [],
    );
    const nextIdx = params.length + 1;
    const { rows } = await pool.query<DisputeRecord>(
      `${query} ORDER BY created_at DESC LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, limit, offset],
    );
    return rows;
  },

  async findUnresolvedOlderThanDays(days: number): Promise<DisputeRecord[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM disputes
       WHERE status != 'resolved'
       AND created_at < NOW() - make_interval(days => $1)`,
      [days],
    );
    const { rows } = await pool.query<DisputeRecord>(query, params);
    return rows;
  },

  async updateStatus(
    id: string,
    status: DisputeStatus,
    notes?: string,
  ): Promise<DisputeRecord | null> {
    const resolvedAtQueryPart =
      status === "resolved" ? ", resolved_at = NOW()" : "";

    const { query, params } = withCurrentTenantFilter(
      `UPDATE disputes SET status = $1, resolution_notes = COALESCE($2, resolution_notes), updated_at = NOW()${resolvedAtQueryPart}
       WHERE id = $3`,
      [status, notes || null, id],
    );

    const { rows } = await pool.query<DisputeRecord>(
      `${query} RETURNING *`,
      params,
    );
    return rows[0] || null;
  },

  async countActive(): Promise<number> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT COUNT(*) FROM disputes WHERE status IN ('open', 'investigating', 'mediation', 'escalated')`,
      [],
    );
    const { rows } = await pool.query(query, params);
    return parseInt(rows[0].count, 10);
  },

  async addEvidence(data: {
    dispute_id: string;
    submitter_id: string;
    text_content?: string;
    file_url?: string;
  }): Promise<DisputeEvidenceRecord> {
    // Evidence is linked to a dispute; no direct tenant_id on evidence table
    const { rows } = await pool.query<DisputeEvidenceRecord>(
      `INSERT INTO dispute_evidence (dispute_id, submitter_id, text_content, file_url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        data.dispute_id,
        data.submitter_id,
        data.text_content || null,
        data.file_url || null,
      ],
    );
    return rows[0];
  },

  async getEvidence(disputeId: string): Promise<DisputeEvidenceRecord[]> {
    const { rows } = await pool.query<DisputeEvidenceRecord>(
      `SELECT * FROM dispute_evidence WHERE dispute_id = $1 ORDER BY created_at ASC`,
      [disputeId],
    );
    return rows;
  },
};
