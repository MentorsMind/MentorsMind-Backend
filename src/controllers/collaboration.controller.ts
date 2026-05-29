import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { CollaborationService } from '../services/collaboration.service';
import { SessionModel } from '../models/session.model';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

const isParticipant = (session: { mentor_id: string; mentee_id: string }, userId: string): boolean => {
  return session.mentor_id === userId || session.mentee_id === userId;
};

export const CollaborationController = {
  getCollaborationState: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return ResponseUtil.unauthorized(res, 'Unauthorized');
    }

    if (Array.isArray(id)) {
      return ResponseUtil.error(res, 'Invalid session ID', 400);
    }

    const session = await SessionModel.findById(id);

    if (!session) {
      return ResponseUtil.notFound(res, 'Session not found');
    }

    if (!isParticipant(session, userId)) {
      return ResponseUtil.forbidden(res, 'Access denied to collaboration session');
    }

    const collaboration = await CollaborationService.getCollaborationSession(id);

    return ResponseUtil.success(res, { collaboration });
  }),

  updateCollaborationState: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const updates = req.body;

    if (!userId) {
      return ResponseUtil.unauthorized(res, 'Unauthorized');
    }

    if (Array.isArray(id)) {
      return ResponseUtil.error(res, 'Invalid session ID', 400);
    }

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return ResponseUtil.error(res, 'Collaboration payload is required', 400);
    }

    const session = await SessionModel.findById(id);

    if (!session) {
      return ResponseUtil.notFound(res, 'Session not found');
    }

    if (!isParticipant(session, userId)) {
      return ResponseUtil.forbidden(res, 'Access denied to update collaboration session');
    }

    const collaboration = await CollaborationService.updateCollaborationSession(id, updates, userId);

    return ResponseUtil.success(res, { collaboration }, 'Collaboration state updated successfully');
  }),
};
