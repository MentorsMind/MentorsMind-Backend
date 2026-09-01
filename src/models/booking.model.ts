import { db } from "../config/database";
import {
  TenantContext,
  withTenantFilter,
  withCurrentTenantFilter,
  ADMIN_BYPASS_TENANT_ID,
} from "../utils/tenant-context.utils";

export interface BookingRecord {
  id: string;
  tenant_id: string | null;
  mentee_id: string;
  mentor_id: string;
  scheduled_at: Date;
  duration_minutes: number;
  topic: string;
  notes: string | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rescheduled" | "no_show";
  amount: string;
  currency: string;
  usd_equivalent: string | null;
  payment_status: "pending" | "paid" | "partially_refunded" | "refunded" | "failed";
  stellar_tx_hash: string | null;
  transaction_id: string | null;
  cancellation_reason: string | null;
  session_id?: string;
  meeting_id?: string;
  meeting_url?: string;
  mentor_joined_at: Date | null;
  mentee_joined_at: Date | null;
  no_show_detected_at: Date | null;
  no_show_refund_tx_hash: string | null;
  no_show_offender_role: "mentor" | "mentee" | null;
  no_show_dispute_deadline: Date | null;
  no_show_disputed_at: Date | null;
  no_show_dispute_status: "none" | "pending" | "approved" | "dismissed";
  no_show_dispute_reason: string | null;
  no_show_penalty_points: number;
  created_at: Date;
  updated_at: Date;
}

export const BookingModel = {
  async create(data: {
    menteeId: string;
    mentorId: string;
    scheduledAt: Date;
    durationMinutes: number;
    topic: string;
    notes?: string;
    amount: string;
    currency: string;
    usdEquivalent?: string | null;
  }): Promise<BookingRecord> {
    const tenantId = TenantContext.hasTenantContext()
      ? TenantContext.getTenantId()
      : null;

    const { rows } = await db.query(
      `INSERT INTO bookings (tenant_id, mentee_id, mentor_id, scheduled_at, duration_minutes, topic, notes, amount, currency, usd_equivalent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tenantId,
        data.menteeId,
        data.mentorId,
        data.scheduledAt,
        data.durationMinutes,
        data.topic,
        data.notes || null,
        data.amount,
        data.currency,
        data.usdEquivalent ?? null,
      ],
    );
    return rows[0];
  },

  async findById(id: string): Promise<BookingRecord | null> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM bookings WHERE id = $1`,
      [id],
    );
    const { rows } = await db.query(query, params);
    return rows[0] || null;
  },

  async findByUserId(
    userId: string,
    filters?: {
      status?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ bookings: BookingRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 10;
    const offset = (page - 1) * limit;

    let whereClause = "(mentee_id = $1 OR mentor_id = $1)";
    const baseParams: unknown[] = [userId];
    let paramIndex = 2;

    if (filters?.status) {
      whereClause += ` AND status = $${paramIndex}`;
      baseParams.push(filters.status);
      paramIndex++;
    }

    // Apply tenant filter on top of the existing WHERE clause
    const { query: baseQuery, params: filteredParams } = withCurrentTenantFilter(
      `SELECT * FROM bookings WHERE ${whereClause}`,
      baseParams,
    );
    const finalParamIndex = filteredParams.length + 1;

    const { query: countQuery, params: countParams } = withCurrentTenantFilter(
      `SELECT COUNT(*) FROM bookings WHERE ${whereClause}`,
      baseParams,
    );

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `${baseQuery} ORDER BY scheduled_at DESC LIMIT $${finalParamIndex} OFFSET $${finalParamIndex + 1}`,
        [...filteredParams, limit, offset],
      ),
      db.query(countQuery, countParams),
    ]);

    return {
      bookings: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async findByUserIds(userIds: string[]): Promise<BookingRecord[]> {
    if (userIds.length === 0) return [];
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM bookings WHERE mentee_id = ANY($1) OR mentor_id = ANY($1)`,
      [userIds],
    );
    const { rows } = await db.query(
      `${query} ORDER BY scheduled_at DESC`,
      params,
    );
    return rows;
  },

  async update(
    id: string,
    data: Partial<{
      scheduledAt: Date;
      durationMinutes: number;
      topic: string;
      notes: string;
      status: string;
      paymentStatus: string;
      stellarTxHash: string;
      transactionId: string;
      cancellationReason: string;
      noShowDisputeStatus: string;
      noShowDisputedAt: Date;
      noShowDisputeReason: string | null;
    }>,
  ): Promise<BookingRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.scheduledAt !== undefined) {
      fields.push(`scheduled_at = $${idx++}`);
      values.push(data.scheduledAt);
    }
    if (data.durationMinutes !== undefined) {
      fields.push(`duration_minutes = $${idx++}`);
      values.push(data.durationMinutes);
    }
    if (data.topic !== undefined) {
      fields.push(`topic = $${idx++}`);
      values.push(data.topic);
    }
    if (data.notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      values.push(data.notes);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(data.status);
    }
    if (data.paymentStatus !== undefined) {
      fields.push(`payment_status = $${idx++}`);
      values.push(data.paymentStatus);
    }
    if (data.stellarTxHash !== undefined) {
      fields.push(`stellar_tx_hash = $${idx++}`);
      values.push(data.stellarTxHash);
    }
    if (data.transactionId !== undefined) {
      fields.push(`transaction_id = $${idx++}`);
      values.push(data.transactionId);
    }
    if (data.cancellationReason !== undefined) {
      fields.push(`cancellation_reason = $${idx++}`);
      values.push(data.cancellationReason);
    }
    if (data.noShowDisputeStatus !== undefined) {
      fields.push(`no_show_dispute_status = $${idx++}`);
      values.push(data.noShowDisputeStatus);
    }
    if (data.noShowDisputedAt !== undefined) {
      fields.push(`no_show_disputed_at = $${idx++}`);
      values.push(data.noShowDisputedAt);
    }
    if (data.noShowDisputeReason !== undefined) {
      fields.push(`no_show_dispute_reason = $${idx++}`);
      values.push(data.noShowDisputeReason);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = NOW()`);

    // Build the WHERE clause with tenant filter
    const baseWhereParams: unknown[] = [...values, id];
    const { query: filteredQuery, params: allParams } = withCurrentTenantFilter(
      `UPDATE bookings SET ${fields.join(", ")} WHERE id = $${idx}`,
      baseWhereParams,
    );

    const { rows } = await db.query(`${filteredQuery} RETURNING *`, allParams);
    return rows[0] || null;
  },

  /**
   * Transactional variant of `update`. Use this inside
   * `DatabaseService.withTransaction` so the booking update is committed
   * atomically with the outbox write that publishes the side-effects.
   */
  async updateWithClient(
    client: import("pg").PoolClient,
    id: string,
    data: Partial<{
      scheduledAt: Date;
      durationMinutes: number;
      topic: string;
      notes: string;
      status: string;
      paymentStatus: string;
      stellarTxHash: string;
      transactionId: string;
      cancellationReason: string;
    }>,
  ): Promise<BookingRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.scheduledAt !== undefined) {
      fields.push(`scheduled_at = $${idx++}`);
      values.push(data.scheduledAt);
    }
    if (data.durationMinutes !== undefined) {
      fields.push(`duration_minutes = $${idx++}`);
      values.push(data.durationMinutes);
    }
    if (data.topic !== undefined) {
      fields.push(`topic = $${idx++}`);
      values.push(data.topic);
    }
    if (data.notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      values.push(data.notes);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(data.status);
    }
    if (data.paymentStatus !== undefined) {
      fields.push(`payment_status = $${idx++}`);
      values.push(data.paymentStatus);
    }
    if (data.stellarTxHash !== undefined) {
      fields.push(`stellar_tx_hash = $${idx++}`);
      values.push(data.stellarTxHash);
    }
    if (data.transactionId !== undefined) {
      fields.push(`transaction_id = $${idx++}`);
      values.push(data.transactionId);
    }
    if (data.cancellationReason !== undefined) {
      fields.push(`cancellation_reason = $${idx++}`);
      values.push(data.cancellationReason);
    }

    if (fields.length === 0) {
      const { rows } = await client.query(
        `SELECT * FROM bookings WHERE id = $1`,
        [id],
      );
      return rows[0] || null;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await client.query(
      `UPDATE bookings SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0] || null;
  },

  async checkConflict(
    mentorId: string,
    scheduledAt: Date,
    durationMinutes: number,
    excludeBookingId?: string,
  ): Promise<boolean> {
    const endTime = new Date(scheduledAt.getTime() + durationMinutes * 60000);

    let baseQuery = `
      SELECT COUNT(*) FROM bookings
      WHERE mentor_id = $1
        AND status NOT IN ('cancelled', 'completed')
        AND (
          (scheduled_at <= $2 AND scheduled_at + (duration_minutes || ' minutes')::INTERVAL > $2)
          OR (scheduled_at < $3 AND scheduled_at + (duration_minutes || ' minutes')::INTERVAL >= $3)
          OR (scheduled_at >= $2 AND scheduled_at < $3)
        )
    `;

    const baseParams: unknown[] = [mentorId, scheduledAt, endTime];

    if (excludeBookingId) {
      baseQuery += ` AND id != $4`;
      baseParams.push(excludeBookingId);
    }

    const { query, params } = withCurrentTenantFilter(baseQuery, baseParams);
    const { rows } = await db.query(query, params);
    return parseInt(rows[0].count, 10) > 0;
  },

  /**
   * Admin-only: fetch bookings across all tenants.
   * Caller is responsible for verifying admin permission before calling this.
   */
  async findAllAcrossTenants(
    limit = 50,
    offset = 0,
  ): Promise<BookingRecord[]> {
    const { rows } = await db.query(
      `SELECT * FROM bookings ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  },
};
