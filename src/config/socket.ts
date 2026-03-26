import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { env } from './env';
import { logger } from '../utils/logger.utils';
import { SocketService } from '../services/socket.service';

export interface AuthenticatedSocket extends Socket {
  userId: string;
  role: string;
}

export interface AuthenticatedSocket extends Socket {
  userId: string;
  role: string;
}

export function createSocketServer(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    cors: {
      origin: env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // JWT authentication middleware
  io.use((socket: any, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
      logger.warn('Socket.IO: No token provided', { socketId: socket.id });
      return next(new Error('Authentication error'));
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as any;
      socket.userId = decoded.userId;
      socket.role = decoded.role;
      logger.info('Socket.IO: User authenticated', {
        socketId: socket.id,
        userId: socket.userId,
        role: socket.role,
      });
      next();
    } catch (err) {
      logger.warn('Socket.IO: Invalid token', { socketId: socket.id, error: err });
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const { userId, role } = socket;

    // Join user to personal room
    socket.join(`user:${userId}`);

    logger.info('Socket.IO: Client connected', {
      socketId: socket.id,
      userId,
      role,
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info('Socket.IO: Client disconnected', {
        socketId: socket.id,
        userId,
        role,
        reason,
      });
    });

    // Handle reconnection - replay last 5 missed events
    socket.on('reconnect', () => {
      logger.info('Socket.IO: Client reconnected, replaying missed events', {
        socketId: socket.id,
        userId,
      });
      SocketService.replayMissedEvents(userId);
    });
  });

  return io;
}