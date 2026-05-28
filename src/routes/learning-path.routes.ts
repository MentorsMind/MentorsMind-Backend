import { Router } from "express";
import { LearningPathController } from "../controllers/learning-path.controller";
import { ProgressController } from "../controllers/progress.controller";
import { authenticateToken } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import { body, param, query } from "express-validator";

const router = Router();

// Authentication middleware for all routes
router.use(authenticateToken);

// Validation middleware
const validatePathId = [
  param('pathId').isUUID().withMessage('Invalid path ID format')
];

const validateEnrollmentId = [
  param('enrollmentId').isUUID().withMessage('Invalid enrollment ID format')
];

const validateMilestoneId = [
  param('milestoneId').isUUID().withMessage('Invalid milestone ID format')
];

// Learning Path Management Routes

/**
 * @swagger
 * /api/v1/learning-paths:
 *   post:
 *     summary: Create a new learning path
 *     tags: [Learning Paths]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - estimatedDurationHours
 *               - difficultyLevel
 *               - milestones
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 255
 *               description:
 *                 type: string
 *               estimatedDurationHours:
 *                 type: integer
 *                 minimum: 1
 *               difficultyLevel:
 *                 type: string
 *                 enum: [beginner, intermediate, advanced, expert]
 *               totalPrice:
 *                 type: number
 *                 minimum: 0
 *               pricingModel:
 *                 type: string
 *                 enum: [total, milestone, subscription]
 *               currency:
 *                 type: string
 *                 default: XLM
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               milestones:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *     responses:
 *       201:
 *         description: Learning path created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.post('/', 
  [
    body('title').isLength({ min: 1, max: 255 }).withMessage('Title is required and must be less than 255 characters'),
    body('estimatedDurationHours').isInt({ min: 1 }).withMessage('Estimated duration must be at least 1 hour'),
    body('difficultyLevel').isIn(['beginner', 'intermediate', 'advanced', 'expert']).withMessage('Invalid difficulty level'),
    body('milestones').isArray({ min: 1 }).withMessage('At least one milestone is required'),
    validateRequest
  ],
  LearningPathController.createPath
);

/**
 * @swagger
 * /api/v1/learning-paths:
 *   get:
 *     summary: Get learning paths with optional filters
 *     tags: [Learning Paths]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: mentorId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by mentor ID
 *       - in: query
 *         name: difficultyLevel
 *         schema:
 *           type: string
 *           enum: [beginner, intermediate, advanced, expert]
 *         description: Filter by difficulty level
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated list of tags
 *       - in: query
 *         name: isPublished
 *         schema:
 *           type: boolean
 *         description: Filter by published status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Learning paths retrieved successfully
 */
router.get('/', LearningPathController.getPaths);

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}:
 *   get:
 *     summary: Get learning path by ID
 *     tags: [Learning Paths]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Learning path retrieved successfully
 *       404:
 *         description: Learning path not found
 */
router.get('/:pathId', validatePathId, validateRequest, LearningPathController.getPath);

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}:
 *   put:
 *     summary: Update learning path
 *     tags: [Learning Paths]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Learning path updated successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Learning path not found
 */
router.put('/:pathId', validatePathId, validateRequest, LearningPathController.updatePath);

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}:
 *   delete:
 *     summary: Delete learning path
 *     tags: [Learning Paths]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Learning path deleted successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Learning path not found
 */
router.delete('/:pathId', validatePathId, validateRequest, LearningPathController.deletePath);

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}/publish:
 *   post:
 *     summary: Publish learning path
 *     tags: [Learning Paths]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Learning path published successfully
 */
router.post('/:pathId/publish', validatePathId, validateRequest, LearningPathController.publishPath);

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}/publish:
 *   delete:
 *     summary: Unpublish learning path
 *     tags: [Learning Paths]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Learning path unpublished successfully
 */
router.delete('/:pathId/publish', validatePathId, validateRequest, LearningPathController.unpublishPath);

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}/clone:
 *   post:
 *     summary: Clone learning path from template
 *     tags: [Learning Paths]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       201:
 *         description: Learning path cloned successfully
 */
router.post('/:pathId/clone', validatePathId, validateRequest, LearningPathController.clonePath);

// Enrollment Routes

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}/enroll:
 *   post:
 *     summary: Enroll in learning path
 *     tags: [Enrollments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentMethod:
 *                 type: string
 *               promoCode:
 *                 type: string
 *     responses:
 *       201:
 *         description: Successfully enrolled in learning path
 */
router.post('/:pathId/enroll', validatePathId, validateRequest, LearningPathController.enrollInPath);

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}/enroll:
 *   delete:
 *     summary: Unenroll from learning path
 *     tags: [Enrollments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Successfully unenrolled from learning path
 */
router.delete('/:pathId/enroll', validatePathId, validateRequest, LearningPathController.unenrollFromPath);

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}/enrollments:
 *   get:
 *     summary: Get enrollments for learning path (mentor only)
 *     tags: [Enrollments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, paused, completed, cancelled]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Enrollments retrieved successfully
 */
router.get('/:pathId/enrollments', validatePathId, validateRequest, LearningPathController.getPathEnrollments);

/**
 * @swagger
 * /api/v1/enrollments:
 *   get:
 *     summary: Get user's enrollments
 *     tags: [Enrollments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, paused, completed, cancelled]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User enrollments retrieved successfully
 */
router.get('/enrollments', LearningPathController.getUserEnrollments);

// Progress Tracking Routes (will be implemented in progress.controller.ts)

/**
 * @swagger
 * /api/v1/enrollments/{enrollmentId}:
 *   get:
 *     summary: Get detailed enrollment with progress
 *     tags: [Progress]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: enrollmentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Enrollment details retrieved successfully
 */
// router.get('/enrollments/:enrollmentId', validateEnrollmentId, validateRequest, ProgressController.getEnrollmentDetails);

/**
 * @swagger
 * /api/v1/enrollments/{enrollmentId}/status:
 *   patch:
 *     summary: Update enrollment status
 *     tags: [Progress]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: enrollmentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, paused, completed, cancelled]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Enrollment status updated successfully
 */
// router.patch('/enrollments/:enrollmentId/status', validateEnrollmentId, validateRequest, ProgressController.updateEnrollmentStatus);

/**
 * @swagger
 * /api/v1/enrollments/{enrollmentId}/milestones/{milestoneId}/complete:
 *   post:
 *     summary: Mark milestone as completed
 *     tags: [Progress]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: enrollmentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: milestoneId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               completionData:
 *                 type: object
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Milestone completed successfully
 */
// router.post('/enrollments/:enrollmentId/milestones/:milestoneId/complete', 
//   [...validateEnrollmentId, ...validateMilestoneId, validateRequest], 
//   ProgressController.completeMilestone
// );

/**
 * @swagger
 * /api/v1/enrollments/{enrollmentId}/progress:
 *   get:
 *     summary: Get detailed progress information
 *     tags: [Progress]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: enrollmentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Progress information retrieved successfully
 */
// router.get('/enrollments/:enrollmentId/progress', validateEnrollmentId, validateRequest, ProgressController.getProgress);

export default router;