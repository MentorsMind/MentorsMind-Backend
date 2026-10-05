import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { CollaborationService } from './collaboration.service';
import {
  WhiteboardState,
  CodeEditorState,
  Participant,
  ScreenShareState,
} from '../types/collaboration.types';
import { CodeCollaborationService } from './code-collaboration.service';
import { OTOperation } from '../utils/operational-transform.utils';
import { CacheService } from './cache.service';

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
      const sessionRoom = `session:${payload.sessionId}`;
      socket.data.sessionId = payload.sessionId;
      socket.data.userId = payload.userId;
      socket.join(room);
      socket.join(sessionRoom);
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
        logger.error('Failed to persist whiteboard update:', error);
      }
    });

    socket.on('codeUpdate', async (payload: { sessionId: string; userId: string; operation: OTOperation }) => {
      if (!payload || !payload.sessionId || !payload.userId || !payload.operation) {
        return;
      }

      const sessionRoom = `session:${payload.sessionId}`;

      try {
        const transformedOp = await CodeCollaborationService.applyOperation(payload.sessionId, payload.operation);
        
        socket.to(sessionRoom).emit('codeUpdate', {
          sessionId: payload.sessionId,
          userId: payload.userId,
          operation: transformedOp,
        });

        socket.emit('codeUpdateAck', {
          sessionId: payload.sessionId,
          operation: transformedOp,
        });
      } catch (error) {
        logger.error('Failed to persist code editor update:', error);
      }
    });

    socket.on('codeUndo', async (payload: { sessionId: string; userId: string }) => {
      try {
        const op = await CodeCollaborationService.undo(payload.sessionId, payload.userId);
        if (op) {
          const sessionRoom = `session:${payload.sessionId}`;
          io.to(sessionRoom).emit('codeUpdate', {
            sessionId: payload.sessionId,
            userId: payload.userId,
            operation: op,
            isUndo: true
          });
        }
      } catch (error) {
        logger.error('Failed to undo:', error);
      }
    });

    socket.on('codeRedo', async (payload: { sessionId: string; userId: string }) => {
      try {
        const op = await CodeCollaborationService.redo(payload.sessionId, payload.userId);
        if (op) {
          const sessionRoom = `session:${payload.sessionId}`;
          io.to(sessionRoom).emit('codeUpdate', {
            sessionId: payload.sessionId,
            userId: payload.userId,
            operation: op,
            isRedo: true
          });
        }
      } catch (error) {
        logger.error('Failed to redo:', error);
      }
    });

    socket.on('cursorUpdate', async (payload: { sessionId: string; userId: string; position: any }) => {
      if (!payload || !payload.sessionId || !payload.userId || !payload.position) {
        return;
      }
      
      const sessionRoom = `session:${payload.sessionId}`;
      socket.to(sessionRoom).emit('cursorUpdate', {
        userId: payload.userId,
        position: payload.position
      });

      const key = `cursor:${payload.userId}:${JSON.stringify(payload.position)}`;
      await CacheService.set(key, payload.position, 300);
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
        logger.error('Failed to persist screen share state:', error);
      }
    });

    socket.on('disconnect', () => {
      const sessionId = socket.data.sessionId as string | undefined;
      const userId = socket.data.userId as string | undefined;
      if (!sessionId || !userId) {
        return;
      }

      const room = `collab:${sessionId}`;
      const sessionRoom = `session:${sessionId}`;
      socket.to(room).emit('participantLeft', {
        sessionId,
        userId,
      });
      socket.to(sessionRoom).emit('participantLeft', {
        sessionId,
        userId,
      });
    });
  });
};
