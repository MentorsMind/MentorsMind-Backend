import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { SessionFeedbackService } from "../services/session-feedback.service";

export const SessionFeedbackController = {
  async submit(req: AuthenticatedRequest, res: Response): Promise<void> {
    const menteeId = req.user!.userId;
    const feedback = await SessionFeedbackService.submit(menteeId, req.body);
    res.status(201).json({ success: true, data: feedback });
  },

  async getForSession(req: AuthenticatedRequest, res: Response): Promise<void> {
    const feedback = await SessionFeedbackService.getForSession(
      req.params.sessionId,
    );
    res.json({ success: true, data: feedback });
  },

  async getMentorFeedback(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const mentorId = req.params.mentorId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const result = await SessionFeedbackService.getMentorFeedback(
      mentorId,
      page,
      limit,
    );
    res.json({ success: true, data: result });
  },

  async getMentorStats(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const stats = await SessionFeedbackService.getMentorQualityStats(
      req.params.mentorId,
    );
    res.json({ success: true, data: stats });
  },
};
