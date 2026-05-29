/**
 * OfflineCacheService
 *
 * Builds and serves user data snapshots for offline use.
 *
 * The mobile client calls GET /api/v1/offline/snapshot to download a
 * complete data bundle before going offline. The bundle contains:
 *  - User profile
 *  - Upcoming bookings (next 30 days)
 *  - Recent notifications (last 50)
 *  - Active goals
 *  - Recent messages (last 100)
 *
 * Delta sync: subsequent calls include an `If-None-Match` header with the
 * previous ETag. If nothing changed the server returns 304 Not Modified.
 *
 * Sync state is tracked per domain in the offline_sync_state table so the
 * client can request incremental updates per domain.
 */

import crypto from 'crypto';
import pool from '../config/database';
import { CacheService } from './cache.service';
import { logger } from '../utils/logger.utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OfflineSnapshot {
  userId: string;
  generatedAt: string;
  etag: string;
  domains: {
    profile: SnapshotDomain<UserSnapshot>;
    bookings: SnapshotDomain<BookingSnapshot[]>;
    notifications: SnapshotDomain<NotificationSnapshot[]>;
    goals: SnapshotDomain<GoalSnapshot[]>;
    messages: SnapshotDomain<MessageSnapshot[]>;
  };
}

export interface SnapshotDomain<T> {
  data: T;
  lastSyncedAt: string;
  recordCount: number;
  etag: string;
}

export interface UserSnapshot {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  bio: string | null;
  avatarUrl: string | null;
  timezone: string | null;
  updatedAt: string;
}

export interface BookingSnapshot {
  id: string;
  mentorId: string;
  menteeId: string;
  topic: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  amount: string;
  currency: string;
  paymentStatus: string;
  meetingUrl: string | null;
  updatedAt: string;
}

export interface NotificationSnapshot {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface GoalSnapshot {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetDate: string | null;
  progress: number;
  updatedAt: string;
}

export interface MessageSnapshot {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
}

export interface DeltaUpdate {
  domain: string;
  since: string;
  records: unknown[];
  deletedIds: string[];
  newEtag: string;
  recordCount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis TTL for cached snapshots (5 minutes) */
const SNAPSHOT_TTL_SECONDS = 5 * 60;

// ─── Cache key helpers ────────────────────────────────────────────────────────

function snapshotCacheKey(userId: string): string {
  return `mm:offline:snapshot:${userId}`;
}

// ─── ETag helpers ─────────────────────────────────────────────────────────────

function computeEtag(data: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .substring(0, 16);
}

function buildDomain<T>(data: T, now: Date): SnapshotDomain<T> {
  return {
    data,
    lastSyncedAt: now.toISOString(),
    recordCount: Array.isArray(data) ? data.length : 1,
    etag: computeEtag(data),
  };
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchProfile(userId: string): Promise<UserSnapshot> {
  const { rows } = await pool.query<any>(
    `SELECT id, email, first_name, last_name, role, bio, avatar_url, timezone, updated_at
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  const u = rows[0];
  if (!u) throw new Error('User not found');
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    role: u.role,
    bio: u.bio ?? null,
    avatarUrl: u.avatar_url ?? null,
    timezone: u.timezone ?? null,
    updatedAt: u.updated_at?.toISOString() ?? new Date().toISOString(),
  };
}

async function fetchBookings(userId: string): Promise<BookingSnapshot[]> {
  const { rows } = await pool.query<any>(
    `SELECT id, mentor_id, mentee_id, topic, scheduled_at, duration_minutes,
            status, amount, currency, payment_status, meeting_url, updated_at
     FROM bookings
     WHERE (mentor_id = $1 OR mentee_id = $1)
       AND status NOT IN ('cancelled', 'completed')
       AND scheduled_at >= NOW() - INTERVAL '1 day'
       AND scheduled_at <= NOW() + INTERVAL '30 days'
     ORDER BY scheduled_at ASC
     LIMIT 100`,
    [userId],
  );
  return rows.map((b: any) => ({
    id: b.id,
    mentorId: b.mentor_id,
    menteeId: b.mentee_id,
    topic: b.topic,
    scheduledAt: b.scheduled_at?.toISOString(),
    durationMinutes: b.duration_minutes,
    status: b.status,
    amount: b.amount,
    currency: b.currency,
    paymentStatus: b.payment_status,
    meetingUrl: b.meeting_url ?? null,
    updatedAt: b.updated_at?.toISOString(),
  }));
}

async function fetchNotifications(userId: string): Promise<NotificationSnapshot[]> {
  const { rows } = await pool.query<any>(
    `SELECT id, type, title, body, is_read, data, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId],
  );
  return rows.map((n: any) => ({
    id: n.id,
    type: n.type,
    title: n.title ?? '',
    body: n.body ?? '',
    isRead: n.is_read ?? false,
    data: n.data ?? null,
    createdAt: n.created_at?.toISOString(),
  }));
}

async function fetchGoals(userId: string): Promise<GoalSnapshot[]> {
  try {
    const { rows } = await pool.query<any>(
      `SELECT id, title, description, status, target_date, progress, updated_at
       FROM goals
       WHERE learner_id = $1 AND status != 'archived'
       ORDER BY updated_at DESC
       LIMIT 50`,
      [userId],
    );
    return rows.map((g: any) => ({
      id: g.id,
      title: g.title,
      description: g.description ?? null,
      status: g.status,
      targetDate: g.target_date?.toISOString() ?? null,
      progress: g.progress ?? 0,
      updatedAt: g.updated_at?.toISOString(),
    }));
  } catch {
    // goals table may not exist in all deployments
    return [];
  }
}

async function fetchMessages(userId: string): Promise<MessageSnapshot[]> {
  try {
    const { rows } = await pool.query<any>(
      `SELECT m.id, m.conversation_id, m.sender_id, m.body AS content,
              (m.read_at IS NOT NULL) AS is_read, m.created_at
       FROM messages m
       WHERE m.conversation_id IN (
         SELECT id FROM conversations
         WHERE participant_one_id = $1 OR participant_two_id = $1
       )
         AND m.is_deleted = FALSE
       ORDER BY m.created_at DESC
       LIMIT 100`,
      [userId],
    );
    return rows.map((m: any) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      content: m.content,
      isRead: m.is_read ?? false,
      createdAt: m.created_at?.toISOString(),
    }));
  } catch {
    return [];
  }
}

// ─── Sync state helpers ───────────────────────────────────────────────────────

async function upsertSyncState(
  userId: string,
  domain: string,
  etag: string,
  recordCount: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO offline_sync_state (user_id, domain, last_synced_at, etag, record_count)
     VALUES ($1, $2, NOW(), $3, $4)
     ON CONFLICT (user_id, domain) DO UPDATE
       SET last_synced_at = NOW(), etag = $3, record_count = $4, updated_at = NOW()`,
    [userId, domain, etag, recordCount],
  );
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const OfflineCacheService = {
  /**
   * Build a full offline snapshot for a user.
   * Results are cached in Redis for SNAPSHOT_TTL_SECONDS.
   *
   * @param userId       - The user to build the snapshot for
   * @param forceRefresh - Skip Redis cache and rebuild from DB
   */
  async buildSnapshot(
    userId: string,
    forceRefresh = false,
  ): Promise<OfflineSnapshot> {
    const cacheKey = snapshotCacheKey(userId);

    if (!forceRefresh) {
      const cached = await CacheService.get<OfflineSnapshot>(cacheKey);
      if (cached) {
        logger.debug('OfflineCacheService: snapshot cache hit', { userId });
        return cached;
      }
    }

    const now = new Date();

    // Fetch all domains in parallel
    const [profile, bookings, notifications, goals, messages] =
      await Promise.all([
        fetchProfile(userId),
        fetchBookings(userId),
        fetchNotifications(userId),
        fetchGoals(userId),
        fetchMessages(userId),
      ]);

    const domains = {
      profile: buildDomain(profile, now),
      bookings: buildDomain(bookings, now),
      notifications: buildDomain(notifications, now),
      goals: buildDomain(goals, now),
      messages: buildDomain(messages, now),
    };

    const overallEtag = computeEtag(
      Object.values(domains).map((d) => d.etag),
    );

    const snapshot: OfflineSnapshot = {
      userId,
      generatedAt: now.toISOString(),
      etag: overallEtag,
      domains,
    };

    // Cache in Redis
    await CacheService.set(cacheKey, snapshot, SNAPSHOT_TTL_SECONDS);

    // Persist sync state per domain
    await Promise.all(
      Object.entries(domains).map(([domain, d]) =>
        upsertSyncState(userId, domain, d.etag, d.recordCount),
      ),
    );

    logger.info('OfflineCacheService: snapshot built', {
      userId,
      etag: overallEtag,
      domains: Object.fromEntries(
        Object.entries(domains).map(([k, v]) => [k, v.recordCount]),
      ),
    });

    return snapshot;
  },

  /**
   * Get the current ETag for a user's snapshot without rebuilding it.
   * Returns null if no snapshot is cached.
   */
  async getSnapshotEtag(userId: string): Promise<string | null> {
    const cached = await CacheService.get<OfflineSnapshot>(
      snapshotCacheKey(userId),
    );
    return cached?.etag ?? null;
  },

  /**
   * Invalidate the cached snapshot for a user.
   * Called whenever user data changes (booking update, profile change, etc.)
   */
  async invalidateSnapshot(userId: string): Promise<void> {
    await CacheService.del(snapshotCacheKey(userId));
    logger.debug('OfflineCacheService: snapshot invalidated', { userId });
  },

  /**
   * Get a delta update for a specific domain since a given timestamp.
   * Returns only records modified after `since`.
   */
  async getDelta(
    userId: string,
    domain: string,
    since: string,
  ): Promise<DeltaUpdate> {
    const sinceDate = new Date(since);
    let records: unknown[] = [];
    let deletedIds: string[] = [];

    switch (domain) {
      case 'bookings': {
        const { rows } = await pool.query<any>(
          `SELECT id, mentor_id, mentee_id, topic, scheduled_at, duration_minutes,
                  status, amount, currency, payment_status, meeting_url, updated_at
           FROM bookings
           WHERE (mentor_id = $1 OR mentee_id = $1)
             AND updated_at > $2
           ORDER BY updated_at ASC
           LIMIT 200`,
          [userId, sinceDate],
        );
        records = rows.map((b: any) => ({
          id: b.id,
          mentorId: b.mentor_id,
          menteeId: b.mentee_id,
          topic: b.topic,
          scheduledAt: b.scheduled_at?.toISOString(),
          durationMinutes: b.duration_minutes,
          status: b.status,
          amount: b.amount,
          currency: b.currency,
          paymentStatus: b.payment_status,
          meetingUrl: b.meeting_url ?? null,
          updatedAt: b.updated_at?.toISOString(),
        }));
        // Cancelled bookings are treated as soft-deletes on the client
        deletedIds = (records as any[])
          .filter((r) => r.status === 'cancelled')
          .map((r) => r.id);
        break;
      }

      case 'notifications': {
        const { rows } = await pool.query<any>(
          `SELECT id, type, title, body, is_read, data, created_at
           FROM notifications
           WHERE user_id = $1 AND created_at > $2
           ORDER BY created_at DESC
           LIMIT 100`,
          [userId, sinceDate],
        );
        records = rows.map((n: any) => ({
          id: n.id,
          type: n.type,
          title: n.title ?? '',
          body: n.body ?? '',
          isRead: n.is_read ?? false,
          data: n.data ?? null,
          createdAt: n.created_at?.toISOString(),
        }));
        break;
      }

      case 'profile': {
        const { rows } = await pool.query<any>(
          `SELECT id, email, first_name, last_name, role, bio, avatar_url, timezone, updated_at
           FROM users
           WHERE id = $1 AND updated_at > $2`,
          [userId, sinceDate],
        );
        records = rows.map((u: any) => ({
          id: u.id,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          role: u.role,
          bio: u.bio ?? null,
          avatarUrl: u.avatar_url ?? null,
          timezone: u.timezone ?? null,
          updatedAt: u.updated_at?.toISOString(),
        }));
        break;
      }

      case 'goals': {
        try {
          const { rows } = await pool.query<any>(
            `SELECT id, title, description, status, target_date, progress, updated_at
             FROM goals
             WHERE learner_id = $1 AND updated_at > $2
             ORDER BY updated_at ASC`,
            [userId, sinceDate],
          );
          records = rows.map((g: any) => ({
            id: g.id,
            title: g.title,
            description: g.description ?? null,
            status: g.status,
            targetDate: g.target_date?.toISOString() ?? null,
            progress: g.progress ?? 0,
            updatedAt: g.updated_at?.toISOString(),
          }));
          deletedIds = (records as any[])
            .filter((r) => r.status === 'archived')
            .map((r) => r.id);
        } catch {
          records = [];
        }
        break;
      }

      case 'messages': {
        try {
          const { rows } = await pool.query<any>(
            `SELECT m.id, m.conversation_id, m.sender_id, m.body AS content,
                    (m.read_at IS NOT NULL) AS is_read, m.created_at
             FROM messages m
             WHERE m.conversation_id IN (
               SELECT id FROM conversations
               WHERE participant_one_id = $1 OR participant_two_id = $1
             )
               AND m.created_at > $2
               AND m.is_deleted = FALSE
             ORDER BY m.created_at ASC
             LIMIT 200`,
            [userId, sinceDate],
          );
          records = rows.map((m: any) => ({
            id: m.id,
            conversationId: m.conversation_id,
            senderId: m.sender_id,
            content: m.content,
            isRead: m.is_read ?? false,
            createdAt: m.created_at?.toISOString(),
          }));
        } catch {
          records = [];
        }
        break;
      }

      default:
        throw new Error(`Unknown domain: ${domain}`);
    }

    const newEtag = computeEtag(records);
    await upsertSyncState(userId, domain, newEtag, records.length);

    return {
      domain,
      since,
      records,
      deletedIds,
      newEtag,
      recordCount: records.length,
    };
  },

  /**
   * Get the sync state for all domains for a user.
   */
  async getSyncStates(
    userId: string,
  ): Promise<Record<string, { lastSyncedAt: string; etag: string }>> {
    const { rows } = await pool.query<any>(
      `SELECT domain, last_synced_at, etag
       FROM offline_sync_state
       WHERE user_id = $1`,
      [userId],
    );
    const result: Record<string, { lastSyncedAt: string; etag: string }> = {};
    for (const row of rows) {
      result[row.domain] = {
        lastSyncedAt: new Date(row.last_synced_at).toISOString(),
        etag: row.etag,
      };
    }
    return result;
  },
};
