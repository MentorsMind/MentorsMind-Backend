import pool, { db } from "../config/database";
import { CollaborationState } from "../types/collaboration.types";
import { PaginationUtil } from "../utils/pagination.utils";
import { Logger } from "../utils/logger.utils";
import {
  TenantContext,
  withTenantFilter,
  withCurrentTenantFilter,
} from "../utils/tenant-context.utils";

export interface Session {
  id: string;
  mentor_id: string;
  learner_id: string;
  start_time: Date;
  end_time: Date;
  status: "scheduled" | "completed" | "cancelled";
  created_at: Date;
}

export interface SessionRecord {
  id: string;
  tenant_id: string | null;
  mentor_id: string;
  mentee_id: string;
  title: string;
  description: string | null;
  scheduled_at: Date;
  duration_minutes: number;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  meeting_link: string | null;
  meeting_url: string | null;
  meeting_provider: string | null;
  meeting_room_id: string | null;
  meeting_expires_at: Date | null;
  needs_manual_intervention: boolean;
  collaboration_state: CollaborationState | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSessionPayload {
  mentorId: string;
  menteeId: string;
  title: string;
  description?: string;
  scheduledAt: Date;
  durationMinutes: number;
}

export interface UpdateMeetingUrlPayload {
  meetingUrl: string;
  meetingProvider: string;
  meetingRoomId: string;
  meetingExpiresAt: Date;
}

export interface UpdateCollaborationStatePayload {
  collaborationState: CollaborationState;
}

/**
 * Session Model - Database operations for mentorship sessions
 */
export const SessionModel = {
  /**
   * Create a new session
   */
  async create(payload: CreateSessionPayload): Promise<SessionRecord> {
    const tenantId = TenantContext.hasTenantContext()
      ? TenantContext.getTenantId()
      : null;

    const query = `
      INSERT INTO sessions (tenant_id, mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, collaboration_state)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const defaultState = null;
    const { rows } = await db.query(query, [
      tenantId,
      payload.mentorId,
      payload.menteeId,
      payload.title,
      payload.description || null,
      payload.scheduledAt,
      payload.durationMinutes,
      defaultState,
    ]);

    return rows[0];
  },

  /**
   * Find session by ID (tenant-scoped)
   */
  async findById(id: string): Promise<SessionRecord | null> {
    const { query, params } = withCurrentTenantFilter(
      "SELECT * FROM sessions WHERE id = $1",
      [id],
    );
    const { rows } = await db.query(query, params);
    return rows[0] ?? null;
  },

  /**
   * Find sessions by user ID (either as mentor or mentee) with cursor pagination
   */
  async findByUserIdPaginated(
    userId: string,
    filters: { cursor?: string; limit?: number },
  ): Promise<{
    sessions: SessionRecord[];
    next_cursor: string | null;
    has_more: boolean;
    total: number;
  }> {
    const limit = filters.limit ?? 20;

    const conditions: string[] = ["(mentor_id = $1 OR mentee_id = $1)"];
    const baseParams: unknown[] = [userId];
    let idx = 2;

    if (filters.cursor) {
      const decoded = PaginationUtil.decodeCursor(filters.cursor);
      if (decoded) {
        conditions.push(`(scheduled_at, id) < ($${idx}, $${idx + 1})`);
        baseParams.push(decoded.created_at, decoded.id);
        idx += 2;
      }
    }

    const baseWhere = conditions.join(" AND ");

    // Apply tenant filter
    const { query: dataQuery, params: dataParams } = withCurrentTenantFilter(
      `SELECT * FROM sessions WHERE ${baseWhere}`,
      baseParams,
    );
    const { query: countQuery, params: countParams } = withCurrentTenantFilter(
      `SELECT COUNT(*) FROM sessions WHERE mentor_id = $1 OR mentee_id = $1`,
      [userId],
    );

    const finalParamIdx = dataParams.length + 1;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query<SessionRecord>(
        `${dataQuery} ORDER BY scheduled_at DESC, id DESC LIMIT $${finalParamIdx}`,
        [...dataParams, limit + 1],
      ),
      pool.query(countQuery, countParams),
    ]);

    const has_more = rows.length > limit;
    const data = has_more ? rows.slice(0, limit) : rows;

    const lastItem = data[data.length - 1];
    const next_cursor =
      has_more && lastItem
        ? PaginationUtil.encodeCursor({
            id: lastItem.id,
            created_at: lastItem.scheduled_at.toISOString(),
          })
        : null;

    return {
      sessions: data,
      next_cursor,
      has_more,
      total: parseInt(countRows[0].count, 10),
    };
  },

  /**
   * Find all sessions for a user (both as mentor and mentee)
   */
  async findByUserId(userId: string): Promise<SessionRecord[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM sessions WHERE mentor_id = $1 OR mentee_id = $1`,
      [userId],
    );

    const { rows } = await pool.query<SessionRecord>(
      `${query} ORDER BY scheduled_at DESC, id DESC`,
      params,
    );
    return rows;
  },

  /**
   * Find upcoming sessions for a user
   */
  async findUpcomingByUserId(userId: string): Promise<SessionRecord[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM sessions
       WHERE (mentor_id = $1 OR mentee_id = $1)
         AND scheduled_at >= NOW()
         AND status IN ('pending', 'confirmed')`,
      [userId],
    );

    const { rows } = await pool.query<SessionRecord>(
      `${query} ORDER BY scheduled_at ASC`,
      params,
    );
    return rows;
  },

  /**
   * Update session status (tenant-scoped)
   */
  async updateStatus(
    id: string,
    status: string,
  ): Promise<SessionRecord | null> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id],
    );

    const { rows } = await pool.query<SessionRecord>(
      `${query} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  /**
   * Update meeting URL and related fields (tenant-scoped)
   */
  async updateMeetingUrl(
    id: string,
    payload: UpdateMeetingUrlPayload,
  ): Promise<SessionRecord | null> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE sessions
       SET
         meeting_url = $1,
         meeting_provider = $2,
         meeting_room_id = $3,
         meeting_expires_at = $4,
         updated_at = NOW()
       WHERE id = $5`,
      [
        payload.meetingUrl,
        payload.meetingProvider,
        payload.meetingRoomId,
        payload.meetingExpiresAt,
        id,
      ],
    );

    const { rows } = await pool.query<SessionRecord>(
      `${query} RETURNING *`,
      params,
    );

    return rows[0] ?? null;
  },

  /**
   * Update collaboration state for a session (tenant-scoped)
   */
  async updateCollaborationState(
    id: string,
    collaborationState: CollaborationState,
  ): Promise<SessionRecord | null> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE sessions SET collaboration_state = $1, updated_at = NOW() WHERE id = $2`,
      [collaborationState, id],
    );

    const { rows } = await pool.query<SessionRecord>(
      `${query} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  /**
   * Mark session for manual intervention (tenant-scoped)
   */
  async markForManualIntervention(id: string): Promise<SessionRecord | null> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE sessions SET needs_manual_intervention = TRUE, updated_at = NOW() WHERE id = $1`,
      [id],
    );

    const { rows } = await pool.query<SessionRecord>(
      `${query} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  /**
   * Get sessions needing manual intervention (tenant-scoped)
   */
  async findNeedingManualIntervention(): Promise<SessionRecord[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM sessions WHERE needs_manual_intervention = TRUE`,
      [],
    );

    const { rows } = await pool.query<SessionRecord>(
      `${query} ORDER BY created_at DESC`,
      params,
    );
    return rows;
  },

  /**
   * Get expired meetings (tenant-scoped)
   */
  async findExpiredMeetings(): Promise<SessionRecord[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM sessions
       WHERE meeting_expires_at IS NOT NULL
         AND meeting_expires_at < NOW()
         AND status IN ('confirmed', 'completed')`,
      [],
    );

    const { rows } = await pool.query<SessionRecord>(
      `${query} ORDER BY meeting_expires_at ASC`,
      params,
    );
    return rows;
  },

  /**
   * Clear manual intervention flag (tenant-scoped)
   */
  async clearManualIntervention(id: string): Promise<boolean> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE sessions SET needs_manual_intervention = FALSE, updated_at = NOW() WHERE id = $1`,
      [id],
    );

    const { rowCount } = await pool.query(
      `${query} RETURNING id`,
      params,
    );
    return (rowCount ?? 0) > 0;
  },

  /**
   * Delete a session (tenant-scoped)
   */
  async delete(id: string): Promise<boolean> {
    const { query, params } = withCurrentTenantFilter(
      "DELETE FROM sessions WHERE id = $1",
      [id],
    );
    const { rowCount } = await pool.query(`${query} RETURNING id`, params);
    return (rowCount ?? 0) > 0;
  },

  /**
   * Archive sessions older than the specified number of years.
   * Moves rows into `sessions_archive` and deletes from `sessions` in a single CTE.
   * Returns number of archived sessions.
   *
   * Note: archive runs across all tenants (system-level operation).
   */
  async archiveOlderThanYears(years: number): Promise<number> {
    const moveQuery = `
      WITH moved AS (
        DELETE FROM sessions
        WHERE created_at < NOW() - ($1::int * INTERVAL '1 year')
        RETURNING id, tenant_id, mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, status, meeting_link, meeting_url, meeting_provider, meeting_room_id, meeting_expires_at, needs_manual_intervention, notes, created_at, updated_at
      )
      INSERT INTO sessions_archive (id, tenant_id, mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, status, meeting_link, meeting_url, meeting_provider, meeting_room_id, meeting_expires_at, needs_manual_intervention, notes, created_at, updated_at, archived_at)
      SELECT id, tenant_id, mentor_id, mentee_id, title, description, scheduled_at, duration_minutes, status, meeting_link, meeting_url, meeting_provider, meeting_room_id, meeting_expires_at, needs_manual_intervention, notes, created_at, updated_at, NOW()
      FROM moved
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(moveQuery, [years]);
      const moved = rowCount ?? 0;
      if (moved > 0) {
        logger.info("SessionModel: archived old sessions", { years, moved });
      }
      return moved;
    } catch (error) {
      logger.error("Failed to archive old sessions:", error);
      return 0;
    }
  },
};

export default SessionModel;

