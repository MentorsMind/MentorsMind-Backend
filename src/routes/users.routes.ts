import { Router } from "express";
import multer from "multer";
import { UsersController } from "../controllers/users.controller";
import { DataExportController } from "../controllers/dataExport.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireOwnerOrAdmin } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validation.middleware";
import { screenBio } from "../middleware/content-moderation.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import {
  updateUserSchema,
  updateMeSchema,
} from "../validators/schemas/users.schemas";
import { idParamSchema } from "../validators/schemas/common.schemas";
import { RecommendationController } from "../controllers/recommendation.controller";
import { MAX_AVATAR_SIZE_BYTES } from "../services/upload.service";
import { createImageUploadMiddleware } from "../middleware/image-upload.middleware";
import { noCacheMiddleware } from "../middleware/no-cache.middleware";

// ---------------------------------------------------------------------------
// Multer — in-memory storage for avatar uploads
// 5 MB hard limit enforced here (UploadService also validates for defence-in-depth)
// ---------------------------------------------------------------------------
const avatarUpload = createImageUploadMiddleware(MAX_AVATAR_SIZE_BYTES, [
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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
router.get("/me", noCacheMiddleware, asyncHandler(UsersController.getMe));

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
  screenBio,
  asyncHandler(UsersController.updateMe),
);

router.delete("/me", asyncHandler(UsersController.requestAccountDeletion));
router.post(
  "/me/delete-request",
  asyncHandler(UsersController.requestAccountDeletion),
);
router.post(
  "/me/cancel-deletion",
  asyncHandler(UsersController.cancelAccountDeletion),
);

/**
 * @swagger
 * /users/me/language:
 *   get:
 *     summary: Get current user's language preference
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Language preference retrieved
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
 *                         language:
 *                           type: string
 *                           example: en
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/me/language",
  asyncHandler(UsersController.getLanguage),
);

/**
 * @swagger
 * /users/me/language:
 *   put:
 *     summary: Update current user's language preference
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - language
 *             properties:
 *               language:
 *                 type: string
 *                 enum: [en, es, fr, de, zh, ja]
 *                 example: es
 *     responses:
 *       200:
 *         description: Language preference updated
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
 *                         language:
 *                           type: string
 *                           example: es
 *       400:
 *         description: Invalid language
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/me/language",
  asyncHandler(UsersController.updateLanguage),
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
 *     summary: Upload user avatar (multipart/form-data)
 *     description: |
 *       Upload an image file as the authenticated user's avatar.
 *       The image is resized to 256×256 JPEG before being stored on S3.
 *       Only image/jpeg, image/png, and image/webp are accepted.
 *       Maximum file size is 5 MB.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - avatar
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *                 description: Image file (JPEG, PNG, or WebP). Max 5 MB.
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
 *                           example: https://cdn.mentorminds.com/avatars/user-123/1720000000000.jpg
 *       400:
 *         description: No file provided
 *       401:
 *         description: Unauthorized
 *       413:
 *         description: File exceeds 5 MB limit
 *       415:
 *         description: Unsupported media type (only JPEG, PNG, WebP allowed)
 */
router.post(
  "/avatar",
  avatarUpload.single('avatar'),
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
  "/recommendations/mentors",
  asyncHandler(RecommendationController.getMentorRecommendations),
);

router.post(
  "/recommendations/dismiss/:mentorId",
  asyncHandler(RecommendationController.dismissMentor),
);

router.post(
  "/recommendations/click/:mentorId",
  asyncHandler(RecommendationController.logRecommendationClick),
);

export default router;
