import { Router } from "express";
import { UsersController } from "../controllers/users.controller";
import { DataExportController } from "../controllers/dataExport.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireOwnerOrAdmin } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validation.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import {
  updateUserSchema,
  updateMeSchema,
  avatarUploadSchema,
} from '../validators/schemas/users.schemas';
import { idParamSchema } from '../validators/schemas/common.schemas';
import { RecommendationController } from '../controllers/recommendation.controller';

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/me", asyncHandler(UsersController.getMe));

/**
 * @swagger
 * /users/me:
 *   put:
 *     summary: Update current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserRequest'
 *           example:
 *             firstName: Jane
 *             lastName: Doe
 *             bio: Experienced software engineer with 10 years in the industry
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put(
  "/me",
  validate(updateMeSchema),
  asyncHandler(UsersController.updateMe),
);

router.delete("/me", asyncHandler(UsersController.requestAccountDeletion));
router.post(
  "/me/cancel-deletion",
  asyncHandler(UsersController.cancelAccountDeletion),
);

router.post(
  "/me/data-export",
  asyncHandler(DataExportController.requestExport),
);
router.get(
  "/me/data-export/status",
  asyncHandler(DataExportController.getExportStatus),
);

/**
 * @swagger
 * /users/avatar:
 *   post:
 *     summary: Upload user avatar (base64)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AvatarUploadRequest'
 *     responses:
 *       200:
 *         description: Avatar updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         avatarUrl:
 *                           type: string
 *                           format: uri
 *                           example: https://cdn.mentorminds.com/avatars/user-123.jpg
 *       400:
 *         description: Invalid image data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/avatar",
  validate(avatarUploadSchema),
  asyncHandler(UsersController.uploadAvatar),
);

/**
 * @swagger
 * /users/{id}/public:
 *   get:
 *     summary: Get public profile of a user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/schemas/UUIDParam'
 *     responses:
 *       200:
 *         description: Public user profile
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/PublicUser'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:id/public",
  validate(idParamSchema),
  asyncHandler(UsersController.getPublicUser),
);

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get user by ID (owner or admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/schemas/UUIDParam'
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       403:
 *         description: Forbidden — not the owner or admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:id",
  validate(idParamSchema),
  requireOwnerOrAdmin,
  asyncHandler(UsersController.getUser),
);

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Update user by ID (owner or admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/schemas/UUIDParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserRequest'
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put(
  "/:id",
  validate(updateUserSchema),
  requireOwnerOrAdmin,
  asyncHandler(UsersController.updateUser),
);

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Deactivate user by ID (owner or admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/schemas/UUIDParam'
 *     responses:
 *       204:
 *         description: User deactivated successfully
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete(
  "/:id",
  validate(idParamSchema),
  requireOwnerOrAdmin,
  asyncHandler(UsersController.deleteUser),
);

router.get(
  '/recommendations/mentors',
  asyncHandler(RecommendationController.getMentorRecommendations),
);

router.post(
  '/recommendations/dismiss/:mentorId',
  asyncHandler(RecommendationController.dismissMentor),
);

router.post(
  '/recommendations/click/:mentorId',
  asyncHandler(RecommendationController.logRecommendationClick),
);

export default router;
