import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { SessionQualityService, MentorQualityTier } from "../services/session-quality.service";
import { asyncHandler } from "../utils/asyncHandler.utils";

const VALID_TIERS: MentorQualityTier[] = [
  "excellent",
  "good",
  "needs_improvement",
  "at_risk",
];

export const MentorQualityController = {
  /**
   * GET /admin/mentors/quality
   * Paginated, sortable/filterable mentor quality scores with dimension breakdowns.
   */
  list: asyncHandler(
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const tierParam = req.query.tier as string | undefined;
      const tier = VALID_TIERS.includes(tierParam as MentorQualityTier)
        ? (tierParam as MentorQualityTier)
        : undefined;
      const sortBy = req.query.sortBy === "computed_at" ? "computed_at" : "score";
      const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

      const result = await SessionQualityService.getAdminQualityScores({
        page,
        limit,
        tier,
        sortBy,
        sortOrder,
      });

      res.json({ success: true, data: result });
    },
  ),
};
