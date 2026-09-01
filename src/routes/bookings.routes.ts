import { Router } from "express";
import { BookingsController } from "../controllers/bookings.controller";
import { CollaborationController } from "../controllers/collaboration.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { requireIdempotency } from "../middleware/idempotency.middleware";
import { validate } from "../middleware/validation.middleware";
import { createBookingSchema } from "../validators/schemas/bookings.schemas";
import {
  getMeetingLink,
  regenerateMeetingLink,
} from "../controllers/meetingLink.controller";
import {
  joinSession,
  getSessionPresence,
} from "../controllers/session-presence.controller";

const requireAdmin = requireRole("admin");
const router = Router();

/**
 * @swagger
 * tags:
 *   name: Bookings
 *   description: Session booking and meeting room management endpoints
 */

/**
 * @swagger
 * /api/v1/bookings:
 *   post:
 *     summary: Create a new booking
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Unique key to prevent duplicate bookings
 *     responses:
 *       201:
 *         description: Booking created
 */
router.post(
  "/",
  authenticate,
  requireIdempotency,
  validate(createBookingSchema),
  BookingsController.createBooking,
);
router.get("/:id/meeting-link", getMeetingLink);
router.post("/:id/meeting-link/regenerate", regenerateMeetingLink);
/**
 * @swagger
 * /api/v1/bookings:
 *   get:
 *     summary: List user's bookings
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: query
 *         name: upcoming
 *         schema:
 *           type: boolean
 *         description: Filter for upcoming sessions only
 *     responses:
 *       200:
 *         description: List of bookings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Session'
 */
router.get("/", authenticate, BookingsController.listBookings);

/**
 * @swagger
 * /api/v1/bookings/manual-intervention:
 *   get:
 *     summary: Get sessions requiring manual meeting setup (Admin only)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     responses:
 *       200:
 *         description: Sessions needing manual intervention
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Session'
 */
router.get(
  "/manual-intervention",
  authenticate,
  requireRole("admin"),
  BookingsController.getManualInterventionSessions,
);

/**
 * @swagger
 * /api/v1/bookings/{id}:
 *   get:
 *     summary: Get session details with meeting URL
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Session details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     session:
 *                       $ref: '#/components/schemas/Session'
 */
router.get("/:id", authenticate, BookingsController.getSession);

/**
 * @swagger
 * /api/v1/bookings/{id}/cancel:
 *   delete:
 *     summary: Cancel a booking
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *       400:
 *         description: Cannot cancel this session
 *       404:
 *         description: Session not found
 */
router.delete("/:id/cancel", authenticate, BookingsController.cancelBooking);

/**
 * @swagger
 * /api/v1/bookings/{id}/events:
 *   get:
 *     summary: Get booking domain event history (Admin only)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Event log for the booking aggregate in version order
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 */
router.get(
  "/:id/events",
  authenticate,
  requireAdmin,
  BookingsController.getBookingEvents,
);

/**
 * @swagger
 * /api/v1/bookings/{id}/confirm:
 *   post:
 *     summary: Confirm a booking and generate meeting URL
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Booking confirmed with meeting URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *                   example: Booking confirmed and meeting room created successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     session:
 *                       $ref: '#/components/schemas/Session'
 *       207:
 *         description: Booking confirmed but meeting URL failed (partial success)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *                   example: Booking confirmed but meeting URL could not be generated
 *                 data:
 *                   type: object
 *                   properties:
 *                     session:
 *                       $ref: '#/components/schemas/Session'
 *                     warning:
 *                       type: string
 *                       example: Meeting room creation failed. Manual intervention required.
 */
router.post(
  "/:id/confirm",
  authenticate,
  requireIdempotency,
  BookingsController.confirmBooking,
);

/**
 * @swagger
 * /api/v1/bookings/{id}/collaboration:
 *   get:
 *     summary: Get saved collaboration state for a booking session
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Collaboration state retrieved
 */
router.get(
  "/:id/collaboration",
  authenticate,
  CollaborationController.getCollaborationState,
);

/**
 * @swagger
 * /api/v1/bookings/{id}/collaboration:
 *   patch:
 *     summary: Update collaboration state for a booking session
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               whiteboardData:
 *                 type: object
 *               sharedCode:
 *                 type: object
 *               participants:
 *                 type: array
 *                 items:
 *                   type: object
 *               screenShare:
 *                 type: object
 *     responses:
 *       200:
 *         description: Collaboration state updated successfully
 */
router.patch(
  "/:id/collaboration",
  authenticate,
  CollaborationController.updateCollaborationState,
);

/**
 * @swagger
 * /api/v1/bookings/{id}/join:
 *   post:
 *     summary: Mark user as having joined the session
 *     description: Records join timestamp and prevents no-show detection. Called when user enters meeting room.
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session/Booking ID
 *     responses:
 *       200:
 *         description: Successfully joined session
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Successfully joined session
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessionId:
 *                       type: string
 *                       format: uuid
 *                     role:
 *                       type: string
 *                       enum: [mentor, mentee]
 *                     joinedAt:
 *                       type: string
 *                       format: date-time
 *                     isFirstJoin:
 *                       type: boolean
 *       403:
 *         description: Not a participant of this session
 *       404:
 *         description: Session not found
 */
router.post("/:id/join", authenticate, joinSession);

/**
 * @swagger
 * /api/v1/bookings/{id}/presence:
 *   get:
 *     summary: Get session presence information
 *     description: Shows join timestamps and current online status for both participants
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session/Booking ID
 *     responses:
 *       200:
 *         description: Session presence information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessionId:
 *                       type: string
 *                       format: uuid
 *                     mentor:
 *                       type: object
 *                       properties:
 *                         userId:
 *                           type: string
 *                           format: uuid
 *                         joinedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                         online:
 *                           type: boolean
 *                     mentee:
 *                       type: object
 *                       properties:
 *                         userId:
 *                           type: string
 *                           format: uuid
 *                         joinedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                         online:
 *                           type: boolean
 *       403:
 *         description: Not a participant of this session
 *       404:
 *         description: Session not found
 */
router.get("/:id/presence", authenticate, getSessionPresence);

/**
 * @swagger
 * /api/v1/bookings/{id}/no-show/dispute:
 *   post:
 *     summary: Dispute a recorded no-show within the dispute window
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Booking ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Dispute submitted
 *       400:
 *         description: Not eligible or dispute window closed
 *       403:
 *         description: Only the offender may dispute
 *       404:
 *         description: Booking not found
 */
router.post(
  "/:id/no-show/dispute",
  authenticate,
  BookingsController.disputeNoShow,
);

/**
 * @swagger
 * /api/v1/bookings/{id}/no-show/dispute/resolve:
 *   post:
 *     summary: Resolve a pending no-show dispute (admin only)
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Booking ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [approved, dismissed]
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Dispute resolved
 *       400:
 *         description: Booking not pending or invalid decision
 *       404:
 *         description: Booking not found
 */
router.post(
  "/:id/no-show/dispute/resolve",
  authenticate,
  requireAdmin,
  BookingsController.resolveNoShowDispute,
);

export default router;
