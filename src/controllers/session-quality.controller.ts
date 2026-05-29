import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { SessionQualityService } from "../services/session-quality.service";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { logger } from "../utils/logger";

export const SessionQualityController = {
  /**
   * GET /session-quality/sessions/:sessionId
   * Compute and return quality score for a specific session.
   */
  getSessionScore: asyncHandler(
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const { sessionId } = req.params;

      const score = await SessionQualityService.computeSessionScore(sessionId);
      if (!score) {
        res.status(404).json({
          success: false,
          error: "No feedback found for this session",
        });
        return;
      }

      res.json({ success: true, data: score });
    },
  ),

  /**
   * GET /session-quality/mentors/:mentorId/trend
   * Get quality trend analysis for a mentor.
   */
  getMentorTrend: asyncHandler(
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const { mentorId } = req.params;
      const days = parseInt(req.query.days as string) || 90;

      const trend = await SessionQualityService.getMentorQualityTrend(
        mentorId,
        days,
      );
      res.json({ success: true, data: trend });
    },
  ),

  /**
   * GET /session-quality/mentors/:mentorId/insights
   * Get quality insights (strengths, weaknesses, opportunities) for a mentor.
   */
  getMentorInsights: asyncHandler(
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const { mentorId } = req.params;

      const insights =
        await SessionQualityService.getMentorInsights(mentorId);
      res.json({ success: true, data: insights });
    },
  ),

  /**
   * GET /session-quality/mentors/:mentorId/top-sessions
   * Get top-performing sessions for a mentor.
   */
  getTopSessions: asyncHandler(
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const { mentorId } = req.params;
      const limit = parseInt(req.query.limit as string) || 5;

      const sessions = await SessionQualityService.getTopSessions(
        mentorId,
        limit,
      );
      res.json({ success: true, data: sessions });
    },
  ),

  /**
   * GET /session-quality/platform/distribution
   * Get platform-wide quality distribution (admin only).
   */
  getPlatformDistribution: asyncHandler(
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const distribution =
        await SessionQualityService.getPlatformQualityDistribution();
      res.json({ success: true, data: distribution });
    },
  ),
};
