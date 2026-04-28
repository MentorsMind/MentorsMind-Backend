import type WebSocket from "ws";
import { redis } from "../config/redis";
import { logger } from "../utils/logger.utils";

const WS_CHANNEL = "ws:events";
const PENDING_LIST_PREFIX = "ws:pending:";
const PENDING_TTL_SECONDS = 300; // 5 minutes

// Metric counter for cross-instance delivery failures
let crossInstanceFailures = 0;

// In-process room map: userId -> Set of WebSocket connections
const rooms = new Map<string, Set<WebSocket>>();

export const WsService = {
  addClient(userId: string, ws: WebSocket): void {
    if (!rooms.has(userId)) rooms.set(userId, new Set());
    rooms.get(userId)!.add(ws);
  },

  removeClient(userId: string, ws: WebSocket): void {
    const room = rooms.get(userId);
    if (!room) return;
    room.delete(ws);
    if (room.size === 0) rooms.delete(userId);
  },

  sendToUser(userId: string, payload: object): void {
    const room = rooms.get(userId);
    if (!room) return;
    const msg = JSON.stringify(payload);
    for (const ws of room) {
      try {
        ws.send(msg);
      } catch {
        // ignore send errors on individual sockets
      }
    }
  },

  /**
   * Publish an event to a user.
   *
   * 1. Attempt Redis PUBLISH so all instances receive it.
   * 2. On Redis failure, fall back to in-process delivery.
   *    - If the user is NOT connected to this instance, log a warn and
   *      increment the cross-instance failure counter.
   *    - Store the event in a Redis list (persistent fallback) so it can be
   *      replayed when the user reconnects.
   */
  async publish(userId: string, event: string, data: unknown): Promise<void> {
    const payload = { userId, event, data };

    try {
      await redis.publish(WS_CHANNEL, JSON.stringify(payload));
      return;
    } catch (err: any) {
      logger.warn(
        { error: err.message },
        "WsService: Redis publish failed, falling back",
      );
    }

    // Fallback: in-process delivery
    this.sendToUser(userId, { event, data });

    // Warn if the user is not on this instance — event may be lost
    if (!rooms.has(userId)) {
      crossInstanceFailures++;
      logger.warn(
        { userId, event, crossInstanceFailures },
        "WsService: event may be lost — user not on this instance",
      );

      // Persistent fallback: push to Redis list so the event can be replayed
      try {
        const key = `${PENDING_LIST_PREFIX}${userId}`;
        await redis.rpush(key, JSON.stringify({ event, data, ts: Date.now() }));
        await redis.expire(key, PENDING_TTL_SECONDS);
      } catch (redisErr: any) {
        logger.warn(
          { userId, event, error: redisErr.message },
          "WsService: failed to persist pending event",
        );
      }
    }
  },

  /**
   * Replay pending events stored in Redis for a user (call on reconnect).
   */
  async replayPending(userId: string): Promise<void> {
    const key = `${PENDING_LIST_PREFIX}${userId}`;
    try {
      const items = await redis.lrange(key, 0, -1);
      if (items.length === 0) return;
      await redis.del(key);
      for (const raw of items) {
        const { event, data } = JSON.parse(raw);
        this.sendToUser(userId, { event, data });
      }
      logger.info(
        { userId, count: items.length },
        "WsService: replayed pending events",
      );
    } catch (err: any) {
      logger.warn(
        { userId, error: err.message },
        "WsService: failed to replay pending events",
      );
    }
  },

  /**
   * Subscribe to the Redis channel and deliver events to local clients.
   * Call once at server startup.
   */
  subscribeToRedis(): void {
    // Use a dedicated subscriber connection (ioredis requires a separate client
    // for subscribe mode)
    const subscriber = redis.duplicate();
    subscriber.subscribe(WS_CHANNEL, (err) => {
      if (err) {
        logger.error(
          { error: err.message },
          "WsService: Redis subscribe failed",
        );
      }
    });

    subscriber.on("message", (_channel: string, message: string) => {
      try {
        const { userId, event, data } = JSON.parse(message);
        this.sendToUser(userId, { event, data });
      } catch (err: any) {
        logger.warn(
          { error: err.message },
          "WsService: failed to parse Redis message",
        );
      }
    });
  },

  getConnectedCount(): number {
    let count = 0;
    for (const room of rooms.values()) count += room.size;
    return count;
  },

  /** Exposed for testing */
  getCrossInstanceFailures(): number {
    return crossInstanceFailures;
  },

  cleanup(): void {
    rooms.clear();
    crossInstanceFailures = 0;
  },
};
