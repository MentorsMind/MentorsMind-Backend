import pool, { db } from "../config/database";
import { Logger } from "../utils/logger.utils";
import {
  AISummaryService,
  ActionItem,
  SessionSummary,
} from "../services/ai-summary.service";

export interface SessionSummaryRecord {
  id: string;
  booking_id: string;
  session_id: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  ai_provider: string | null;
  ai_model: string | null;
  ai_confidence: number | null;
  key_topics: string[];
  action_items: ActionItem[];
  learning_outcomes: string[];
  next_steps: string[];
  recommendations: string[];
  transcript_id: string | null;
  source_text: string | null;
  word_count: number | null;
  processing_time_ms: number | null;
  error_message: string | null;
  tokens_used: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSessionSummaryPayload {
  bookingId: string;
  sessionId?: string;
  transcriptId?: string;
  transcriptText?: string;
  sessionNotes?: string;
  sessionTitle?: string;
}

/**
 * Session Summary Model - Database operations for AI-generated session summaries
 */
export const SessionSummaryModel = {
  /**
   * Create a new session summary record (pending status)
   */
  async create(
    payload: CreateSessionSummaryPayload,
  ): Promise<SessionSummaryRecord> {
    const {
      bookingId,
      sessionId,
      transcriptId,
      transcriptText,
      sessionNotes,
      sessionTitle,
    } = payload;

    // Combine transcript, title, and notes for source text
    const sourceText = [sessionTitle, transcriptText, sessionNotes]
      .filter(Boolean)
      .join("\n\n");
    const wordCount = sourceText ? sourceText.split(/\s+/).length : 0;

    const query = `
      INSERT INTO session_summaries (
        booking_id, session_id, transcript_id, source_text, word_count, status
      )
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `;

    const { rows } = await db.query(query, [
      bookingId,
      sessionId || null,
      transcriptId || null,
      sourceText || null,
      wordCount,
    ]);

    return rows[0];
  },

  /**
   * Find session summary by booking ID
   */
  async findByBookingId(
    bookingId: string,
  ): Promise<SessionSummaryRecord | null> {
    const query = "SELECT * FROM session_summaries WHERE booking_id = $1";
    const { rows } = await pool.query<SessionSummaryRecord>(query, [bookingId]);
    return rows[0] ?? null;
  },

  /**
   * Find session summary by session ID
   */
  async findBySessionId(
    sessionId: string,
  ): Promise<SessionSummaryRecord | null> {
    const query = "SELECT * FROM session_summaries WHERE session_id = $1";
    const { rows } = await pool.query<SessionSummaryRecord>(query, [sessionId]);
    return rows[0] ?? null;
  },

  /**
   * Find session summary by ID
   */
  async findById(id: string): Promise<SessionSummaryRecord | null> {
    const query = "SELECT * FROM session_summaries WHERE id = $1";
    const { rows } = await pool.query<SessionSummaryRecord>(query, [id]);
    return rows[0] ?? null;
  },

  /**
   * Update summary status to processing
   */
  async updateStatusToProcessing(
    id: string,
  ): Promise<SessionSummaryRecord | null> {
    const query = `
      UPDATE session_summaries
      SET status = 'processing', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await db.query(query, [id]);
    return rows[0] ?? null;
  },

  /**
   * Update summary with AI-generated content
   */
  async updateWithAIResult(
    id: string,
    result: {
      summary: SessionSummary;
      provider: "openai" | "anthropic";
      model: string;
      tokensUsed: number;
      processingTimeMs: number;
    },
  ): Promise<SessionSummaryRecord | null> {
    const query = `
      UPDATE session_summaries
      SET
        status = 'completed',
        ai_provider = $1,
        ai_model = $2,
        ai_confidence = $3,
        key_topics = $4,
        action_items = $5,
        learning_outcomes = $6,
        next_steps = $7,
        tokens_used = $8,
        processing_time_ms = $9,
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `;

    const { rows } = await db.query(query, [
      result.provider,
      result.model,
      result.summary.aiConfidence,
      JSON.stringify(result.summary.keyTopics),
      JSON.stringify(result.summary.actionItems),
      JSON.stringify(result.summary.learningOutcomes),
      JSON.stringify(result.summary.nextSteps),
      result.tokensUsed,
      result.processingTimeMs,
      id,
    ]);

    return rows[0] ?? null;
  },

  /**
   * Update summary with recommendations
   */
  async updateRecommendations(
    id: string,
    recommendations: string[],
  ): Promise<SessionSummaryRecord | null> {
    const query = `
      UPDATE session_summaries
      SET
        recommendations = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const { rows } = await db.query(query, [
      JSON.stringify(recommendations),
      id,
    ]);

    return rows[0] ?? null;
  },

  /**
   * Mark summary as failed with error message
   */
  async markAsFailed(
    id: string,
    errorMessage: string,
  ): Promise<SessionSummaryRecord | null> {
    const query = `
      UPDATE session_summaries
      SET
        status = 'failed',
        error_message = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const { rows } = await db.query(query, [errorMessage, id]);
    return rows[0] ?? null;
  },

  /**
   * Delete a session summary
   */
  async delete(id: string): Promise<boolean> {
    const query = "DELETE FROM session_summaries WHERE id = $1 RETURNING id";
    const { rowCount } = await pool.query(query, [id]);
    return (rowCount ?? 0) > 0;
  },

  /**
   * Find all pending summaries (for background processing)
   */
  async findPending(): Promise<SessionSummaryRecord[]> {
    const query = `
      SELECT * FROM session_summaries
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 10
    `;
    const { rows } = await pool.query<SessionSummaryRecord>(query);
    return rows;
  },

  /**
   * Find summaries by user ID (via bookings)
   */
  async findByUserId(userId: string): Promise<SessionSummaryRecord[]> {
    const query = `
      SELECT ss.* FROM session_summaries ss
      JOIN bookings b ON ss.booking_id = b.id
      WHERE b.mentor_id = $1 OR b.mentee_id = $1
      ORDER BY ss.created_at DESC
    `;
    const { rows } = await pool.query<SessionSummaryRecord>(query, [userId]);
    return rows;
  },

  /**
   * Generate summary for a booking and store in database
   */
  async generateAndStore(
    payload: CreateSessionSummaryPayload,
  ): Promise<SessionSummaryRecord> {
    // Create pending record
    const summaryRecord = await this.create(payload);

    try {
      // Update status to processing
      await this.updateStatusToProcessing(summaryRecord.id);

      // Generate summary using AI service
      const startTime = Date.now();
      const result = await AISummaryService.generateSummary(payload);
      const processingTimeMs = Date.now() - startTime;

      // Update with AI result
      const updated = await this.updateWithAIResult(summaryRecord.id, {
        ...result,
        processingTimeMs,
      });

      if (!updated) {
        throw new Error("Failed to update summary with AI result");
      }

      // Generate recommendations
      try {
        const recommendations = await AISummaryService.generateRecommendations(
          result.summary,
        );
        await this.updateRecommendations(summaryRecord.id, recommendations);
      } catch (recError) {
        logger.warn("SessionSummaryModel: Failed to generate recommendations", {
          error: recError,
          summaryId: summaryRecord.id,
        });
        // Don't fail the whole process if recommendations fail
      }

      logger.info("SessionSummaryModel: Summary generated successfully", {
        summaryId: summaryRecord.id,
        bookingId: payload.bookingId,
        provider: result.provider,
        tokensUsed: result.tokensUsed,
      });

      return updated;
    } catch (error) {
      logger.error("SessionSummaryModel: Failed to generate summary", {
        error,
        summaryId: summaryRecord.id,
        bookingId: payload.bookingId,
      });

      // Mark as failed
      await this.markAsFailed(
        summaryRecord.id,
        error instanceof Error ? error.message : "Unknown error",
      );

      throw error;
    }
  },
};

export default SessionSummaryModel;

