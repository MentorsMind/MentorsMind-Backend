import { SessionModel } from '../models/session.model';
import {
  CollaborationSession,
  CollaborationState,
} from '../types/collaboration.types';

const createDefaultCollaborationState = (): CollaborationState => ({
  whiteboardData: {
    strokes: [],
    shapes: [],
    backgroundColor: '#ffffff',
    metadata: {},
  },
  sharedCode: {
    language: 'javascript',
    content: '',
    cursorPositions: {},
    annotations: [],
  },
  participants: [],
  screenShare: {
    active: false,
    ownerId: null,
    lastUpdatedAt: null,
  },
  lastUpdatedAt: null,
  lastUpdatedBy: null,
});

const mergeCollaborationState = (
  existing: CollaborationState,
  updates: Partial<CollaborationState>,
  updatedBy: string,
): CollaborationState => ({
  whiteboardData: {
    ...existing.whiteboardData,
    ...(updates.whiteboardData ?? {}),
  },
  sharedCode: {
    ...existing.sharedCode,
    ...(updates.sharedCode ?? {}),
  },
  participants: updates.participants ?? existing.participants,
  screenShare: {
    ...existing.screenShare,
    ...(updates.screenShare ?? {}),
  },
  lastUpdatedAt: new Date().toISOString(),
  lastUpdatedBy: updatedBy,
});

export const CollaborationService = {
  async getCollaborationSession(sessionId: string): Promise<CollaborationSession> {
    const session = await SessionModel.findById(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const state = session.collaboration_state ?? createDefaultCollaborationState();

    return {
      sessionId,
      ...state,
    };
  },

  async updateCollaborationSession(
    sessionId: string,
    updates: Partial<CollaborationState>,
    updatedBy: string,
  ): Promise<CollaborationSession> {
    const session = await SessionModel.findById(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const existing = session.collaboration_state ?? createDefaultCollaborationState();
    const merged = mergeCollaborationState(existing, updates, updatedBy);

    const updatedSession = await SessionModel.updateCollaborationState(sessionId, merged);

    if (!updatedSession) {
      throw new Error(`Failed to update collaboration state for session ${sessionId}`);
    }

    return {
      sessionId,
      ...updatedSession.collaboration_state!,
    };
  },
};
