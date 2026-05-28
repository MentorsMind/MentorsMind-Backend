import { Router } from "express";
import { SessionMilestoneController } from "../controllers/session-milestone.controller";
import { authenticateToken } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import { rateLimitMiddleware } from "../middleware/rateLimit";

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Apply rate limiting
router.use(rateLimitMiddleware);

/**
 * @swagger
 * components:
 *   schemas:
 *     SessionMilestoneMapping:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         milestoneId:
 *           type: string
 *           format: uuid
 *         bookingId:
 *           type: string
 *           format: uuid
 *         sessionType:
 *           type: string
 *           enum: [milestone, support, assessment]
 *         contributesToCompletion:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *     
 *     SessionContext:
 *       type: object
 *       properties:
 *         milestoneId:
 *           type: string
 *           format: uuid
 *         milestoneTitle:
 *           type: string
 *         learningObjectives:
 *           type: array
 *           items:
 *             type: string
 *         completionCriteria:
 *           type: object
 *         currentProgress:
 *           type: number
 *         prerequisitesMet:
 *           type: boolean
 *         sessionType:
 *           type: string
 *           enum: [milestone, support, assessment]
 *     
 *     AvailableSession:
 *       type: object
 *       properties:
 *         sessionType:
 *           type: string
 *           enum: [milestone, support, assessment]
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         estimatedDuration:
 *           type: number
 *         isRecommended:
 *           type: boolean
 *         prerequisitesMet:
 *           type: boolean
 *     
 *     SessionOutcome:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         bookingId:
 *           type: string
 *           format: uuid
 *         milestoneId:
 *           type: string
 *           format: uuid
 *         mentorFeedback:
 *           type: string
 *         studentFeedback:
 *           type: string
 *         objectivesAchieved:
 *           type: array
 *           items:
 *             type: string
 *         skillsImproved:
 *           type: array
 *           items:
 *             type: string
 *         nextSteps:
 *           type: array
 *           items:
 *             type: string
 *         progressContribution:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *         completionStatus:
 *           type: string
 *           enum: [not_started, in_progress, completed, needs_review]
 *         sessionEffectiveness:
 *           type: number
 *           minimum: 1
 *           maximum: 5
 *         recommendedFollowUp:
 *           type: string
 *           enum: [continue, assessment, support, complete]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/v1/sessions/{bookingId}/milestone:
 *   post:
 *     summary: Link a session to a milestone
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: bookingId
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
 *               - milestoneId
 *             properties:
 *               milestoneId:
 *                 type: string
 *                 format: uuid
 *               sessionType:
 *                 type: string
 *                 enum: [milestone, support, assessment]
 *                 default: milestone
 *               contributesToCompletion:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Session linked to milestone successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SessionMilestoneMapping'
 *       400:
 *         description: Invalid request data
 *       403:
 *         description: Access denied
 *       404:
 *         description: Session or milestone not found
 *       409:
 *         description: Session already linked to a milestone
 */
router.post("/sessions/:bookingId/milestone", SessionMilestoneController.linkSessionToMilestone);

/**
 * @swagger
 * /api/v1/sessions/{bookingId}/milestone:
 *   delete:
 *     summary: Unlink a session from milestone
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session unlinked successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Session not linked to any milestone
 */
router.delete("/sessions/:bookingId/milestone", SessionMilestoneController.unlinkSessionFromMilestone);

/**
 * @swagger
 * /api/v1/sessions/{bookingId}/milestone:
 *   patch:
 *     summary: Update session mapping
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: bookingId
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
 *             properties:
 *               sessionType:
 *                 type: string
 *                 enum: [milestone, support, assessment]
 *               contributesToCompletion:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Session mapping updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SessionMilestoneMapping'
 */
router.patch("/sessions/:bookingId/milestone", SessionMilestoneController.updateSessionMapping);

/**
 * @swagger
 * /api/v1/sessions/{bookingId}/context:
 *   get:
 *     summary: Get session context (milestone information)
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session context retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SessionContext'
 */
router.get("/sessions/:bookingId/context", SessionMilestoneController.getSessionContext);

/**
 * @swagger
 * /api/v1/milestones/{milestoneId}/sessions/available:
 *   get:
 *     summary: Get available sessions for a milestone
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: milestoneId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Available sessions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AvailableSession'
 */
router.get("/milestones/:milestoneId/sessions/available", SessionMilestoneController.getAvailableSessionsForMilestone);

/**
 * @swagger
 * /api/v1/milestones/{milestoneId}/sessions:
 *   get:
 *     summary: Get sessions linked to a milestone
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: milestoneId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Milestone sessions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/SessionMilestoneMapping'
 *                       - type: object
 *                         properties:
 *                           booking:
 *                             type: object
 */
router.get("/milestones/:milestoneId/sessions", SessionMilestoneController.getSessionsForMilestone);

/**
 * @swagger
 * /api/v1/bookings/contextual:
 *   post:
 *     summary: Create contextual booking with learning path integration
 *     tags: [Session-Milestone Integration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - menteeId
 *               - mentorId
 *               - scheduledAt
 *               - durationMinutes
 *               - topic
 *             properties:
 *               menteeId:
 *                 type: string
 *                 format: uuid
 *               mentorId:
 *                 type: string
 *                 format: uuid
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *               durationMinutes:
 *                 type: number
 *                 minimum: 15
 *                 maximum: 240
 *               topic:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 500
 *               notes:
 *                 type: string
 *               milestoneId:
 *                 type: string
 *                 format: uuid
 *               sessionType:
 *                 type: string
 *                 enum: [milestone, support, assessment]
 *               contributesToCompletion:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Contextual booking created successfully
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
 *                     booking:
 *                       type: object
 *                     milestoneMapping:
 *                       $ref: '#/components/schemas/SessionMilestoneMapping'
 *                     isLearningPathIntegrated:
 *                       type: boolean
 */
router.post("/bookings/contextual", SessionMilestoneController.createContextualBooking);

/**
 * @swagger
 * /api/v1/bookings/context/{mentorId}/{studentId}:
 *   get:
 *     summary: Get learning path context for booking
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Learning path context retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get("/bookings/context/:mentorId/:studentId", SessionMilestoneController.getLearningPathContext);

/**
 * @swagger
 * /api/v1/bookings/recommendations/{mentorId}/{studentId}:
 *   get:
 *     summary: Get booking recommendations
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Booking recommendations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get("/bookings/recommendations/:mentorId/:studentId", SessionMilestoneController.getBookingRecommendations);

/**
 * @swagger
 * /api/v1/bookings/options/{mentorId}/{studentId}:
 *   get:
 *     summary: Get booking options for mentor-student pair
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Booking options retrieved successfully
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
 *                     individualSessionsAvailable:
 *                       type: boolean
 *                     learningPathsAvailable:
 *                       type: boolean
 *                     learningPathContexts:
 *                       type: array
 *                     recommendations:
 *                       type: array
 */
router.get("/bookings/options/:mentorId/:studentId", SessionMilestoneController.getBookingOptions);

/**
 * @swagger
 * /api/v1/sessions/{bookingId}/outcome:
 *   post:
 *     summary: Create session outcome
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: bookingId
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
 *             properties:
 *               mentorFeedback:
 *                 type: string
 *               studentFeedback:
 *                 type: string
 *               objectivesAchieved:
 *                 type: array
 *                 items:
 *                   type: string
 *               skillsImproved:
 *                 type: array
 *                 items:
 *                   type: string
 *               nextSteps:
 *                 type: array
 *                 items:
 *                   type: string
 *               progressContribution:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *               completionStatus:
 *                 type: string
 *                 enum: [not_started, in_progress, completed, needs_review]
 *               sessionEffectiveness:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 5
 *               recommendedFollowUp:
 *                 type: string
 *                 enum: [continue, assessment, support, complete]
 *     responses:
 *       201:
 *         description: Session outcome created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SessionOutcome'
 */
router.post("/sessions/:bookingId/outcome", SessionMilestoneController.createSessionOutcome);

/**
 * @swagger
 * /api/v1/sessions/{bookingId}/outcome:
 *   get:
 *     summary: Get session outcome
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session outcome retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SessionOutcome'
 */
router.get("/sessions/:bookingId/outcome", SessionMilestoneController.getSessionOutcome);

/**
 * @swagger
 * /api/v1/sessions/{bookingId}/impact:
 *   get:
 *     summary: Analyze session impact on milestone progress
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session impact analysis retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 */
router.get("/sessions/:bookingId/impact", SessionMilestoneController.analyzeSessionImpact);

/**
 * @swagger
 * /api/v1/mentors/{mentorId}/hybrid-config:
 *   get:
 *     summary: Get hybrid mode configuration
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Hybrid mode configuration retrieved successfully
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
 *                     mentorId:
 *                       type: string
 *                       format: uuid
 *                     learningPathsEnabled:
 *                       type: boolean
 *                     individualSessionsEnabled:
 *                       type: boolean
 *                     autoLinkSessions:
 *                       type: boolean
 *                     defaultSessionType:
 *                       type: string
 *                       enum: [milestone, support, assessment]
 */
router.get("/mentors/:mentorId/hybrid-config", SessionMilestoneController.getHybridModeConfig);

/**
 * @swagger
 * /api/v1/mentors/{mentorId}/hybrid-config:
 *   patch:
 *     summary: Update hybrid mode configuration
 *     tags: [Session-Milestone Integration]
 *     parameters:
 *       - in: path
 *         name: mentorId
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
 *             properties:
 *               learningPathsEnabled:
 *                 type: boolean
 *               individualSessionsEnabled:
 *                 type: boolean
 *               autoLinkSessions:
 *                 type: boolean
 *               defaultSessionType:
 *                 type: string
 *                 enum: [milestone, support, assessment]
 *     responses:
 *       200:
 *         description: Hybrid mode configuration updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 */
router.patch("/mentors/:mentorId/hybrid-config", SessionMilestoneController.updateHybridModeConfig);

export default router;