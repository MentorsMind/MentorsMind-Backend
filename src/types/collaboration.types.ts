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
