import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { createLimiter } from '../middleware/rate-limit.middleware';
import { CollaborativeLearningService } from '../services/collaborative-learning.service';
import { logger } from '../utils/logger.utils';
import { routeParam } from '../utils/route-params.utils';

const router = Router();

/**
 * Rate limiter for peer review submission.
 * Max 5 peer reviews per user per 24-hour window.
 * The service layer enforces the per-path-per-24h limit; this middleware adds a
 * per-user global guard to catch coordinated abuse across many paths.
 */
const peerReviewLimiter = createLimiter({
  profile: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 5,
    message:
      'Rate limit exceeded: you may submit at most 5 peer reviews per 24 hours per learning path.',
  },
  keyStrategy: 'user',
});

// All collaborative learning routes require authentication
router.use(authenticate);

// ── Discussion Forums ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/collaborative-learning/forums
 * Create a discussion forum for a milestone
 */
router.post('/forums', async (req: Request, res: Response) => {
  try {
    const { milestoneId, title, description } = req.body;
    const creatorId = (req as any).user.id;

    if (!milestoneId) {
      return res.status(400).json({ status: 'error', message: 'milestoneId is required' });
    }

    const forum = await CollaborativeLearningService.createMilestoneForum(
      milestoneId,
      creatorId,
      { title, description }
    );

    return res.status(201).json({ status: 'success', data: forum });
  } catch (err: any) {
    logger.error('POST /forums error', { error: err.message });
    return res.status(err.status ?? 500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/collaborative-learning/forums/:forumId/messages
 * Post a message in a forum
 */
router.post('/forums/:forumId/messages', async (req: Request, res: Response) => {
  try {
    const forumId = routeParam(req.params.forumId);
    const userId = (req as any).user.id;
    const { content, parentMessageId } = req.body;

    if (!content) {
      return res.status(400).json({ status: 'error', message: 'content is required' });
    }

    const message = await CollaborativeLearningService.postForumMessage(
      forumId,
      userId,
      { content, parentMessageId }
    );

    return res.status(201).json({ status: 'success', data: message });
  } catch (err: any) {
    logger.error('POST /forums/:forumId/messages error', { error: err.message });
    return res.status(err.status ?? 500).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/v1/collaborative-learning/forums/:forumId/messages
 * Get paginated messages for a forum
 */
router.get('/forums/:forumId/messages', async (req: Request, res: Response) => {
  try {
    const forumId = routeParam(req.params.forumId);
    const userId = (req as any).user.id;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const includeReplies = req.query.includeReplies === 'true';

    const result = await CollaborativeLearningService.getForumMessages(
      forumId,
      userId,
      { page, limit, includeReplies }
    );

    return res.status(200).json({ status: 'success', data: result });
  } catch (err: any) {
    logger.error('GET /forums/:forumId/messages error', { error: err.message });
    return res.status(err.status ?? 500).json({ status: 'error', message: err.message });
  }
});

// ── Study Groups ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/collaborative-learning/study-groups
 * Create a study group for a learning path
 */
router.post('/study-groups', async (req: Request, res: Response) => {
  try {
    const creatorId = (req as any).user.id;
    const { learningPathId, name, description, maxMembers, isPublic, meetingSchedule, communicationChannel } = req.body;

    if (!learningPathId || !name || !description) {
      return res.status(400).json({
        status: 'error',
        message: 'learningPathId, name, and description are required',
      });
    }

    const group = await CollaborativeLearningService.createStudyGroup(
      learningPathId,
      creatorId,
      { name, description, maxMembers, isPublic, meetingSchedule, communicationChannel }
    );

    return res.status(201).json({ status: 'success', data: group });
  } catch (err: any) {
    logger.error('POST /study-groups error', { error: err.message });
    return res.status(err.status ?? 500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/collaborative-learning/study-groups/:groupId/join
 * Join a study group
 */
router.post('/study-groups/:groupId/join', async (req: Request, res: Response) => {
  try {
    const groupId = routeParam(req.params.groupId);
    const userId = (req as any).user.id;

    const member = await CollaborativeLearningService.joinStudyGroup(groupId, userId);

    return res.status(200).json({ status: 'success', data: member });
  } catch (err: any) {
    logger.error('POST /study-groups/:groupId/join error', { error: err.message });
    return res.status(err.status ?? 500).json({ status: 'error', message: err.message });
  }
});

// ── Peer Reviews ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/collaborative-learning/peer-reviews
 * Submit a peer review for a milestone submission.
 *
 * Rate limited: max 5 submissions per user per 24 hours.
 * The service additionally enforces max 5 per reviewer per learning path per 24 h.
 */
router.post(
  '/peer-reviews',
  peerReviewLimiter,
  async (req: Request, res: Response) => {
    try {
      const reviewerId = (req as any).user.id;
      const { milestoneId, submissionId, rating, feedback, criteria, isAnonymous } = req.body;

      if (!milestoneId || !submissionId || rating == null || !feedback) {
        return res.status(400).json({
          status: 'error',
          message: 'milestoneId, submissionId, rating, and feedback are required',
        });
      }

      const review = await CollaborativeLearningService.createPeerReview(
        milestoneId,
        submissionId,
        reviewerId,
        { rating, feedback, criteria: criteria ?? [], isAnonymous }
      );

      return res.status(201).json({ status: 'success', data: review });
    } catch (err: any) {
      logger.error('POST /peer-reviews error', { error: err.message });
      return res.status(err.status ?? 500).json({ status: 'error', message: err.message });
    }
  }
);

/**
 * POST /api/v1/collaborative-learning/peer-reviews/:reviewId/vote
 * Vote (like) a peer review.
 * A review must receive at least 1 vote to count toward the reviewer's
 * helpfulReviews score on the leaderboard.
 */
router.post('/peer-reviews/:reviewId/vote', async (req: Request, res: Response) => {
  try {
    const reviewId = routeParam(req.params.reviewId);
    const voterId = (req as any).user.id;

    const result = await CollaborativeLearningService.votePeerReview(reviewId, voterId);

    return res.status(200).json({ status: 'success', data: result });
  } catch (err: any) {
    logger.error('POST /peer-reviews/:reviewId/vote error', { error: err.message });
    return res.status(err.status ?? 500).json({ status: 'error', message: err.message });
  }
});

// ── Leaderboard ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/collaborative-learning/leaderboard
 * Fetch the leaderboard from pre-computed snapshots.
 * Responds in < 50ms when a snapshot is available.
 *
 * Query params:
 *   type   - 'milestone' | 'path' | 'global'  (default: 'global')
 *   id     - UUID of the path or milestone (required when type != 'global')
 *   period - 'week' | 'month' | 'quarter' | 'all' (default: 'month')
 */
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as any) || 'global';
    const targetId = req.query.id as string | undefined;
    const period = (req.query.period as any) || 'month';

    if (!['milestone', 'path', 'global'].includes(type)) {
      return res.status(400).json({
        status: 'error',
        message: "type must be 'milestone', 'path', or 'global'",
      });
    }

    if (!['week', 'month', 'quarter', 'all'].includes(period)) {
      return res.status(400).json({
        status: 'error',
        message: "period must be 'week', 'month', 'quarter', or 'all'",
      });
    }

    if ((type === 'milestone' || type === 'path') && !targetId) {
      return res.status(400).json({
        status: 'error',
        message: `id is required when type is '${type}'`,
      });
    }

    const leaderboard = await CollaborativeLearningService.getLeaderboard(
      type,
      targetId,
      period
    );

    return res.status(200).json({ status: 'success', data: leaderboard });
  } catch (err: any) {
    logger.error('GET /leaderboard error', { error: err.message });
    return res.status(err.status ?? 500).json({ status: 'error', message: err.message });
  }
});

export default router;
