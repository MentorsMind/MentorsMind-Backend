import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { SessionManagerService } from '../services/sessionManager.service';

export const SessionsController = {
  async listSessions(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { cursor, limit } = req.query as any;
    const result = await SessionManagerService.listSessions(userId, { cursor, limit: limit ? parseInt(limit, 10) : 20 });
    return res.status(200).json({
      success: true,
      data: {
        data: result.sessions,
        next_cursor: result.next_cursor,
        has_more: result.has_more,
        total: result.total,
      }
    });
  },

  /**
   * DELETE /api/v1/auth/sessions/:id
   * Revoke a specific session by ID.
   */
  async revokeSession(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const id = req.params.id as string;
    const revoked = await SessionManagerService.revokeSession(id, userId);

    if (!revoked) {
      return res.status(404).json({ success: false, error: 'Session not found or already revoked.' });
    }

    return res.status(200).json({ success: true, message: 'Session revoked.' });
  },

  /**
   * DELETE /api/v1/auth/sessions
   * Revoke all sessions except the current one.
   */
  async revokeAllSessions(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // The current refresh token must be sent in the request body so we can keep it alive
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'refreshToken is required to identify the current session.' });
    }

    const count = await SessionManagerService.revokeAllSessions(userId, refreshToken);
    return res.status(200).json({ success: true, message: `${count} session(s) revoked.` });
  },
};
