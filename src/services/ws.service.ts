import WebSocket from "ws";
import { logger } from "../utils/logger.utils";

type WsClient = WebSocket;

const clients = new Map<string, Set<WsClient>>();
let subscribed = false;

export const WsService = {
  addClient(userId: string, ws: WsClient): void {
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId)!.add(ws);
  },

  removeClient(userId: string, ws: WsClient): void {
    const set = clients.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) clients.delete(userId);
  },

  sendToUser(userId: string, event: string, data: unknown): void {
    const set = clients.get(userId);
    if (!set) return;
    const payload = JSON.stringify({ event, data });
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  },

  async publish(userId: string, event: string, data: unknown): Promise<void> {
    this.sendToUser(userId, event, data);
  },

  /**
   * Subscribe to Redis pub/sub for cross-process WS delivery.
   * Dedup guard: only one subscription is created regardless of call count.
   */
  subscribeToRedis(callback: (userId: string, payload: unknown) => void): void {
    if (subscribed) return;
    subscribed = true;

    (async () => {
      try {
        const { getRedisClients } = await import("../config/redis.pubsub");
        const { sub, CHANNEL } = await getRedisClients();

        sub.removeAllListeners("message");
        await sub.subscribe(CHANNEL);

        sub.on("message", (_channel: string, message: string) => {
          try {
            const { userId, payload } = JSON.parse(message);
            callback(userId, payload);
          } catch {
            logger.warn({ message }, "WsService: invalid Redis message");
          }
        });
      } catch (err: any) {
        subscribed = false; // allow retry on next call
        logger.error(
          { error: err.message },
          "WsService: subscribeToRedis failed",
        );
      }
    })();
  },

  getConnectedCount(): number {
    let count = 0;
    for (const set of clients.values()) count += set.size;
    return count;
  },

  cleanup(): void {
    clients.clear();
    subscribed = false;
  },

  /** Exposed for testing only */
  _resetSubscribed(): void {
    subscribed = false;
  },
};
