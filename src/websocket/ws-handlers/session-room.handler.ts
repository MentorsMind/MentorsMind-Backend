import { WebSocket } from 'ws';
import { AuthenticatedWebSocket } from '../ws-auth.middleware';
import { SessionModel } from '../../models/session.model';
import { logger } from '../../utils/logger.utils';

// ─── Session room map ────────────────────────────────────────────────────────

/** sessionId → Set of connected participants */
const sessionRooms = new Map<string, Set<AuthenticatedWebSocket>>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function broadcastToSession(
  sessionId: string,
  payload: object,
  exclude?: AuthenticatedWebSocket,
): void {
  const room = sessionRooms.get(sessionId);
  if (!room) return;

  const data = JSON.stringify(payload);
  for (const ws of room) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function sendError(ws: AuthenticatedWebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'session:error', data: { message } }));
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Handle all session-room events from a client.
 */
export async function handleSessionRoomMessage(
  client: AuthenticatedWebSocket,
  msg: { event: string; data?: any },
): Promise<void> {
  switch (msg.event) {
    case 'session:join':
      await handleJoin(client, msg.data);
      break;
    case 'session:leave':
      handleLeave(client, msg.data);
      break;
    case 'session:start':
      handleStart(client, msg.data);
      break;
    case 'session:end':
      handleEnd(client, msg.data);
      break;
    case 'session:notes-sync':
      handleNotesSync(client, msg.data);
      break;
    case 'session:signal':
      handleSignal(client, msg.data);
      break;
  }
}

/**
 * Returns true if the event belongs to the session-room handler.
 */
export function isSessionRoomEvent(event: string): boolean {
  return event.startsWith('session:') && SESSION_EVENTS.has(event);
}

const SESSION_EVENTS = new Set([
  'session:join',
  'session:leave',
  'session:start',
  'session:end',
  'session:notes-sync',
  'session:signal',
]);

// ─── Event handlers ──────────────────────────────────────────────────────────

async function handleJoin(
  client: AuthenticatedWebSocket,
  data: { sessionId?: string },
): Promise<void> {
  const { sessionId } = data ?? {};
  if (!sessionId) return sendError(client, 'sessionId is required');

  // Verify the session exists and this user is a participant
  const session = await SessionModel.findById(sessionId);
  if (!session) return sendError(client, 'Session not found');

  const isMentor = session.mentor_id === client.userId;
  const isMentee = session.mentee_id === client.userId;
  if (!isMentor && !isMentee) {
    return sendError(client, 'Not a participant of this session');
  }

  // Add to room
  if (!sessionRooms.has(sessionId)) sessionRooms.set(sessionId, new Set());
  sessionRooms.get(sessionId)!.add(client);

  // Tag client so we can clean up on disconnect
  (client as any)._sessionRoomId = sessionId;

  // Notify the other participant
  broadcastToSession(
    sessionId,
    {
      event: 'session:peer-joined',
      data: { userId: client.userId, role: client.role },
    },
    client,
  );

  // Acknowledge to the joining client
  client.send(
    JSON.stringify({
      event: 'session:joined',
      data: {
        sessionId,
        participants: [...sessionRooms.get(sessionId)!].map((ws) => ({
          userId: ws.userId,
          role: ws.role,
        })),
      },
    }),
  );

  logger.info('Session room: user joined', {
    sessionId,
    userId: client.userId,
  });
}

function handleLeave(
  client: AuthenticatedWebSocket,
  data: { sessionId?: string },
): void {
  const sessionId = data?.sessionId ?? (client as any)._sessionRoomId;
  if (!sessionId) return;
  removeFromRoom(client, sessionId);
}

function handleStart(
  client: AuthenticatedWebSocket,
  data: { sessionId?: string },
): void {
  const sessionId = data?.sessionId;
  if (!sessionId) return sendError(client, 'sessionId is required');

  broadcastToSession(sessionId, {
    event: 'session:started',
    data: { sessionId, startedBy: client.userId, ts: Date.now() },
  });

  logger.info('Session room: session started', {
    sessionId,
    startedBy: client.userId,
  });
}

function handleEnd(
  client: AuthenticatedWebSocket,
  data: { sessionId?: string },
): void {
  const sessionId = data?.sessionId;
  if (!sessionId) return sendError(client, 'sessionId is required');

  broadcastToSession(sessionId, {
    event: 'session:ended',
    data: { sessionId, endedBy: client.userId, ts: Date.now() },
  });

  // Clean up the room
  sessionRooms.delete(sessionId);

  logger.info('Session room: session ended', {
    sessionId,
    endedBy: client.userId,
  });
}

function handleNotesSync(
  client: AuthenticatedWebSocket,
  data: { sessionId?: string; notes?: string },
): void {
  const { sessionId, notes } = data ?? {};
  if (!sessionId) return sendError(client, 'sessionId is required');

  broadcastToSession(
    sessionId,
    {
      event: 'session:notes-updated',
      data: { sessionId, notes, updatedBy: client.userId, ts: Date.now() },
    },
    client,
  );
}

function handleSignal(
  client: AuthenticatedWebSocket,
  data: { sessionId?: string; type?: string; payload?: any },
): void {
  const { sessionId, type, payload } = data ?? {};
  if (!sessionId || !type) {
    return sendError(client, 'sessionId and signal type are required');
  }

  // Forward the signaling data (offer/answer/ice-candidate) to the other peer
  broadcastToSession(
    sessionId,
    {
      event: 'session:signal',
      data: { sessionId, from: client.userId, type, payload },
    },
    client,
  );
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Remove a client from their session room. Called on disconnect or explicit leave.
 */
export function removeFromRoom(
  client: AuthenticatedWebSocket,
  sessionId?: string,
): void {
  const roomId = sessionId ?? (client as any)._sessionRoomId;
  if (!roomId) return;

  const room = sessionRooms.get(roomId);
  if (!room) return;

  room.delete(client);

  broadcastToSession(roomId, {
    event: 'session:peer-left',
    data: { userId: client.userId, role: client.role },
  });

  if (room.size === 0) sessionRooms.delete(roomId);

  delete (client as any)._sessionRoomId;

  logger.info('Session room: user left', {
    sessionId: roomId,
    userId: client.userId,
  });
}
