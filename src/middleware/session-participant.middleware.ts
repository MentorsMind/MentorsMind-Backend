/**
 * Session Participant Middleware
 *
 * Verifies that the authenticated user is a participant (mentor or mentee)
 * of the requested session. Admins bypass this check and are granted access
 * to any session.
 *
 * Usage:
 *   router.get('/sessions/:sessionId/recordings/...', requireSessionParticipant, handler);
 *
 * The middleware reads `req.params.sessionId` and queries the sessions table.
 * It attaches `req.session` with { mentorId, menteeId } for downstream handlers.
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import pool from '../config/database';
import { ResponseUtil } from '../utils/response.utils';
import { Logger } from "../utils/logger.utils";

export interface SessionParticipants {
  sessionId: string;
  mentorId: string;
  menteeId: string;
}

// Extend AuthenticatedRequest to carry the resolved session participants
declare module 'express' {
  interface Request {
    sessionParticipants?: SessionParticipants;
  }
}

/**
 * Middleware: require that req.user is a mentor, mentee, or admin for the session
 * identified by req.params.sessionId.
 *
 * - Admins are always granted access (without modifying req.sessionParticipants).
 * - Non-participants receive HTTP 403.
 * - Non-existent sessions receive HTTP 404.
 */
export const requireSessionParticipant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      ResponseUtil.unauthorized(res, 'Authentication required');
      return;
    }

    // Admins may access any session recording
    if (user.role === 'admin') {
      next();
      return;
    }

    const { sessionId } = req.params as Record<string, string>;
    if (!sessionId) {
      ResponseUtil.error(res, 'Session ID is required', 400);
      return;
    }

    const userId = user.userId || user.id;

    const { rows } = await pool.query<{ mentor_id: string; mentee_id: string }>(
      `SELECT mentor_id, mentee_id
         FROM sessions
        WHERE id = $1`,
      [sessionId],
    );

    if (rows.length === 0) {
      ResponseUtil.notFound(res, 'Session not found');
      return;
    }

    const { mentor_id, mentee_id } = rows[0];

    if (userId !== mentor_id && userId !== mentee_id) {
      logger.warn('Unauthorized recording access attempt', {
        userId,
        sessionId,
        mentor_id,
        mentee_id,
      });
      ResponseUtil.forbidden(
        res,
        'Access denied: you are not a participant of this session',
      );
      return;
    }

    // Attach participants for downstream handlers
    req.sessionParticipants = { sessionId, mentorId: mentor_id, menteeId: mentee_id };

    next();
  } catch (error) {
    logger.error('requireSessionParticipant error', { error });
    ResponseUtil.error(res, 'Internal server error', 500);
  }
};

/**
 * Middleware factory: like requireSessionParticipant but resolves the session
 * from a recording ID instead of a direct sessionId param.
 *
 * Useful for endpoints that operate on recordingId and need to verify the
 * caller is a participant of the recording's parent session.
 */
export const requireRecordingParticipant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      ResponseUtil.unauthorized(res, 'Authentication required');
      return;
    }

    // Admins may access any recording
    if (user.role === 'admin') {
      next();
      return;
    }

    const { recordingId } = req.params as Record<string, string>;
    if (!recordingId) {
      ResponseUtil.error(res, 'Recording ID is required', 400);
      return;
    }

    const userId = user.userId || user.id;

    const { rows } = await pool.query<{
      session_id: string;
      mentor_id: string;
      mentee_id: string;
    }>(
      `SELECT session_id, mentor_id, mentee_id
         FROM session_recordings
        WHERE id = $1`,
      [recordingId],
    );

    if (rows.length === 0) {
      ResponseUtil.notFound(res, 'Recording not found');
      return;
    }

    const { session_id, mentor_id, mentee_id } = rows[0];

    if (userId !== mentor_id && userId !== mentee_id) {
      logger.warn('Unauthorized recording access attempt', {
        userId,
        recordingId,
        mentor_id,
        mentee_id,
      });
      ResponseUtil.forbidden(
        res,
        'Access denied: you are not a participant of this recording\'s session',
      );
      return;
    }

    req.sessionParticipants = { sessionId: session_id, mentorId: mentor_id, menteeId: mentee_id };

    next();
  } catch (error) {
    logger.error('requireRecordingParticipant error', { error });
    ResponseUtil.error(res, 'Internal server error', 500);
  }
};
