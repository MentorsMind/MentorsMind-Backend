import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { MessagingService } from '../services/messaging.service';
import { ResponseUtil } from '../utils/response.utils';

export const MessageSearchController = {
  /**
   * GET /api/v1/messages/search?q=...
   * Full-text search across all conversations the authenticated user participates in.
   * Results are paginated (20 per page) and include a highlighted snippet.
   */
  async search(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const q = ((req.query.q as string) || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);

    if (!q) {
      ResponseUtil.error(res, 'Search query parameter (q) is required', 400);
      return;
    }

    const result = await MessagingService.searchMessages(userId, q, page, 20);

    ResponseUtil.success(
      res,
      result,
      'Search results retrieved',
      200,
      {
        page: result.page,
        limit: 20,
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.page < result.totalPages,
        hasPrev: result.page > 1,
      },
    );
  },
};
