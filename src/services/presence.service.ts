import { Redis } from "ioredis";
import { pool } from "../config/database";

// ─── Constants ───────────────────────────────────────────────────────────────

/** TTL in seconds for the presence key — client heartbeat is every 20 s,
 *  so 30 s gives one missed beat before the key expires naturally. */
const PRESENCE_TTL_SEC = 30;

/** Redis key helpers */
const presenceKey = (userId: string) => `online:${userId}`;
const lastSeenKey = (userId: string) => `last_seen:${userId}`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OnlineStatus {
  userId: string;
  online: boolean;
  last_seen: string | null; // ISO-8601 or null if never seen
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PresenceService {
  constructor(private readonly redis: Redis) {}

  // ── Heartbeat / mark online ────────────────────────────────────────────────

  /**
   * Mark a user as online. Call on every client heartbeat (every 20 s).
   * Refreshes the TTL so the key expires 30 s after the *last* heartbeat.
   *
   * Returns `true` if this is a fresh transition (was offline → now online),
   * so the caller can emit `user:online` events only on real state changes.
   */
  async markOnline(userId: string): Promise<boolean> {
    const wasOnline = await this.redis.exists(presenceKey(userId));

    const now = new Date().toISOString();
    await Promise.all([
      this.redis.set(presenceKey(userId), "1", "EX", PRESENCE_TTL_SEC),
      this.redis.set(lastSeenKey(userId), now),
    ]);

    return wasOnline === 0; // true = fresh transition
  }

  /**
   * Explicitly mark a user as offline (e.g. on clean disconnect).
   *
   * Returns `true` if this is a fresh transition (was online → now offline).
   */
  async markOffline(userId: string): Promise<boolean> {
    const wasOnline = await this.redis.exists(presenceKey(userId));

    const now = new Date().toISOString();
    await Promise.all([
      this.redis.del(presenceKey(userId)),
      this.redis.set(lastSeenKey(userId), now),
    ]);

    return wasOnline === 1; // true = fresh transition
  }

  // ── Status queries ─────────────────────────────────────────────────────────

  /** Get online status for a single user. */
  async getStatus(userId: string): Promise<OnlineStatus> {
    const [online, lastSeen] = await Promise.all([
      this.redis.exists(presenceKey(userId)),
      this.redis.get(lastSeenKey(userId)),
    ]);

    return {
      userId,
      online: online === 1,
      last_seen: lastSeen ?? null,
    };
  }

  /**
   * Batch status query — returns status for multiple user IDs in one round-trip.
   * Uses a pipeline to keep Redis round-trips to 1 (exists) + 1 (mget).
   */
  async getBatchStatus(userIds: string[]): Promise<OnlineStatus[]> {
    if (userIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const id of userIds) pipeline.exists(presenceKey(id));
    const existsResults = await pipeline.exec(); // [[null, 0|1], ...]

    const lastSeenValues = await this.redis.mget(
      ...userIds.map((id) => lastSeenKey(id))
    );

    return userIds.map((userId, i) => ({
      userId,
      online: (existsResults?.[i]?.[1] as number) === 1,
      last_seen: lastSeenValues[i] ?? null,
    }));
  }

  // ── Privacy gate ───────────────────────────────────────────────────────────

  /**
   * Returns true if `requesterId` is allowed to see `targetId`'s online status.
   * The rule: they must share at least one upcoming (or in-progress) session.
   */
  async canViewStatus(
    requesterId: string,
    targetId: string
  ): Promise<boolean> {
    if (requesterId === targetId) return true;

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM sessions
        WHERE status IN ('confirmed', 'in_progress')
          AND (
                (mentor_id = $1 AND mentee_id = $2)
             OR (mentor_id = $2 AND mentee_id = $1)
              )`,
      [requesterId, targetId]
    );

    return parseInt(rows[0]?.count ?? "0", 10) > 0;
  }

  /**
   * Filter a list of userIds down to those the requester is allowed to query.
   * Used by the batch endpoint to silently omit unauthorised targets.
   */
  async filterAuthorised(
    requesterId: string,
    targetIds: string[]
  ): Promise<string[]> {
    if (targetIds.length === 0) return [];

    // Build a single query that checks all targets at once.
    const placeholders = targetIds
      .map((_, i) => `$${i + 2}`)
      .join(", ");

    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT
              CASE
                WHEN mentor_id = $1 THEN mentee_id
                ELSE mentor_id
              END AS user_id
         FROM sessions
        WHERE status IN ('confirmed', 'in_progress')
          AND (mentor_id = $1 OR mentee_id = $1)
          AND (mentor_id IN (${placeholders}) OR mentee_id IN (${placeholders}))`,
      [requesterId, ...targetIds, ...targetIds]
    );

    const allowed = new Set<string>([
      requesterId,
      ...rows.map((r) => r.user_id),
    ]);

    return targetIds.filter((id) => allowed.has(id));
  }

  // ── Room membership helpers (used by socket layer) ────────────────────────

  /**
   * Returns all user IDs that should receive presence updates for `userId`.
   * That is: everyone who shares a confirmed/in-progress session with `userId`.
   */
  async getPresenceAudience(userId: string): Promise<string[]> {
    const { rows } = await pool.query<{ peer_id: string }>(
      `SELECT DISTINCT
              CASE
                WHEN mentor_id = $1 THEN mentee_id
                ELSE mentor_id
              END AS peer_id
         FROM sessions
        WHERE status IN ('confirmed', 'in_progress')
          AND (mentor_id = $1 OR mentee_id = $1)`,
      [userId]
    );

    return rows.map((r) => r.peer_id);
  }
}