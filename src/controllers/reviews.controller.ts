import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { ReviewsService } from "../services/reviews.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";

export const ReviewsController = {
  /**
   * POST /api/v1/reviews
   * Create a new review for a completed session
   */
  createReview: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reviewerId = req.user!.id;
      const review = await ReviewsService.createReview(reviewerId, req.body);
      return ResponseUtil.created(res, review);
    },
  ),

  /**
   * GET /api/v1/reviews/mentor/:id
   * Get paginated reviews for a mentor
   */
  getMentorReviews: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const mentorId = req.params.id as string;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const data = await ReviewsService.getMentorReviews(mentorId, page, limit);
      return ResponseUtil.success(res, data);
    },
  ),

  /**
   * PUT /api/v1/reviews/:id
   * Update own review within the 48-hour edit window
   */
  updateReview: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reviewId = req.params.id as string;
      const reviewerId = req.user!.id;
      const review = await ReviewsService.updateReview(
        reviewId,
        reviewerId,
        req.body,
      );
      return ResponseUtil.success(res, review);
    },
  ),

  /**
   * DELETE /api/v1/reviews/:id
   * Admin-only: permanently delete a review
   */
  deleteReview: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reviewId = req.params.id as string;
      await ReviewsService.deleteReview(reviewId);
      return ResponseUtil.noContent(res);
    },
  ),

  /**
   * POST /api/v1/reviews/:id/helpful
   * Mark a review as helpful
   */
  markHelpful: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reviewId = req.params.id as string;
      const userId = req.user!.id;
      const data = await ReviewsService.markHelpful(reviewId, userId);
      return ResponseUtil.created(res, data);
    },
  ),

  /**
   * POST /api/v1/reviews/:id/flag
   * Flag a review for moderation
   */
  flagReview: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const reviewId = req.params.id as string;
    const userId = req.user!.id;
    const { reason } = req.body;
    const flag = await ReviewsService.flagReview(reviewId, userId, reason);
    return ResponseUtil.created(res, flag);
  }),

  /**
   * GET /api/v1/mentors/:id/rating-summary
   * Get aggregated rating summary for a mentor
   */
  getRatingSummary: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const mentorId = req.params.id as string;
      const summary = await ReviewsService.getRatingSummary(mentorId);
      return ResponseUtil.success(res, summary);
    },
  ),
};
