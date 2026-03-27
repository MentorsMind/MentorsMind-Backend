import pool from "../config/database";

export interface SessionRecord {
  id: string;
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

/**
 * Session Model - Database operations for mentorship sessions
 */
export const SessionModel = {
  /**
   * Initialize sessions table with meeting URL support
   */
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mentor_id UUID NOT NULL REFERENCES users(id),
        mentee_id UUID NOT NULL REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        meeting_link VARCHAR(500),
        meeting_url VARCHAR(500),
        meeting_provider VARCHAR(50),
        meeting_room_id VARCHAR(255),
        meeting_expires_at TIMESTAMP WITH TIME ZONE,
        needs_manual_intervention BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_mentor_id ON sessions(mentor_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_mentee_id ON sessions(mentee_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_at ON sessions(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_meeting_url ON sessions(meeting_url) WHERE meeting_url IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_sessions_meeting_expires_at ON sessions(meeting_expires_at) WHERE meeting_expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_sessions_needs_manual_intervention ON sessions(needs_manual_intervention) WHERE needs_manual_intervention = TRUE;
    `;
    await pool.query(query);
  },

  /**
   * Create a new session
   */
  async create(payload: CreateSessionPayload): Promise<SessionRecord> {
    const query = `
      INSERT INTO sessions (mentor_id, mentee_id, title, description, scheduled_at, duration_minutes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const { rows } = await pool.query<SessionRecord>(query, [
      payload.mentorId,
      payload.menteeId,
      payload.title,
      payload.description || null,
      payload.scheduledAt,
      payload.durationMinutes,
    ]);

    return rows[0];
  },

  /**
   * Find session by ID
   */
  async findById(id: string): Promise<SessionRecord | null> {
    const query = "SELECT * FROM sessions WHERE id = $1";
    const { rows } = await pool.query<SessionRecord>(query, [id]);
    return rows[0] ?? null;
  },

  /**
   * Find sessions by user ID (either as mentor or mentee)
   */
  async findByUserId(userId: string): Promise<SessionRecord[]> {
    const query = `
      SELECT * FROM sessions
      WHERE mentor_id = $1 OR mentee_id = $1
      ORDER BY scheduled_at DESC
    `;

    const { rows } = await pool.query<SessionRecord>(query, [userId]);
    return rows;
  },

  /**
   * Find upcoming sessions for a user
   */
  async findUpcomingByUserId(userId: string): Promise<SessionRecord[]> {
    const query = `
      SELECT * FROM sessions
      WHERE (mentor_id = $1 OR mentee_id = $1)
        AND scheduled_at >= NOW()
        AND status IN ('pending', 'confirmed')
      ORDER BY scheduled_at ASC
    `;

    const { rows } = await pool.query<SessionRecord>(query, [userId]);
    return rows;
  },

  /**
   * Update session status
   */
  async updateStatus(
    id: string,
    status: string,
  ): Promise<SessionRecord | null> {
    const query = `
      UPDATE sessions
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const { rows } = await pool.query<SessionRecord>(query, [status, id]);
    return rows[0] ?? null;
  },

  /**
   * Update meeting URL and related fields
   */
  async updateMeetingUrl(
    id: string,
    payload: UpdateMeetingUrlPayload,
  ): Promise<SessionRecord | null> {
    const query = `
      UPDATE sessions
      SET
        meeting_url = $1,
        meeting_provider = $2,
        meeting_room_id = $3,
        meeting_expires_at = $4,
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `;

    const { rows } = await pool.query<SessionRecord>(query, [
      payload.meetingUrl,
      payload.meetingProvider,
      payload.meetingRoomId,
      payload.meetingExpiresAt,
      id,
    ]);

    return rows[0] ?? null;
  },

  /**
   * Mark session for manual intervention
   */
  async markForManualIntervention(id: string): Promise<SessionRecord | null> {
    const query = `
      UPDATE sessions
      SET
        needs_manual_intervention = TRUE,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const { rows } = await pool.query<SessionRecord>(query, [id]);
    return rows[0] ?? null;
  },

  /**
   * Get sessions needing manual intervention
   */
  async findNeedingManualIntervention(): Promise<SessionRecord[]> {
    const query = `
      SELECT * FROM sessions
      WHERE needs_manual_intervention = TRUE
      ORDER BY created_at DESC
    `;

    const { rows } = await pool.query<SessionRecord>(query);
    return rows;
  },

  /**
   * Get expired meetings
   */
  async findExpiredMeetings(): Promise<SessionRecord[]> {
    const query = `
      SELECT * FROM sessions
      WHERE meeting_expires_at IS NOT NULL
        AND meeting_expires_at < NOW()
        AND status IN ('confirmed', 'completed')
      ORDER BY meeting_expires_at ASC
    `;

    const { rows } = await pool.query<SessionRecord>(query);
    return rows;
  },

  /**
   * Clear manual intervention flag
   */
  async clearManualIntervention(id: string): Promise<boolean> {
    const query = `
      UPDATE sessions
      SET
        needs_manual_intervention = FALSE,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `;

    const { rowCount } = await pool.query(query, [id]);
    return (rowCount ?? 0) > 0;
  },

  /**
   * Delete a session
   */
  async delete(id: string): Promise<boolean> {
    const query = "DELETE FROM sessions WHERE id = $1 RETURNING id";
    const { rowCount } = await pool.query(query, [id]);
    return (rowCount ?? 0) > 0;
  },
};

export default SessionModel;
