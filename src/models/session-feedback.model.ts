import pool from "../config/database";

export interface SessionFeedback {
  id: string;
  session_id: string;
  mentor_id: string;
  mentee_id: string;
  rating_content: number;
  rating_communication: number;
  rating_preparation: number;
  rating_value: number;
  quality_score: number;
  sentiment: "positive" | "neutral" | "negative";
  comment: string | null;
  improvements: string[];
  would_recommend: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateFeedbackPayload {
  session_id: string;
  mentor_id: string;
  mentee_id: string;
  rating_content: number;
  rating_communication: number;
  rating_preparation: number;
  rating_value: number;
  comment?: string;
  improvements?: string[];
  would_recommend?: boolean;
}

function deriveSentiment(
  avgScore: number,
): "positive" | "neutral" | "negative" {
  if (avgScore >= 4) return "positive";
  if (avgScore >= 3) return "neutral";
  return "negative";
}

export const SessionFeedbackModel = {
  async create(payload: CreateFeedbackPayload): Promise<SessionFeedback> {
    const avg =
      (payload.rating_content +
        payload.rating_communication +
        payload.rating_preparation +
        payload.rating_value) /
      4;
    const sentiment = deriveSentiment(avg);

    const { rows } = await pool.query<SessionFeedback>(
      `INSERT INTO session_feedback
        (session_id, mentor_id, mentee_id, rating_content, rating_communication,
         rating_preparation, rating_value, sentiment, comment, improvements, would_recommend)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        payload.session_id,
        payload.mentor_id,
        payload.mentee_id,
        payload.rating_content,
        payload.rating_communication,
        payload.rating_preparation,
        payload.rating_value,
        sentiment,
        payload.comment ?? null,
        payload.improvements ?? [],
        payload.would_recommend ?? true,
      ],
    );
    return rows[0];
  },

  async findBySession(sessionId: string): Promise<SessionFeedback[]> {
    const { rows } = await pool.query<SessionFeedback>(
      "SELECT * FROM session_feedback WHERE session_id = $1",
      [sessionId],
    );
    return rows;
  },

  async findByMentor(
    mentorId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ feedback: SessionFeedback[]; total: number }> {
    const [data, count] = await Promise.all([
      pool.query<SessionFeedback>(
        "SELECT * FROM session_feedback WHERE mentor_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        [mentorId, limit, offset],
      ),
      pool.query<{ count: string }>(
        "SELECT COUNT(*) FROM session_feedback WHERE mentor_id = $1",
        [mentorId],
      ),
    ]);
    return { feedback: data.rows, total: parseInt(count.rows[0].count, 10) };
  },

  async getMentorQualityStats(mentorId: string): Promise<{
    avg_quality_score: number;
    total_feedback: number;
    positive_pct: number;
    negative_pct: number;
    recommend_pct: number;
  }> {
    const { rows } = await pool.query(
      `SELECT
         ROUND(AVG(quality_score)::NUMERIC, 2) AS avg_quality_score,
         COUNT(*) AS total_feedback,
         ROUND(100.0 * SUM(CASE WHEN sentiment='positive' THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS positive_pct,
         ROUND(100.0 * SUM(CASE WHEN sentiment='negative' THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS negative_pct,
         ROUND(100.0 * SUM(CASE WHEN would_recommend THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS recommend_pct
       FROM session_feedback WHERE mentor_id = $1`,
      [mentorId],
    );
    return rows[0];
  },
};
