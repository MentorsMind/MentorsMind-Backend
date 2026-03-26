import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import {
  authenticateWsConnection,
  AuthenticatedWebSocket,
} from './ws-auth.middleware';
import { logger } from '../utils/logger.utils';
import { WsService } from '../services/ws.service';
import {
  isSessionRoomEvent,
  handleSessionRoomMessage,
  removeFromRoom,
} from './ws-handlers/session-room.handler';

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Initializes the WebSocket server attached to the existing HTTP server.
 * Handles auth, rooms, heartbeat, and Redis pub/sub subscription.
 */
export function initWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Redis pub/sub listener — forward published messages to connected clients
  WsService.subscribeToRedis((userId: string, payload: object) => {
    WsService.sendToUser(userId, payload);
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    // Authenticate before accepting the connection
    const authResult = await authenticateWsConnection(req);

    if (!authResult) {
      ws.close(4001, 'Unauthorized');
      logger.warn('WS: rejected unauthenticated connection', {
        ip: req.socket.remoteAddress,
      });
      return;
    }

    const client = ws as AuthenticatedWebSocket;
    client.userId = authResult.userId;
    client.role = authResult.role;
    client.isAlive = true;

    // Register client in the in-process room map
    WsService.addClient(authResult.userId, client);

    logger.info('WS: client connected', {
      userId: authResult.userId,
      role: authResult.role,
    });

    // Heartbeat — respond to pong frames
    client.on('pong', () => {
      client.isAlive = true;
    });

    client.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(data.toString());
        handleClientMessage(client, msg);
      } catch {
        // Ignore malformed messages
      }
    });

    client.on('close', (code: number, reason: Buffer) => {
      removeFromRoom(client);
      WsService.removeClient(authResult.userId, client);
      logger.info('WS: client disconnected', {
        userId: authResult.userId,
        code,
        reason: reason.toString(),
      });
    });

    client.on('error', (err: Error) => {
      logger.error('WS: client error', {
        userId: authResult.userId,
        error: err.message,
      });
    });

    // Acknowledge successful connection
    client.send(
      JSON.stringify({
        event: 'connected',
        data: { userId: authResult.userId },
      }),
    );
  });

  // Heartbeat interval — ping all clients, terminate unresponsive ones
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      const client = ws as AuthenticatedWebSocket;
      if (!client.isAlive) {
        logger.warn('WS: terminating unresponsive client', {
          userId: client.userId,
        });
        return client.terminate();
      }
      client.isAlive = false;
      client.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeatTimer);
    WsService.cleanup();
  });

  logger.info('WS: WebSocket server initialized at /ws');
  return wss;
}

/**
 * Handle messages sent from the client (e.g. ping, subscribe).
 */
function handleClientMessage(client: AuthenticatedWebSocket, msg: any): void {
  // Route session-room events to the dedicated handler
  if (msg.event && isSessionRoomEvent(msg.event)) {
    handleSessionRoomMessage(client, msg);
    return;
  }

  switch (msg.event) {
    case 'ping':
      client.send(JSON.stringify({ event: 'pong', data: { ts: Date.now() } }));
      break;
    default:
      // Unknown events are silently ignored
      break;
  }
}

export { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS };
