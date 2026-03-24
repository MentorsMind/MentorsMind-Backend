import { Router } from 'express';
import { BookingsController } from '../controllers/bookings.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';
import {
  createBookingSchema,
  updateBookingSchema,
  rescheduleBookingSchema,
  cancelBookingSchema,
  listBookingsSchema,
} from '../validators/schemas/bookings.schemas';
import { idParamSchema } from '../validators/schemas/common.schemas';

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * /bookings:
 *   post:
 *     summary: Create a new booking
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mentorId
 *               - scheduledAt
 *               - durationMinutes
 *               - topic
 *             properties:
 *               mentorId:
 *                 type: string
 *                 format: uuid
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *               durationMinutes:
 *                 type: integer
 *                 minimum: 15
 *                 maximum: 240
 *               topic:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Booking created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Booking conflict
 */
router.post(
  '/',
  validate(createBookingSchema),
  asyncHandler(BookingsController.createBooking)
);

/**
 * @swagger
 * /bookings:
 *   get:
 *     summary: List user bookings
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, completed, cancelled, rescheduled]
 *     responses:
 *       200:
 *         description: Bookings retrieved successfully
 */
router.get(
  '/',
  validate(listBookingsSchema),
  asyncHandler(BookingsController.listBookings)
);

/**
 * @swagger
 * /bookings/{id}:
 *   get:
 *     summary: Get booking details
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
 *     responses:
 *       200:
 *         description: Booking retrieved successfully
 *       404:
 *         description: Booking not found
 */
router.get(
  '/:id',
  validate(idParamSchema),
  asyncHandler(BookingsController.getBooking)
);

/**
 * @swagger
 * /bookings/{id}:
 *   put:
 *     summary: Update booking
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *               durationMinutes:
 *                 type: integer
 *               topic:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking updated successfully
 */
router.put(
  '/:id',
  validate(updateBookingSchema),
  asyncHandler(BookingsController.updateBooking)
);

/**
 * @swagger
 * /bookings/{id}:
 *   delete:
 *     summary: Cancel booking
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
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 */
router.delete(
  '/:id',
  validate(cancelBookingSchema),
  asyncHandler(BookingsController.cancelBooking)
);

/**
 * @swagger
 * /bookings/{id}/confirm:
 *   post:
 *     summary: Confirm booking (mentor only)
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
 *     responses:
 *       200:
 *         description: Booking confirmed successfully
 */
router.post(
  '/:id/confirm',
  validate(idParamSchema),
  asyncHandler(BookingsController.confirmBooking)
);

/**
 * @swagger
 * /bookings/{id}/complete:
 *   post:
 *     summary: Mark booking as completed
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
 *     responses:
 *       200:
 *         description: Booking marked as completed
 */
router.post(
  '/:id/complete',
  validate(idParamSchema),
  asyncHandler(BookingsController.completeBooking)
);

/**
 * @swagger
 * /bookings/{id}/reschedule:
 *   post:
 *     summary: Reschedule booking
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - scheduledAt
 *             properties:
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking rescheduled successfully
 */
router.post(
  '/:id/reschedule',
  validate(rescheduleBookingSchema),
  asyncHandler(BookingsController.rescheduleBooking)
);

/**
 * @swagger
 * /bookings/{id}/payment-status:
 *   get:
 *     summary: Check payment status
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
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
 */
router.get(
  '/:id/payment-status',
  validate(idParamSchema),
  asyncHandler(BookingsController.getPaymentStatus)
);

export default router;
