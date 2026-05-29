import pool from '../config/database';

export interface SessionRecordingRecord {
  id: string;
  session_id: string;
  mentor_id: string;
  mentee_id: string;
  s3_key: string;
  s3_bucket: string;
  file_size: number | null;
  duration_seconds: number | null;
  status: 'recording' | 'processing' | 'ready' | 'deleted' | 'failed';
  mentor_consent: boolean;
  mentee_consent: boolean;
  mentor_consent_timestamp: Date | null;
  mentee_consent_timestamp: Date | null;
  consent_ip_address: string | null;
  consent_user_agent: string | null;
  recording_started_at: Date | null;
  recording_ended_at: Date | null;
  expires_at: Date;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRecordingPayload {
  sessionId: string;
  mentorId: string;
  menteeId: string;
  s3Key: string;
  s3Bucket: string;
  expiresAt: Date;
}

export interface UpdateConsentPayload {
  mentorConsent?: boolean;
  menteeConsent?: boolean;
  consentIpAddress?: string;
  consentUserAgent?: string;
}

export interface UpdateRecordingStatusPayload {
  status: 'recording' | 'processing' | 'ready' | 'deleted' | 'failed';
  fileSize?: number;
  durationSeconds?: number;
  recordingStartedAt?: Date;
  recordingEndedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Session Recording Model - Database operations for session recordings
 */
export const SessionRecordingModel = {
  /**
   * Initialize session_recordings table
   */
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS session_recordings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mentee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        s3_key VARCHAR(500) NOT NULL,
        s3_bucket VARCHAR(255) NOT NULL,
        file_size BIGINT,
        duration_seconds INTEGER,
        status VARCHAR(50) NOT NULL DEFAULT 'recording',
        mentor_consent BOOLEAN NOT NULL DEFAULT FALSE,
        mentee_consent BOOLEAN NOT NULL DEFAULT FALSE,
        mentor_consent_timestamp TIMESTAMP WITH TIME ZONE,
        mentee_consent_timestamp TIMESTAMP WITH TIME ZONE,
        consent_ip_address VARCHAR(45),
        consent_user_agent TEXT,
        recording_started_at TIMESTAMP WITH TIME ZONE,
        recording_ended_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_session_recordings_session_id ON session_recordings(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_recordings_mentor_id ON session_recordings(mentor_id);
      CREATE INDEX IF NOT EXISTS idx_session_recordings_mentee_id ON session_recordings(mentee_id);
      CREATE INDEX IF NOT EXISTS idx_session_recordings_status ON session_recordings(status);
      CREATE INDEX IF NOT EXISTS idx_session_recordings_expires_at ON session_recordings(expires_at);
      CREATE INDEX IF NOT EXISTS idx_session_recordings_created_at ON session_recordings(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_session_recordings_expired ON session_recordings(expires_at) 
        WHERE status IN ('ready', 'processing');

      CREATE OR REPLACE FUNCTION update_session_recordings_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trigger_update_session_recordings_updated_at ON session_recordings;
      CREATE TRIGGER trigger_update_session_recordings_updated_at
        BEFORE UPDATE ON session_recordings
        FOR EACH ROW
        EXECUTE FUNCTION update_session_recordings_updated_at();
    `;
    await pool.query(query);
  },

  /**
   * Create a new recording
   */
  async create(payload: CreateRecordingPayload): Promise<SessionRecordingRecord> {
    const query = `
      INSERT INTO session_recordings (
        session_id, mentor_id, mentee_id, s3_key, s3_bucket, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const { rows } = await pool.query<SessionRecordingRecord>(query, [
      payload.sessionId,
      payload.mentorId,
      payload.menteeId,
      payload.s3Key,
      payload.s3Bucket,
      payload.expiresAt,
    ]);

    return rows[0];
  },

  /**
   * Find recording by ID
   */
  async findById(id: string): Promise<SessionRecordingRecord | null> {
    const query = "SELECT * FROM session_recordings WHERE id = $1";
    const { rows } = await pool.query<SessionRecordingRecord>(query, [id]);
    return rows[0] ?? null;
  },

  /**
   * Find recording by session ID
   */
  async findBySessionId(sessionId: string): Promise<SessionRecordingRecord | null> {
    const query = "SELECT * FROM session_recordings WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1";
    const { rows } = await pool.query<SessionRecordingRecord>(query, [sessionId]);
    return rows[0] ?? null;
  },

  /**
   * Find recordings by user ID (either as mentor or mentee)
   */
  async findByUserId(userId: string): Promise<SessionRecordingRecord[]> {
    const query = `
      SELECT * FROM session_recordings
      WHERE mentor_id = $1 OR mentee_id = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query<SessionRecordingRecord>(query, [userId]);
    return rows;
  },

  /**
   * Find recordings by user ID with consent check
   */
  async findAccessibleByUserId(userId: string): Promise<SessionRecordingRecord[]> {
    const query = `
      SELECT * FROM session_recordings
      WHERE (mentor_id = $1 OR mentee_id = $1)
        AND status = 'ready'
        AND mentor_consent = TRUE
        AND mentee_consent = TRUE
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query<SessionRecordingRecord>(query, [userId]);
    return rows;
  },

  /**
   * Update consent for a recording
   */
  async updateConsent(
    id: string,
    userId: string,
    payload: UpdateConsentPayload,
  ): Promise<SessionRecordingRecord | null> {
    const recording = await this.findById(id);
    if (!recording) return null;

    const isMentor = recording.mentor_id === userId;
    const isMentee = recording.mentee_id === userId;

    if (!isMentor && !isMentee) {
      throw new Error('User not authorized to update consent for this recording');
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (isMentor && payload.mentorConsent !== undefined) {
      updates.push(`mentor_consent = $${idx}, mentor_consent_timestamp = NOW()`);
      values.push(payload.mentorConsent);
      idx++;
    }

    if (isMentee && payload.menteeConsent !== undefined) {
      updates.push(`mentee_consent = $${idx}, mentee_consent_timestamp = NOW()`);
      values.push(payload.menteeConsent);
      idx++;
    }

    if (payload.consentIpAddress) {
      updates.push(`consent_ip_address = $${idx}`);
      values.push(payload.consentIpAddress);
      idx++;
    }

    if (payload.consentUserAgent) {
      updates.push(`consent_user_agent = $${idx}`);
      values.push(payload.consentUserAgent);
      idx++;
    }

    if (updates.length === 0) {
      return recording;
    }

    values.push(id);

    const query = `
      UPDATE session_recordings
      SET ${updates.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;

    const { rows } = await pool.query<SessionRecordingRecord>(query, values);
    return rows[0] ?? null;
  },

  /**
   * Update recording status and metadata
   */
  async updateStatus(
    id: string,
    payload: UpdateRecordingStatusPayload,
  ): Promise<SessionRecordingRecord | null> {
    const updates: string[] = [`status = $1`];
    const values: unknown[] = [payload.status];
    let idx = 2;

    if (payload.fileSize !== undefined) {
      updates.push(`file_size = $${idx}`);
      values.push(payload.fileSize);
      idx++;
    }

    if (payload.durationSeconds !== undefined) {
      updates.push(`duration_seconds = $${idx}`);
      values.push(payload.durationSeconds);
      idx++;
    }

    if (payload.recordingStartedAt !== undefined) {
      updates.push(`recording_started_at = $${idx}`);
      values.push(payload.recordingStartedAt);
      idx++;
    }

    if (payload.recordingEndedAt !== undefined) {
      updates.push(`recording_ended_at = $${idx}`);
      values.push(payload.recordingEndedAt);
      idx++;
    }

    if (payload.metadata !== undefined) {
      updates.push(`metadata = $${idx}`);
      values.push(JSON.stringify(payload.metadata));
      idx++;
    }

    values.push(id);

    const query = `
      UPDATE session_recordings
      SET ${updates.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;

    const { rows } = await pool.query<SessionRecordingRecord>(query, values);
    return rows[0] ?? null;
  },

  /**
   * Find expired recordings that need cleanup
   */
  async findExpired(): Promise<SessionRecordingRecord[]> {
    const query = `
      SELECT * FROM session_recordings
      WHERE expires_at < NOW()
        AND status IN ('ready', 'processing')
      ORDER BY expires_at ASC
    `;
    const { rows } = await pool.query<SessionRecordingRecord>(query);
    return rows;
  },

  /**
   * Mark recording as deleted
   */
  async markAsDeleted(id: string): Promise<boolean> {
    const query = `
      UPDATE session_recordings
      SET status = 'deleted'
      WHERE id = $1
      RETURNING id
    `;
    const { rowCount } = await pool.query(query, [id]);
    return (rowCount ?? 0) > 0;
  },

  /**
   * Delete a recording permanently
   */
  async delete(id: string): Promise<boolean> {
    const query = "DELETE FROM session_recordings WHERE id = $1 RETURNING id";
    const { rowCount } = await pool.query(query, [id]);
    return (rowCount ?? 0) > 0;
  },

  /**
   * Check if both parties have consented
   */
  async hasFullConsent(id: string): Promise<boolean> {
    const query = `
      SELECT mentor_consent, mentee_consent
      FROM session_recordings
      WHERE id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0) return false;
    return rows[0].mentor_consent && rows[0].mentee_consent;
  },
};

export default SessionRecordingModel;
