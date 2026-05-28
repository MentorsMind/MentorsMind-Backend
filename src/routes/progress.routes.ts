import { Router } from "express";
import { ProgressController } from "../controllers/progress.controller";
import { authenticateToken } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import { body, param } from "express-validator";

const router = Router();

// Authentication middleware for all routes
router.use(authenticateToken);

// Validation middleware
const validateEnrollmentId = [
  param('enrollmentId').isUUID().withMessage('Invalid enrollment ID format')
];

const validateMilestoneId = [
  param('milestoneId').isUUID().withMessage('Invalid milestone ID format')
];

const validatePathId = [
  param('pathId').isUUID().withMessage('Invalid path ID format')
];

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
 *         description: Enrollment ID
 *     responses:
 *       200:
 *         description: Enrollment details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     enrollment:
 *                       $ref: '#/components/schemas/PathEnrollment'
 *                     milestoneProgress:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/MilestoneProgress'
 *                     currentMilestone:
 *                       $ref: '#/components/schemas/Milestone'
 *                     nextMilestone:
 *                       $ref: '#/components/schemas/Milestone'
 *                     completedMilestones:
 *                       type: integer
 *                     totalMilestones:
 *                       type: integer
 *                     estimatedTimeRemaining:
 *                       type: integer
 *                     achievements:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Achievement'
 *       403:
 *         description: Access denied
 *       404:
 *         description: Enrollment not found
 */
router.get('/enrollments/:enrollmentId', 
  validateEnrollmentId, 
  validateRequest, 
  ProgressController.getEnrollmentDetails
);

/**
 * @swagger
 * /api/v1/enrollments/{enrollmentId}/status:
 *   patch:
 *     summary: Update enrollment status (pause/resume/cancel)
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
 *         description: Enrollment ID
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
 *                 description: New enrollment status
 *               reason:
 *                 type: string
 *                 description: Reason for status change (optional)
 *     responses:
 *       200:
 *         description: Enrollment status updated successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Access denied
 *       404:
 *         description: Enrollment not found
 */
router.patch('/enrollments/:enrollmentId/status', 
  [
    ...validateEnrollmentId,
    body('status').isIn(['active', 'paused', 'completed', 'cancelled']).withMessage('Invalid status'),
    body('reason').optional().isString().withMessage('Reason must be a string'),
    validateRequest
  ], 
  ProgressController.updateEnrollmentStatus
);

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
 *         description: Enrollment ID
 *       - in: path
 *         name: milestoneId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Milestone ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               completionData:
 *                 type: object
 *                 description: Additional data about the completion
 *               notes:
 *                 type: string
 *                 description: Optional notes about the completion
 *     responses:
 *       200:
 *         description: Milestone completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     milestoneId:
 *                       type: string
 *                     enrollmentId:
 *                       type: string
 *                     completedAt:
 *                       type: string
 *                       format: date-time
 *                     certificateGenerated:
 *                       type: boolean
 *                     nextMilestone:
 *                       $ref: '#/components/schemas/Milestone'
 *                     pathCompleted:
 *                       type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Prerequisites not met or validation error
 *       403:
 *         description: Access denied
 *       404:
 *         description: Enrollment or milestone not found
 */
router.post('/enrollments/:enrollmentId/milestones/:milestoneId/complete', 
  [
    ...validateEnrollmentId,
    ...validateMilestoneId,
    body('completionData').optional().isObject().withMessage('Completion data must be an object'),
    body('notes').optional().isString().withMessage('Notes must be a string'),
    validateRequest
  ], 
  ProgressController.completeMilestone
);

/**
 * @swagger
 * /api/v1/enrollments/{enrollmentId}/milestones/{milestoneId}/progress:
 *   patch:
 *     summary: Update milestone progress
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
 *         description: Enrollment ID
 *       - in: path
 *         name: milestoneId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Milestone ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - progress
 *             properties:
 *               progress:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Progress percentage (0-100)
 *               timeSpentMinutes:
 *                 type: integer
 *                 minimum: 0
 *                 description: Additional time spent in minutes
 *     responses:
 *       200:
 *         description: Progress updated successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Access denied
 *       404:
 *         description: Enrollment or milestone not found
 */
router.patch('/enrollments/:enrollmentId/milestones/:milestoneId/progress', 
  [
    ...validateEnrollmentId,
    ...validateMilestoneId,
    body('progress').isFloat({ min: 0, max: 100 }).withMessage('Progress must be between 0 and 100'),
    body('timeSpentMinutes').optional().isInt({ min: 0 }).withMessage('Time spent must be a positive integer'),
    validateRequest
  ], 
  ProgressController.updateMilestoneProgress
);

/**
 * @swagger
 * /api/v1/enrollments/{enrollmentId}/progress:
 *   get:
 *     summary: Get detailed progress information with insights
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
 *         description: Enrollment ID
 *     responses:
 *       200:
 *         description: Progress information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     enrollment:
 *                       $ref: '#/components/schemas/PathEnrollment'
 *                     milestoneProgress:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/MilestoneProgress'
 *                     insights:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                             enum: [warning, success, info]
 *                           title:
 *                             type: string
 *                           description:
 *                             type: string
 *                           actionable:
 *                             type: boolean
 *       403:
 *         description: Access denied
 *       404:
 *         description: Enrollment not found
 */
router.get('/enrollments/:enrollmentId/progress', 
  validateEnrollmentId, 
  validateRequest, 
  ProgressController.getProgress
);

/**
 * @swagger
 * /api/v1/learning-paths/{pathId}/analytics:
 *   get:
 *     summary: Get learning path analytics (mentor only)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pathId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Learning path ID
 *     responses:
 *       200:
 *         description: Analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     pathId:
 *                       type: string
 *                     totalEnrollments:
 *                       type: integer
 *                     activeStudents:
 *                       type: integer
 *                     completionRate:
 *                       type: number
 *                     averageCompletionTime:
 *                       type: number
 *                     dropoutRate:
 *                       type: number
 *                     revenueGenerated:
 *                       type: number
 *                     studentSatisfaction:
 *                       type: number
 *                     milestoneAnalytics:
 *                       type: array
 *                       items:
 *                         type: object
 *       403:
 *         description: Access denied
 *       404:
 *         description: Learning path not found
 */
router.get('/learning-paths/:pathId/analytics', 
  validatePathId, 
  validateRequest, 
  ProgressController.getPathAnalytics
);

/**
 * @swagger
 * /api/v1/analytics/student-dashboard:
 *   get:
 *     summary: Get student dashboard data
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalEnrollments:
 *                       type: integer
 *                     activeEnrollments:
 *                       type: integer
 *                     completedPaths:
 *                       type: integer
 *                     totalMilestonesCompleted:
 *                       type: integer
 *                     totalTimeSpent:
 *                       type: integer
 *                     currentStreak:
 *                       type: integer
 *                     achievements:
 *                       type: array
 *                     recentActivity:
 *                       type: array
 *                     upcomingMilestones:
 *                       type: array
 */
router.get('/analytics/student-dashboard', ProgressController.getStudentDashboard);

/**
 * @swagger
 * /api/v1/analytics/mentor-dashboard:
 *   get:
 *     summary: Get mentor dashboard data
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Mentor dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalPaths:
 *                       type: integer
 *                     publishedPaths:
 *                       type: integer
 *                     totalEnrollments:
 *                       type: integer
 *                     activeStudents:
 *                       type: integer
 *                     completionRate:
 *                       type: number
 *                     totalRevenue:
 *                       type: number
 *                     averageRating:
 *                       type: number
 *                     recentEnrollments:
 *                       type: array
 *                     topPerformingPaths:
 *                       type: array
 *                     studentProgress:
 *                       type: array
 */
router.get('/analytics/mentor-dashboard', ProgressController.getMentorDashboard);

export default router;