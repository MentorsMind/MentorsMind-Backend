import { Router } from 'express';
import { MessageSearchController } from '../controllers/messageSearch.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';

const router = Router();

/**
 * @swagger
 * /api/v1/messages/search:
 *   get:
 *     summary: Full-text search across all user conversations
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (20 results per page)
 *     responses:
 *       200:
 *         description: Matched messages with conversation context and highlighted snippet
 *       400:
 *         description: Missing search query
 */
router.get('/search', authenticate, asyncHandler(MessageSearchController.search));

export default router;
