import { WebSocket } from "ws";
import { logger } from "../utils/logger.utils";

/** userId → set of active WebSocket connections */
const clients = new Map<string, Set<WebSocket>>();

export const WsService = {
  addClient(userId: string, ws: WebSocket): void {
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId)!.add(ws);
  },

  removeClient(userId: string, ws: WebSocket): void {
    const set = clients.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) clients.delete(userId);
  },

  /** Send a raw payload to all connections for a user. */
  sendToUser(userId: string, payload: object): void {
    const set = clients.get(userId);
    if (!set) return;
    const data = JSON.stringify(payload);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  },

  /** Publish an event+data envelope to a user. */
  async publish(userId: string, event: string, data: unknown): Promise<void> {
    this.sendToUser(userId, { event, data });
  },

  getConnectedCount(): number {
    let count = 0;
    for (const set of clients.values()) count += set.size;
    return count;
  },

  /** Remove all closed sockets from the client map. */
  cleanup(): void {
    for (const [userId, set] of clients) {
      for (const ws of set) {
        if (ws.readyState !== WebSocket.OPEN) set.delete(ws);
      }
      if (set.size === 0) clients.delete(userId);
    }
    logger.debug("WsService: cleanup complete", {
      connected: this.getConnectedCount(),
    });
  },

  /** No-op stub — kept for interface compatibility with Redis-backed variants. */
  subscribeToRedis(): void {},
};
