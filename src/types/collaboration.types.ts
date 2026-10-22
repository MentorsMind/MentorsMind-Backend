export interface WhiteboardState {
  strokes: Array<Record<string, any>>;
  shapes: Array<Record<string, any>>;
  backgroundColor?: string;
  metadata?: Record<string, any>;
}

export interface CodeEditorState {
  language: string;
  content: string;
  cursorPositions?: Record<string, unknown>;
  annotations?: Array<Record<string, any>>;
}

export interface Participant {
  id: string;
  role: 'mentor' | 'mentee' | 'observer';
  name: string;
  joinedAt: string;
}

export interface ScreenShareState {
  active: boolean;
  ownerId: string | null;
  lastUpdatedAt: string | null;
}

export interface CollaborationState {
  whiteboardData: WhiteboardState;
  sharedCode: CodeEditorState;
  participants: Participant[];
  screenShare: ScreenShareState;
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
}

export interface CollaborationSession extends CollaborationState {
  sessionId: string;
}

/**
 * Default collaboration state for new sessions (#1300).
 * Shared by SessionModel.create, CollaborationService and the socket layer
 * so all three agree on the initial bytes (no null crashes on first join).
 */
export const getDefaultCollaborationState = (): CollaborationState => ({
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
