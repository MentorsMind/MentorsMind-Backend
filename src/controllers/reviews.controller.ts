import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { ReviewsService } from "../services/reviews.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { getMentorReviewsQuerySchema } from "../validators/reviews.validator";

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
   * Query params:
   *   - cursor: optional UUID for cursor-based pagination
   *   - page: optional positive integer (default: 1)
   *   - limit: optional 1-100 (default: 20, capped at 100)
   */
  getMentorReviews: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const mentorId = req.params.id as string;

      // Validate query parameters
      const validation = await getMentorReviewsQuerySchema.safeParseAsync({
        query: req.query,
      });

      if (!validation.success) {
        const errors = validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        }));
        return ResponseUtil.validationError(res, errors);
      }

      const { cursor, page, limit } = validation.data.query;

      // Cap limit at 100 as per requirement
      const cappedLimit = Math.min(limit, 100);

      const result = await ReviewsService.getMentorReviews(mentorId, {
        page,
        limit: cappedLimit,
        cursor,
      });

      // Build pagination metadata
      const meta = {
        page: result.pagination.page,
        limit: cappedLimit,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
        hasNext: result.pagination.hasNext,
        hasPrev: result.pagination.hasPrev,
        cursor: result.next_cursor || undefined,
      };

      return ResponseUtil.success(res, result.reviews, undefined, 200, meta);
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
   * POST /api/v1/reviews/:id/response
   * Create or replace a mentor response for a review
   */
  createMentorResponse: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reviewId = req.params.id as string;
      const mentorId = req.user!.id;
      const { response_text } = req.body;
      const response = await ReviewsService.createMentorResponse(
        reviewId,
        mentorId,
        response_text,
      );
      return ResponseUtil.created(res, response);
    },
  ),

  /**
   * PUT /api/v1/reviews/:id/response
   * Update the mentor response for a review
   */
  updateMentorResponse: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reviewId = req.params.id as string;
      const mentorId = req.user!.id;
      const { response_text } = req.body;
      const response = await ReviewsService.createMentorResponse(
        reviewId,
        mentorId,
        response_text,
      );
      return ResponseUtil.success(res, response);
    },
  ),

  /**
   * DELETE /api/v1/reviews/:id/response
   * Delete a mentor response from a review
   */
  deleteMentorResponse: asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reviewId = req.params.id as string;
      const mentorId = req.user!.id;
      await ReviewsService.deleteMentorResponse(reviewId, mentorId);
      return ResponseUtil.noContent(res);
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
