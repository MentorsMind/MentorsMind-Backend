import { WebSocket } from 'ws';
import { AuthenticatedWebSocket } from '../websocket/ws-auth.middleware';
import { logger } from '../utils/logger.utils';
import { redisConfig } from '../config/redis.config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WsMessage {
  event: string;
  data: Record<string, any>;
}

type RedisMessageCallback = (userId: string, payload: object) => void;

// ─── In-process room map ──────────────────────────────────────────────────────

/** userId → Set of open WebSocket connections (supports multiple tabs/devices) */
const rooms = new Map<string, Set<AuthenticatedWebSocket>>();

// ─── Redis pub/sub ────────────────────────────────────────────────────────────

const CHANNEL = 'mm:ws:events';

let pubClient: any = null;
let subClient: any = null;

async function getRedisClients(): Promise<{ pub: any; sub: any } | null> {
  if (!redisConfig.url) return null;
  if (pubClient && subClient) return { pub: pubClient, sub: subClient };

  try {
    const { default: Redis } = await import('ioredis');
    const opts = { lazyConnect: false, maxRetriesPerRequest: 1 };
    pubClient = new Redis(redisConfig.url, opts);
    subClient = new Redis(redisConfig.url, opts);
    return { pub: pubClient, sub: subClient };
  } catch (err: any) {
    logger.warn('WsService: Redis unavailable, pub/sub disabled', {
      error: err.message,
    });
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const WsService = {
  /** Register a client socket in its user room */
  addClient(userId: string, ws: AuthenticatedWebSocket): void {
    if (!rooms.has(userId)) rooms.set(userId, new Set());
    rooms.get(userId)!.add(ws);
    logger.debug('WsService: client added', {
      userId,
      connections: rooms.get(userId)!.size,
    });
  },

  /** Remove a client socket from its user room */
  removeClient(userId: string, ws: AuthenticatedWebSocket): void {
    const room = rooms.get(userId);
    if (!room) return;
    room.delete(ws);
    if (room.size === 0) rooms.delete(userId);
    logger.debug('WsService: client removed', { userId });
  },

  /** Send a message directly to all sockets for a given userId (in-process) */
  sendToUser(userId: string, payload: object): void {
    const room = rooms.get(userId);
    if (!room || room.size === 0) return;

    const data = JSON.stringify(payload);
    for (const ws of room) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  },

  /**
   * Publish a message for a user.
   * Uses Redis pub/sub when available so all server instances can deliver it.
   * Falls back to in-process delivery.
   */
  async publish(
    userId: string,
    event: string,
    data: Record<string, any>,
  ): Promise<void> {
    const payload: WsMessage = { event, data };

    const clients = await getRedisClients();
    if (clients) {
      try {
        await clients.pub.publish(CHANNEL, JSON.stringify({ userId, payload }));
        return;
      } catch (err: any) {
        logger.warn('WsService: Redis publish failed, falling back', {
          error: err.message,
        });
      }
    }

    // Fallback: direct in-process delivery
    this.sendToUser(userId, payload);
  },

  /**
   * Subscribe to Redis channel and invoke callback for each message.
   * No-op if Redis is unavailable.
   */
  async subscribeToRedis(callback: RedisMessageCallback): Promise<void> {
    const clients = await getRedisClients();
    if (!clients) return;

    await clients.sub.subscribe(CHANNEL);
    clients.sub.on('message', (_channel: string, message: string) => {
      try {
        const { userId, payload } = JSON.parse(message);
        callback(userId, payload);
      } catch {
        // ignore malformed messages
      }
    });

    logger.info('WsService: subscribed to Redis channel', { channel: CHANNEL });
  },

  /** Returns the number of connected users */
  getConnectedCount(): number {
    return rooms.size;
  },

  /** Cleanup Redis connections (called on server close) */
  async cleanup(): Promise<void> {
    try {
      if (subClient) await subClient.quit();
      if (pubClient) await pubClient.quit();
    } catch {
      // ignore
    }
  },
};
