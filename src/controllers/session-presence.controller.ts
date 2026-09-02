import { Request, Response } from 'express';
import { pool } from '../config/database';
import { PresenceService } from '../services/presence.service';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger.utils';
import { BookingModel } from '../models/booking.model';

const presenceService = new PresenceService(redisClient);

/**
 * POST /api/v1/sessions/:id/join
 * 
 * Mark the authenticated user as having joined the session.
 * This records the join timestamp and prevents no-show detection.
 * 
 * Use Cases:
 * - Called when mentor/mentee enters the meeting room
 * - Automatically called by WebSocket handler on session:join event
 * - Can be called manually by client before grace period expires
 */
export async function joinSession(req: Request, res: Response): Promise<void> {
  try {
    const { id: sessionId } = req.params;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const userIdStr = Array.isArray(userId) ? userId[0] : userId;
    const userRoleStr = Array.isArray(userRole) ? userRole[0] : userRole;

    // Verify session exists
    const booking = await BookingModel.findById(sessionId);
    if (!booking) {
      res.status(404).json({ 
        success: false, 
        error: 'Session not found' 
      });
      return;
    }

    // Verify user is a participant
    const isMentor = booking.mentor_id === userIdStr;
    const isMentee = booking.mentee_id === userIdStr;

    if (!isMentor && !isMentee) {
      res.status(403).json({ 
        success: false, 
        error: 'Not a participant of this session' 
      });
      return;
    }

    // Determine role
    const role = isMentor ? 'mentor' : 'mentee';

    // Check if already joined
    const existingJoinTime = role === 'mentor' 
      ? booking.mentor_joined_at 
      : booking.mentee_joined_at;

    if (existingJoinTime) {
      res.status(200).json({
        success: true,
        message: 'Already joined',
        data: {
          sessionId,
          role,
          joinedAt: existingJoinTime.toISOString(),
          isFirstJoin: false,
        },
      });
      return;
    }

    // Mark as joined
    const joinedAt = await presenceService.markSessionJoined(
      sessionId,
      userIdStr,
      role
    );

    logger.info('User joined session', {
      sessionId,
      userId: userIdStr,
      role,
      joinedAt,
    });

    res.status(200).json({
      success: true,
      message: 'Successfully joined session',
      data: {
        sessionId,
        role,
        joinedAt,
        isFirstJoin: true,
      },
    });
  } catch (error) {
    logger.error('Error joining session', { error, sessionId: req.params.id });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to join session' 
    });
  }
}

/**
 * GET /api/v1/sessions/:id/presence
 * 
 * Get presence information for both participants in a session.
 * Shows join timestamps and current online status.
 * 
 * Response includes:
 * - mentorJoinedAt: Timestamp when mentor first joined (or null)
 * - menteeJoinedAt: Timestamp when mentee first joined (or null)
 * - mentorOnline: Whether mentor is currently connected
 * - menteeOnline: Whether mentee is currently connected
 */
export async function getSessionPresence(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id: sessionId } = req.params;
    const userId = req.user!.id;
    const userIdParam = req.query.userId;
    const userIdValue = Array.isArray(userIdParam) ? userIdParam[0] : userIdParam;
    const userIdStr = Array.isArray(userId) ? userId[0] : userId;

    // Verify session exists
    const booking = await BookingModel.findById(sessionId);
    if (!booking) {
      res.status(404).json({ 
        success: false, 
        error: 'Session not found' 
      });
      return;
    }

    // Verify user is a participant
    const isParticipant =
      booking.mentor_id === userIdStr || booking.mentee_id === userIdStr;

    if (!isParticipant) {
      res.status(403).json({ 
        success: false, 
        error: 'Not a participant of this session' 
      });
      return;
    }

    // Get full presence status
    const presence = await presenceService.getSessionPresence(
      sessionId,
      booking.mentor_id,
      booking.mentee_id
    );

    res.status(200).json({
      success: true,
      data: {
        sessionId: presence.sessionId,
        mentor: {
          userId: booking.mentor_id,
          joinedAt: presence.mentorJoinedAt,
          online: presence.mentorOnline,
        },
        mentee: {
          userId: booking.mentee_id,
          joinedAt: presence.menteeJoinedAt,
          online: presence.menteeOnline,
        },
      },
    });
  } catch (error) {
    logger.error('Error getting session presence', { 
      error, 
      sessionId: req.params.id 
    });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get session presence' 
    });
  }
}
