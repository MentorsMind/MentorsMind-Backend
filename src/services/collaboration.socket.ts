import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { CollaborationService } from './collaboration.service';
import {
  WhiteboardState,
  CodeEditorState,
  Participant,
  ScreenShareState,
} from '../types/collaboration.types';

interface JoinPayload {
  sessionId: string;
  userId: string;
  name?: string;
}

interface CollaborationPayload {
  sessionId: string;
  userId: string;
  whiteboardData?: WhiteboardState;
  sharedCode?: CodeEditorState;
  participants?: Participant[];
  screenShare?: ScreenShareState;
}

export const initializeCollaborationSocket = (httpServer: HttpServer): void => {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    socket.on('joinCollaboration', async (payload: JoinPayload) => {
      if (!payload || !payload.sessionId || !payload.userId) {
        socket.emit('error', 'joinCollaboration requires sessionId and userId');
        return;
      }

      const room = `collab:${payload.sessionId}`;
      socket.data.sessionId = payload.sessionId;
      socket.data.userId = payload.userId;
      socket.join(room);
      socket.to(room).emit('participantJoined', {
        sessionId: payload.sessionId,
        userId: payload.userId,
        name: payload.name || 'participant',
      });

      try {
        const collaborationState = await CollaborationService.getCollaborationSession(payload.sessionId);
        socket.emit('collaborationState', collaborationState);
      } catch (error) {
        socket.emit('error', error instanceof Error ? error.message : 'Collaboration state unavailable');
      }
    });

    socket.on('signal', (data: { sessionId: string; targetId: string; signal: any }) => {
      if (!data || !data.sessionId || !data.targetId) {
        return;
      }
      const room = `collab:${data.sessionId}`;
      socket.to(room).emit('signal', {
        from: socket.data.userId,
        targetId: data.targetId,
        signal: data.signal,
      });
    });

    socket.on('whiteboardUpdate', async (payload: CollaborationPayload) => {
      if (!payload || !payload.sessionId || !payload.userId || !payload.whiteboardData) {
        return;
      }

      const room = `collab:${payload.sessionId}`;
      socket.to(room).emit('whiteboardUpdate', {
        sessionId: payload.sessionId,
        userId: payload.userId,
        whiteboardData: payload.whiteboardData,
      });

      try {
        await CollaborationService.updateCollaborationSession(payload.sessionId, {
          whiteboardData: payload.whiteboardData,
        }, payload.userId);
      } catch (error) {
        console.error('Failed to persist whiteboard update:', error);
      }
    });

    socket.on('codeUpdate', async (payload: CollaborationPayload) => {
      if (!payload || !payload.sessionId || !payload.userId || !payload.sharedCode) {
        return;
      }

      const room = `collab:${payload.sessionId}`;
      socket.to(room).emit('codeUpdate', {
        sessionId: payload.sessionId,
        userId: payload.userId,
        sharedCode: payload.sharedCode,
      });

      try {
        await CollaborationService.updateCollaborationSession(payload.sessionId, {
          sharedCode: payload.sharedCode,
        }, payload.userId);
      } catch (error) {
        console.error('Failed to persist code editor update:', error);
      }
    });

    socket.on('screenShareState', async (payload: CollaborationPayload) => {
      if (!payload || !payload.sessionId || !payload.userId || !payload.screenShare) {
        return;
      }

      const room = `collab:${payload.sessionId}`;
      socket.to(room).emit('screenShareState', {
        sessionId: payload.sessionId,
        userId: payload.userId,
        screenShare: payload.screenShare,
      });

      try {
        await CollaborationService.updateCollaborationSession(payload.sessionId, {
          screenShare: payload.screenShare,
        }, payload.userId);
      } catch (error) {
        console.error('Failed to persist screen share state:', error);
      }
    });

    socket.on('disconnect', () => {
      const sessionId = socket.data.sessionId as string | undefined;
      const userId = socket.data.userId as string | undefined;
      if (!sessionId || !userId) {
        return;
      }

      const room = `collab:${sessionId}`;
      socket.to(room).emit('participantLeft', {
        sessionId,
        userId,
      });
    });
  });
};
