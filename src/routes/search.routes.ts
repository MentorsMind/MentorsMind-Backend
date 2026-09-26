import { Router } from 'express';
import { findMentors, autocomplete, getSimilarMentors, getPopularSearches, globalSearch } from '../controllers/search.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';

const router = Router();

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Unified global search across mentors, sessions, and messages
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query (minimum 2 characters)
 *       - in: query
 *         name: types
 *         schema:
 *           type: string
 *           example: mentors,sessions,messages
 *         description: Comma-separated list of entity types to search (defaults to all)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Results per entity type per page
 *     responses:
 *       200:
 *         description: Interleaved search results with a `type` field on each item
 *       400:
 *         description: Query too short or missing
 *       401:
 *         description: Authentication required
 */
router.get('/', authenticate, asyncHandler(globalSearch));

/**
 * @deprecated Under /api/v1 — use GET /api/v2/search/mentors instead (issue #1096).
 * v1 responses carry Deprecation, Sunset and Link headers via deprecationMiddleware.
 *
 * @swagger
 * /search/mentors:
 *   get:
 *     summary: Search mentors (v1 — deprecated, migrate to /api/v2/search/mentors)
 *     tags: [Search]
 *     deprecated: true
 *     responses:
 *       200:
 *         description: Matching mentors. v1 responses include Deprecation and Sunset headers.
 *         headers:
 *           Deprecation:
 *             schema:
 *               type: string
 *             description: Always "true" for deprecated endpoints
 *           Sunset:
 *             schema:
 *               type: string
 *             description: HTTP date after which the v1 endpoint is removed
 */
router.get('/mentors', findMentors);
router.get('/autocomplete/:query', autocomplete);
router.get('/similar/:mentorId', getSimilarMentors);
router.get('/popular', getPopularSearches);

export default router;
