import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { RecommendationService } from "../services/recommendations.service";
import { ResponseUtil } from "../utils/response.utils";

export const RecommendationsController = {
  /**
   * GET /recommendations/mentors
   * Returns personalised mentor recommendations for the authenticated learner.
   * Fires impression events for each returned mentor (async, non-blocking).
   */
  async getMentors(req: AuthenticatedRequest, res: Response): Promise<void> {
    const learnerId = req.user!.userId;
    const limit = Math.min(parseInt(String(req.query.limit ?? "10"), 10), 50);

    const mentors = await RecommendationService.getRecommendedMentors(
      learnerId,
      limit,
    );

    // Track impressions asynchronously — don't block the response
    Promise.allSettled(
      mentors.map((m) =>
        RecommendationService.trackEvent(
          learnerId,
          m.id,
          "impression",
          m.score,
        ),
      ),
    ).catch(() => {
      /* swallow — tracking is best-effort */
    });

    ResponseUtil.success(
      res,
      mentors,
      "Recommendations retrieved successfully",
    );
  },

  /**
   * POST /recommendations/mentors/:mentorId/click
   * Records a click event for CTR tracking.
   */
  async trackClick(req: AuthenticatedRequest, res: Response): Promise<void> {
    const learnerId = req.user!.userId;
    const { mentorId } = req.params;

    await RecommendationService.trackEvent(learnerId, mentorId, "click");

    ResponseUtil.success(res, null, "Click tracked");
  },
};
