import { Server as SocketIOServer } from "socket.io";
import { logger } from "../utils/logger.utils";

let io: SocketIOServer | null = null;

// Store recent events for reconnection replay (userId -> events array)
const eventHistory = new Map<
  string,
  Array<{ event: string; data: any; timestamp: Date }>
>();
const MAX_HISTORY_EVENTS = 5;
const EVENT_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Periodically evict users whose entire event history has expired
setInterval(() => {
  const now = Date.now();
  for (const [userId, events] of eventHistory) {
    if (events.every((e) => now - e.timestamp.getTime() > EVENT_TTL_MS)) {
      eventHistory.delete(userId);
    }
  }
}, 60_000).unref(); // unref so this timer doesn't prevent process exit

export function initializeSocketService(socketServer: SocketIOServer): void {
  io = socketServer;
}

export const SocketService = {
  /**
   * Emit an event to a specific user
   * @param userId - The user ID to emit to
   * @param event - The event name
   * @param data - The event data
   */
  emitToUser(userId: string, event: string, data: any): void {
    if (!io) {
      logger.warn("SocketService: Socket.IO not initialized");
      return;
    }

    io.to(`user:${userId}`).emit(event, data);

    // Store event in history for reconnection replay
    if (!eventHistory.has(userId)) {
      eventHistory.set(userId, []);
    }
    const userEvents = eventHistory.get(userId)!;
    userEvents.push({ event, data, timestamp: new Date() });

    // Keep only the last MAX_HISTORY_EVENTS
    if (userEvents.length > MAX_HISTORY_EVENTS) {
      userEvents.shift();
    }

    logger.debug(
      { userId, event, dataKeys: Object.keys(data || {}) },
      "SocketService: Emitted event to user",
    );
  },

  /**
   * Emit an event to multiple users
   * @param userIds - Array of user IDs
   * @param event - The event name
   * @param data - The event data
   */
  emitToUsers(userIds: string[], event: string, data: any): void {
    userIds.forEach((userId) => this.emitToUser(userId, event, data));
  },

  /**
   * Emit an event to all connected clients
   * @param event - The event name
   * @param data - The event data
   */
  emitToAll(event: string, data: any): void {
    if (!io) {
      logger.warn("SocketService: Socket.IO not initialized");
      return;
    }

    io.emit(event, data);

    logger.debug(
      { event, dataKeys: Object.keys(data || {}) },
      "SocketService: Emitted event to all",
    );
  },

  /**
   * Replay missed events to a user on reconnection
   * @param userId - The user ID to replay events to
   */
  replayMissedEvents(userId: string): void {
    const userEvents = eventHistory.get(userId);
    if (!userEvents || userEvents.length === 0) {
      return;
    }

    // Drop events older than the TTL before replaying
    const now = Date.now();
    const fresh = userEvents.filter(
      (e) => now - e.timestamp.getTime() <= EVENT_TTL_MS,
    );

    if (fresh.length === 0) {
      eventHistory.delete(userId);
      return;
    }

    // Update the stored array to only the fresh events
    eventHistory.set(userId, fresh);

    logger.info(
      { userId, eventCount: fresh.length },
      "SocketService: Replaying missed events",
    );

    fresh.forEach(({ event, data }) => {
      this.emitToUser(userId, event, data);
    });
  },
};
