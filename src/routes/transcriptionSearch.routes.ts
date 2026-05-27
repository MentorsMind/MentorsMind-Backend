import { Router } from 'express';
import { TranscriptionController } from '../controllers/transcription.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

/**
 * @swagger
 * /api/v1/transcriptions/search:
 *   get:
 *     summary: Full-text search across the user's session transcripts
 *     tags: [Transcription]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Search query (min 2 chars)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Matching transcripts with highlighted snippets
 */
router.get('/search', authenticate, TranscriptionController.searchTranscripts);

export default router;
