import { Redis } from "ioredis";
import { pool } from "../config/database";

// ─── Constants ───────────────────────────────────────────────────────────────

/** TTL in seconds for the presence key — client heartbeat is every 20 s,
 *  so 30 s gives one missed beat before the key expires naturally. */
const PRESENCE_TTL_SEC = 30;

/** Redis key helpers */
const presenceKey = (userId: string) => `online:${userId}`;
const lastSeenKey = (userId: string) => `last_seen:${userId}`;
const sessionJoinKey = (sessionId: string, role: 'mentor' | 'mentee') => 
  `session:${sessionId}:${role}:joined`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OnlineStatus {
  userId: string;
  online: boolean;
  last_seen: string | null; // ISO-8601 or null if never seen
}

export interface SessionPresenceStatus {
  sessionId: string;
  mentorJoinedAt: string | null;
  menteeJoinedAt: string | null;
  mentorOnline: boolean;
  menteeOnline: boolean;
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

  // ── Session join tracking ──────────────────────────────────────────────────

  /**
   * Mark a user as having joined a session. Persists to database and caches in Redis.
   * This prevents no-show detection from flagging the session.
   * 
   * @param sessionId - The booking/session ID
   * @param userId - The user who joined
   * @param role - Whether they are 'mentor' or 'mentee'
   * @returns The timestamp when they joined (ISO-8601)
   */
  async markSessionJoined(
    sessionId: string,
    userId: string,
    role: 'mentor' | 'mentee'
  ): Promise<string> {
    const joinedAt = new Date().toISOString();
    
    // Persist to database
    const column = role === 'mentor' ? 'mentor_joined_at' : 'mentee_joined_at';
    await pool.query(
      `UPDATE bookings 
       SET ${column} = $1, updated_at = NOW()
       WHERE id = $2 AND ${column} IS NULL`,
      [joinedAt, sessionId]
    );

    // Cache in Redis for fast lookups (TTL: 24 hours)
    await this.redis.set(
      sessionJoinKey(sessionId, role),
      joinedAt,
      'EX',
      24 * 60 * 60
    );

    return joinedAt;
  }

  /**
   * Check if a mentor has joined a specific session.
   * Checks Redis cache first, falls back to database.
   * 
   * @param sessionId - The booking/session ID
   * @returns The timestamp when mentor joined, or null if not joined yet
   */
  async getMentorJoinTime(sessionId: string): Promise<string | null> {
    // Check Redis cache first
    const cached = await this.redis.get(sessionJoinKey(sessionId, 'mentor'));
    if (cached) return cached;

    // Fall back to database
    const { rows } = await pool.query<{ mentor_joined_at: Date | null }>(
      `SELECT mentor_joined_at FROM bookings WHERE id = $1`,
      [sessionId]
    );

    const joinedAt = rows[0]?.mentor_joined_at;
    if (!joinedAt) return null;

    const timestamp = joinedAt.toISOString();
    
    // Backfill cache
    await this.redis.set(
      sessionJoinKey(sessionId, 'mentor'),
      timestamp,
      'EX',
      24 * 60 * 60
    );

    return timestamp;
  }

  /**
   * Get full session presence status including join times and current online status.
   * 
   * @param sessionId - The booking/session ID
   * @param mentorId - The mentor user ID
   * @param menteeId - The mentee user ID
   * @returns Full presence information for both participants
   */
  async getSessionPresence(
    sessionId: string,
    mentorId: string,
    menteeId: string
  ): Promise<SessionPresenceStatus> {
    // Get join times from database
    const { rows } = await pool.query<{
      mentor_joined_at: Date | null;
      mentee_joined_at: Date | null;
    }>(
      `SELECT mentor_joined_at, mentee_joined_at 
       FROM bookings WHERE id = $1`,
      [sessionId]
    );

    const booking = rows[0];

    // Get current online status
    const [mentorStatus, menteeStatus] = await this.getBatchStatus([
      mentorId,
      menteeId,
    ]);

    return {
      sessionId,
      mentorJoinedAt: booking?.mentor_joined_at?.toISOString() ?? null,
      menteeJoinedAt: booking?.mentee_joined_at?.toISOString() ?? null,
      mentorOnline: mentorStatus.online,
      menteeOnline: menteeStatus.online,
    };
  }

  /**
   * Check if a mentor is currently online AND has active presence.
   * Used by no-show detection to determine if mentor is available.
   */
  async isMentorActive(mentorId: string): Promise<boolean> {
    const status = await this.getStatus(mentorId);
    return status.online;
  }

  async isUserActive(userId: string): Promise<boolean> {
    const status = await this.getStatus(userId);
    return status.online;
  }
}