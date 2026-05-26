import { Router } from "express";
import { BookingsController } from "../controllers/bookings.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { idempotency } from "../middleware/idempotency.middleware";
import { validate } from "../middleware/validation.middleware";
import { createBookingSchema } from "../validators/schemas/bookings.schemas";
import {
  getMeetingLink,
  regenerateMeetingLink,
} from "../controllers/meetingLink.controller";

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
router.post("/", authenticate, idempotency, validate(createBookingSchema), BookingsController.createBooking);
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
router.post("/:id/confirm", authenticate, BookingsController.confirmBooking);

export default router;
