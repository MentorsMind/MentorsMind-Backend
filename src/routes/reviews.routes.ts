import { Router, IRouter } from "express";
import { ReviewsController } from "../controllers/reviews.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/rbac.middleware";
import {
  validate,
  createReviewSchema,
  updateReviewSchema,
  flagReviewSchema,
  reviewIdParamSchema,
  mentorIdParamSchema,
  paginationQuerySchema,
} from "../validators/reviews.validator";

const router: IRouter = Router();

/**
 * @swagger
 * /reviews:
 *   post:
 *     summary: Create a review for a completed session
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [session_id, rating]
 *             properties:
 *               session_id: { type: string, format: uuid }
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string, maxLength: 2000 }
 *     responses:
 *       201:
 *         description: Review created
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Not authorized for this session
 *       409:
 *         description: Review already exists for this session
 *       422:
 *         description: Validation error
 */
router.post(
  "/",
  authenticate,
  validate(createReviewSchema),
  ReviewsController.createReview,
);

/**
 * @swagger
 * /reviews/mentor/{id}:
 *   get:
 *     summary: Get paginated reviews for a mentor
 *     tags: [Reviews]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Paginated list of reviews
 *       404:
 *         description: Mentor not found
 *       422:
 *         description: Validation error
 */
router.get(
  "/mentor/:id",
  validate(mentorIdParamSchema),
  validate(paginationQuerySchema),
  ReviewsController.getMentorReviews,
);

/**
 * @swagger
 * /reviews/{id}:
 *   put:
 *     summary: Update own review within the 48-hour edit window
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string, maxLength: 2000 }
 *     responses:
 *       200:
 *         description: Review updated
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Not the review owner or edit window expired
 *       404:
 *         description: Review not found
 *       422:
 *         description: Validation error
 */
router.put(
  "/:id",
  authenticate,
  validate(reviewIdParamSchema),
  validate(updateReviewSchema),
  ReviewsController.updateReview,
);

/**
 * @swagger
 * /reviews/{id}:
 *   delete:
 *     summary: Admin-only — permanently delete a review
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Review deleted
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin role required
 *       404:
 *         description: Review not found
 *       422:
 *         description: Validation error
 */
router.delete(
  "/:id",
  authenticate,
  requireAdmin,
  validate(reviewIdParamSchema),
  ReviewsController.deleteReview,
);

/**
 * @swagger
 * /reviews/{id}/helpful:
 *   post:
 *     summary: Mark a review as helpful
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Vote recorded
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Cannot vote on own review
 *       404:
 *         description: Review not found
 *       409:
 *         description: Already voted
 *       422:
 *         description: Validation error
 */
router.post(
  "/:id/helpful",
  authenticate,
  validate(reviewIdParamSchema),
  ReviewsController.markHelpful,
);

/**
 * @swagger
 * /reviews/{id}/flag:
 *   post:
 *     summary: Flag a review for moderation
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, minLength: 10 }
 *     responses:
 *       201:
 *         description: Review flagged
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Review not found
 *       409:
 *         description: Already flagged by this user
 *       422:
 *         description: Validation error
 */
router.post(
  "/:id/flag",
  authenticate,
  validate(reviewIdParamSchema),
  validate(flagReviewSchema),
  ReviewsController.flagReview,
);

export default router;
