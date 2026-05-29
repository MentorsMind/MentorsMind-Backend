import pool from "../config/database";
import {
  SessionFeedbackModel,
  CreateFeedbackPayload,
  SessionFeedback,
} from "../models/session-feedback.model";
import { createError } from "../middleware/errorHandler";

export const SessionFeedbackService = {
  async submit(
    menteeId: string,
    payload: Omit<CreateFeedbackPayload, "mentee_id">,
  ): Promise<SessionFeedback> {
    // Verify session exists and mentee participated
    const { rows } = await pool.query(
      `SELECT id, mentor_id, mentee_id, status FROM sessions WHERE id = $1`,
      [payload.session_id],
    );
    if (!rows.length) throw createError("Session not found", 404);

    const session = rows[0];
    if (session.mentee_id !== menteeId)
      throw createError("Not authorized for this session", 403);
    if (session.status !== "completed")
      throw createError(
        "Feedback can only be submitted for completed sessions",
        400,
      );

    return SessionFeedbackModel.create({
      ...payload,
      mentor_id: session.mentor_id,
      mentee_id: menteeId,
    });
  },

  async getForSession(sessionId: string): Promise<SessionFeedback[]> {
    return SessionFeedbackModel.findBySession(sessionId);
  },

  async getMentorFeedback(
    mentorId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    feedback: SessionFeedback[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;
    const result = await SessionFeedbackModel.findByMentor(
      mentorId,
      limit,
      offset,
    );
    return { ...result, page, limit };
  },

  async getMentorQualityStats(mentorId: string) {
    return SessionFeedbackModel.getMentorQualityStats(mentorId);
  },
};
