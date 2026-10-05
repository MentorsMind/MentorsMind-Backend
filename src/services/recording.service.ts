import pool from "../config/database";
import { CacheService } from "./cache.service";
import { Logger } from "../utils/logger.utils";
import { StorageService } from "./storage.service";
import { DateTime } from "luxon";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface RecordingConfig {
  autoStartEnabled: boolean;
  retentionDays: number;
  maxFileSizeMB: number;
  allowedFormats: string[];
  transcriptionEnabled: boolean;
  summarizationEnabled: boolean;
}

export interface StartRecordingRequest {
  sessionId: string;
  mentorId: string;
  participantIds: string[];
  initiatedBy: string;
}

export interface RecordingRecord {
  id: string;
  sessionId: string;
  mentorId: string;
  s3Key: string;
  s3Bucket: string;
  status: "pending" | "recording" | "processing" | "ready" | "failed" | "deleted";
  format: string;
  fileSize: number | null;
  durationSeconds: number | null;
  consentStatus: ConsentStatus;
  transcriptionStatus: "not_started" | "processing" | "completed" | "failed";
  summaryStatus: "not_started" | "processing" | "completed" | "failed";
  searchable: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConsentStatus {
  required: boolean;
  participants: ConsentParticipant[];
  allConsented: boolean;
}

export interface ConsentParticipant {
  userId: string;
  consented: boolean;
  consentedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  required?: boolean;
}

export interface TranscriptionResult {
  transcriptionId: string;
  recordingId: string;
  status: "processing" | "completed" | "failed";
  fullText: string | null;
  segments: TranscriptSegment[];
  language: string;
  wordCount: number;
  summary: string | null;
}

export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  speakerId: string;
  speakerName: string;
  text: string;
  confidence: number;
}

export interface RecordingSearchQuery {
  userId: string;
  sessionId?: string;
  textQuery?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

export interface RecordingSearchResult {
  recordingId: string;
  sessionId: string;
  matchText: string;
  matchContext: string;
  segmentStart: number;
  segmentEnd: number;
  score: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const RecordingService = {
  /**
   * Start recording for a session.
   */
  async startRecording(
    request: StartRecordingRequest,
  ): Promise<RecordingRecord> {
    const { sessionId, mentorId, participantIds, initiatedBy } = request;

    // Verify session exists and user is authorized
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.mentor_id !== initiatedBy && session.mentee_id !== initiatedBy) {
      throw new Error("Not authorized to start recording for this session");
    }

    // Check consent requirements
    const consentStatus = await this.getConsentStatus(sessionId, participantIds);
    if (consentStatus.required && !consentStatus.allConsented) {
      throw new Error("All participants must consent before recording starts");
    }

    const recordingId = crypto.randomUUID();
    const s3Key = StorageService.buildRecordingKey(sessionId, recordingId, "mp4");
    const expiresAt = DateTime.now().plus({ days: 30 }).toJSDate();

    const query = `
      INSERT INTO session_recordings (
        id, session_id, mentor_id, s3_key, s3_bucket,
        status, format, consent_status, searchable, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, 'recording', 'mp4', $6, true, $7)
      RETURNING *
    `;

    const { rows } = await pool.query(query, [
      recordingId,
      sessionId,
      mentorId,
      s3Key,
      process.env.AWS_S3_BUCKET || "mentorminds-recordings",
      JSON.stringify(consentStatus),
      expiresAt,
    ]);

    const recording = rows[0] as RecordingRecord;

    logger.info({ recordingId, sessionId, initiatedBy }, "Recording started");

    return recording;
  },

  /**
   * Stop an active recording.
   */
  async stopRecording(
    recordingId: string,
    userId: string,
  ): Promise<RecordingRecord> {
    const recording = await this.getRecording(recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`);
    }

    if (recording.status !== "recording") {
      throw new Error("Recording is not in progress");
    }

    const query = `
      UPDATE session_recordings
      SET status = 'processing', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await pool.query(query, [recordingId]);

    logger.info({ recordingId, userId }, "Recording stopped");

    return rows[0] as RecordingRecord;
  },

  /**
   * Get recording details.
   */
  async getRecording(recordingId: string): Promise<RecordingRecord | null> {
    const query = `
      SELECT * FROM session_recordings WHERE id = $1
    `;
    const { rows } = await pool.query(query, [recordingId]);
    return rows[0] || null;
  },

  /**
   * Get recordings for a session.
   */
  async getSessionRecordings(sessionId: string): Promise<RecordingRecord[]> {
    const query = `
      SELECT * FROM session_recordings
      WHERE session_id = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query, [sessionId]);
    return rows;
  },

  /**
   * Update recording consent.
   */
  async updateConsent(
    recordingId: string,
    userId: string,
    consented: boolean,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<ConsentStatus> {
    const recording = await this.getRecording(recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`);
    }

    const consentStatus = recording.consent_status as unknown as ConsentStatus;
    const participantIndex = consentStatus.participants.findIndex(
      (p) => p.userId === userId,
    );

    if (participantIndex === -1) {
      throw new Error("User is not a participant of this recording");
    }

    consentStatus.participants[participantIndex] = {
      ...consentStatus.participants[participantIndex],
      consented,
      consentedAt: consented ? new Date() : null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    };

    consentStatus.allConsented = consentStatus.participants.every(
      (p) => !p.required || p.consented,
    );

    const query = `
      UPDATE session_recordings
      SET consent_status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING consent_status
    `;
    const { rows } = await pool.query(query, [
      JSON.stringify(consentStatus),
      recordingId,
    ]);

    return rows[0]?.consent_status || consentStatus;
  },

  /**
   * Trigger transcription for a recording.
   */
  async startTranscription(recordingId: string): Promise<string> {
    const recording = await this.getRecording(recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`);
    }

    if (recording.status !== "ready") {
      throw new Error("Recording must be ready before transcription");
    }

    const query = `
      UPDATE session_recordings
      SET transcription_status = 'processing', updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `;
    await pool.query(query, [recordingId]);

    logger.info({ recordingId }, "Transcription started");

    return recordingId;
  },

  /**
   * Store transcription result.
   */
  async completeTranscription(
    recordingId: string,
    result: TranscriptionResult,
  ): Promise<void> {
    const query = `
      UPDATE session_recordings
      SET transcription_status = 'completed',
          transcription_data = $1,
          updated_at = NOW()
      WHERE id = $2
    `;
    await pool.query(query, [JSON.stringify(result), recordingId]);

    // Store searchable text segments
    if (result.segments.length > 0) {
      await this.storeTranscriptSegments(recordingId, result.segments);
    }

    logger.info({ recordingId, wordCount: result.wordCount },
      "Transcription completed");
  },

  /**
   * Search transcripts by text.
   */
  async searchTranscripts(
    searchQuery: RecordingSearchQuery,
  ): Promise<RecordingSearchResult[]> {
    const {
      userId,
      sessionId,
      textQuery,
      dateFrom,
      dateTo,
      limit = 20,
      offset = 0,
    } = searchQuery;

    if (!textQuery || textQuery.trim().length === 0) {
      return [];
    }

    let query = `
      SELECT
        ts.recording_id as recording_id,
        r.session_id,
        ts.text as match_text,
        ts.start_seconds as segment_start,
        ts.end_seconds as segment_end,
        ts.speaker_id,
        ts.speaker_name,
        ts.confidence,
        tsar.rank as score
      FROM transcript_segments ts
      JOIN session_recordings r ON r.id = ts.recording_id
      LEFT JOIN ts_rank_cd(
        to_tsvector('english', ts.text),
        plainto_tsquery('english', $1),
        32
      ) tsar ON true
      WHERE to_tsvector('english', ts.text) @@ plainto_tsquery('english', $1)
        AND r.searchable = true
    `;
    const params: unknown[] = [textQuery];
    let paramIndex = 2;

    if (sessionId) {
      query += ` AND r.session_id = $${paramIndex}`;
      params.push(sessionId);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND r.created_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND r.created_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ` ORDER BY tsar.rank DESC NULLS LAST, ts.start_seconds ASC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    return rows.map((row) => ({
      recordingId: row.recording_id,
      sessionId: row.session_id,
      matchText: row.match_text,
      matchContext: row.match_text,
      segmentStart: row.segment_start,
      segmentEnd: row.segment_end,
      score: parseFloat(row.score || "0"),
    }));
  },

  /**
   * Generate summary for a recording.
   */
  async generateSummary(recordingId: string): Promise<string> {
    const recording = await this.getRecording(recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`);
    }

    const query = `
      UPDATE session_recordings
      SET summary_status = 'processing', updated_at = NOW()
      WHERE id = $1
    `;
    await pool.query(query, [recordingId]);

    // Placeholder for AI summary generation
    // In production, this would call an LLM API
    const summary = `Session recording ${recordingId} summary placeholder`;

    const updateQuery = `
      UPDATE session_recordings
      SET summary_status = 'completed', summary = $1, updated_at = NOW()
      WHERE id = $2
    `;
    await pool.query(updateQuery, [summary, recordingId]);

    logger.info({ recordingId }, "Summary generated");

    return summary;
  },

  /**
   * Delete a recording and its associated data.
   */
  async deleteRecording(
    recordingId: string,
    userId: string,
  ): Promise<void> {
    const recording = await this.getRecording(recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${recordingId}`);
    }

    // Soft delete - mark as deleted but retain for compliance
    const query = `
      UPDATE session_recordings
      SET status = 'deleted', searchable = false, updated_at = NOW()
      WHERE id = $1
    `;
    await pool.query(query, [recordingId]);

    logger.info({ recordingId, userId }, "Recording deleted (soft)");
  },

  /**
   * Get recordings for a user (as mentor or participant).
   */
  async getUserRecordings(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<RecordingRecord[]> {
    const query = `
      SELECT r.*
      FROM session_recordings r
      JOIN bookings b ON b.id = r.session_id
      WHERE (r.mentor_id = $1 OR b.learner_id = $1)
        AND r.status != 'deleted'
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const { rows } = await pool.query(query, [userId, limit, offset]);
    return rows;
  },

  // ─── Private helpers ───────────────────────────────────────────────────────

  async getSession(
    sessionId: string,
  ): Promise<{ id: string; mentor_id: string; mentee_id: string } | null> {
    const query = `
      SELECT id, mentor_id, mentee_id FROM bookings WHERE id = $1
    `;
    const { rows } = await pool.query(query, [sessionId]);
    return rows[0] || null;
  },

  async getConsentStatus(
    sessionId: string,
    participantIds: string[],
  ): Promise<ConsentStatus> {
    const query = `
      SELECT consent_status
      FROM session_recordings
      WHERE session_id = $1 AND consent_status->>'required' = 'true'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(query, [sessionId]);

    if (rows.length > 0) {
      return rows[0].consent_status as ConsentStatus;
    }

    // Default: consent required for all participants
    return {
      required: true,
      participants: participantIds.map((id) => ({
        userId: id,
        consented: false,
        consentedAt: null,
        ipAddress: null,
        userAgent: null,
      })),
      allConsented: false,
    };
  },

  async storeTranscriptSegments(
    recordingId: string,
    segments: TranscriptSegment[],
  ): Promise<void> {
    const query = `
      INSERT INTO transcript_segments (recording_id, start_seconds, end_seconds, speaker_id, speaker_name, text, confidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    for (const segment of segments) {
      await pool.query(query, [
        recordingId,
        segment.startSeconds,
        segment.endSeconds,
        segment.speakerId,
        segment.speakerName,
        segment.text,
        segment.confidence,
      ]);
    }
  },
};
