import { Server as SocketIOServer } from "socket.io";
import { logger } from "../utils/logger.utils";

let io: SocketIOServer | null = null;

// Store recent events for reconnection replay (userId -> events array)
const eventHistory = new Map<
  string,
  Array<{ event: string; data: any; timestamp: Date }>
>();
const MAX_HISTORY_EVENTS = 5;

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

    logger.debug("SocketService: Emitted event to user", {
      userId,
      event,
      dataKeys: Object.keys(data || {}),
    });
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

    logger.debug("SocketService: Emitted event to all", {
      event,
      dataKeys: Object.keys(data || {}),
    });
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

    logger.info("SocketService: Replaying missed events", {
      userId,
      eventCount: userEvents.length,
    });

    userEvents.forEach(({ event, data }) => {
      this.emitToUser(userId, event, data);
    });
  },
};
