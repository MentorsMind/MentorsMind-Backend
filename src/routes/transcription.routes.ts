import { Router } from 'express';
import { TranscriptionController } from '../controllers/transcription.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router({ mergeParams: true });

/**
 * @swagger
 * tags:
 *   name: Transcription
 *   description: Session auto-transcription with speaker identification
 */

/**
 * @swagger
 * /api/v1/bookings/{id}/transcription:
 *   post:
 *     summary: Trigger transcription for a completed session
 *     tags: [Transcription]
 *     security:
 *       - bearerAuth: true
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
 *             required: [mediaS3Key]
 *             properties:
 *               mediaS3Key:
 *                 type: string
 *                 description: S3 key of the session recording
 *     responses:
 *       202: { description: Transcription job queued }
 *       400: { description: Validation error }
 *       403: { description: Forbidden }
 *       404: { description: Booking not found }
 */
router.post('/', authenticate, TranscriptionController.triggerTranscription);

/**
 * @swagger
 * /api/v1/bookings/{id}/transcription:
 *   get:
 *     summary: Get transcript status and content
 *     tags: [Transcription]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Transcript record }
 *       404: { description: Not found }
 */
router.get('/', authenticate, TranscriptionController.getTranscript);

/**
 * @swagger
 * /api/v1/bookings/{id}/transcription/download:
 *   get:
 *     summary: Download transcript as PDF or TXT
 *     tags: [Transcription]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [pdf, txt] }
 *         description: Export format (default txt)
 *     responses:
 *       200: { description: Presigned download URL }
 *       409: { description: Transcript not ready }
 */
router.get('/download', authenticate, TranscriptionController.downloadTranscript);

export default router;
