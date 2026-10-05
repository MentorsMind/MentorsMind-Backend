/**
 * Sandbox Routes (issue #784)
 *
 * Fixture-data endpoints third-party developers can exercise end-to-end from
 * the Swagger "Try it out" UI without touching real users, payments, or
 * Stellar accounts. Only mounted/responsive when SANDBOX_MODE=true â€” see
 * docs/API_PORTAL_ONBOARDING.md for how this is wired into the docs portal.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.utils';

const router = Router();

const isSandboxEnabled = (): boolean => {
  return process.env.SANDBOX_MODE === 'true' && process.env.NODE_ENV !== 'production';
};

router.use((_req: Request, res: Response, next: NextFunction) => {
  if (!isSandboxEnabled()) {
    logger.warn('Sandbox endpoint accessed but sandbox mode is disabled', {
      path: _req.path,
      sandboxMode: process.env.SANDBOX_MODE,
      nodeEnv: process.env.NODE_ENV,
    });
    res.status(404).json({
      success: false,
      error: 'Sandbox mode is not enabled on this environment',
    });
    return;
  }
  next();
});

/**
 * @swagger
 * /sandbox/mentors:
 *   get:
 *     summary: "[Sandbox] List fixture mentors"
 *     description: Returns a fixed set of fixture mentors for use with the sandbox booking flow. No database is read.
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: Fixture mentor list
 */
router.get('/mentors', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      mentors: [
        { id: 'sandbox-mentor-1', name: 'Ada Sandbox', expertise: ['Stellar', 'Smart Contracts'], hourlyRate: '25.00' },
        { id: 'sandbox-mentor-2', name: 'Kwame Sandbox', expertise: ['Career Coaching'], hourlyRate: '20.00' },
      ],
    },
  });
});

/**
 * @swagger
 * /sandbox/bookings:
 *   post:
 *     summary: "[Sandbox] Create a booking"
 *     description: Simulates the booking creation flow end-to-end against fixture data. No database writes, payments, or emails are triggered.
 *     tags: [Documentation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mentorId, scheduledStart, durationMinutes]
 *             properties:
 *               mentorId: { type: string, example: "sandbox-mentor-1" }
 *               scheduledStart: { type: string, format: date-time, example: "2026-08-01T15:00:00Z" }
 *               durationMinutes: { type: integer, example: 60 }
 *     responses:
 *       201:
 *         description: Simulated booking created
 *       400:
 *         description: Missing required fields
 */
router.post('/bookings', (req: Request, res: Response) => {
  const { mentorId, scheduledStart, durationMinutes } = req.body ?? {};

  if (!mentorId || !scheduledStart || !durationMinutes) {
    res.status(400).json({
      success: false,
      error: 'mentorId, scheduledStart, and durationMinutes are required',
    });
    return;
  }

  const booking = {
    id: `sandbox-booking-${randomUUID()}`,
    mentorId,
    scheduledStart,
    durationMinutes,
    status: 'confirmed',
    escrow: { status: 'held', amount: '25.00', currency: 'USDC' },
    sandbox: true,
    createdAt: new Date().toISOString(),
  };

  logger.info('Sandbox booking created', { bookingId: booking.id });
  res.status(201).json({ success: true, data: { booking } });
});

export default router;

