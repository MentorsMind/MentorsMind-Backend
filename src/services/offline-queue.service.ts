/**
 * OfflineQueueService
 *
 * Manages the server-side offline action queue.
 *
 * Flow:
 *  1. Mobile client captures actions while offline and stores them locally.
 *  2. On reconnect the client POSTs the queued actions to
 *     POST /api/v1/offline/sync  (batch) or
 *     POST /api/v1/offline/queue (single).
 *  3. This service persists each action, then processes them in
 *     client_timestamp order via processQueue().
 *  4. Each action is dispatched to the appropriate domain handler.
 *  5. Conflicts are detected and returned to the client for resolution.
 */

import pool from '../config/database';
import { logger } from '../utils/logger.utils';
import { CacheService } from './cache.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OfflineActionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'conflict';

export interface OfflineAction {
  id: string;
  userId: string;
  clientKey: string;
  actionType: string;
  payload: Record<string, unknown>;
  status: OfflineActionStatus;
  clientTimestamp: Date;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  conflictData: Record<string, unknown> | null;
  attemptCount: number;
  maxAttempts: number;
  createdAt: Date;
  processedAt: Date | null;
}

export interface EnqueueInput {
  userId: string;
  clientKey: string;
  actionType: string;
  payload: Record<string, unknown>;
  clientTimestamp: string; // ISO 8601
}

export interface ProcessResult {
  clientKey: string;
  status: OfflineActionStatus;
  result?: Record<string, unknown>;
  error?: string;
  conflictData?: Record<string, unknown>;
}

// ─── Action Handlers ──────────────────────────────────────────────────────────
// Each handler receives the action payload and the acting userId.
// Handlers are loaded lazily to avoid circular imports.

type ActionHandler = (
  payload: Record<string, unknown>,
  userId: string,
) => Promise<Record<string, unknown>>;

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  'booking:create': async (payload, userId) => {
    const { BookingsService } = await import('./bookings.service');
    const booking = await BookingsService.createBooking({
      menteeId: userId,
      mentorId: payload.mentorId as string,
      scheduledAt: new Date(payload.scheduledAt as string),
      durationMinutes: payload.durationMinutes as number,
      topic: payload.topic as string,
      notes: payload.notes as string | undefined,
    });
    return { bookingId: booking.id, status: booking.status };
  },

  'booking:cancel': async (payload, userId) => {
    const { BookingsService } = await import('./bookings.service');
    const booking = await BookingsService.cancelBooking(
      payload.bookingId as string,
      userId,
      payload.reason as string | undefined,
    );
    return { bookingId: booking.id, status: booking.status };
  },

  'booking:reschedule': async (payload, userId) => {
    const { BookingsService } = await import('./bookings.service');
    const booking = await BookingsService.rescheduleBooking(
      payload.bookingId as string,
      userId,
      new Date(payload.newScheduledAt as string),
      payload.reason as string | undefined,
    );
    return {
      bookingId: booking.id,
      status: booking.status,
      scheduledAt: booking.scheduled_at,
    };
  },

  'review:create': async (payload, userId) => {
    const { ReviewsService } = await import('./reviews.service');
    // ReviewsService.createReview(reviewerId, { session_id, rating, comment })
    const review = await ReviewsService.createReview(userId, {
      session_id: payload.sessionId as string,
      rating: payload.rating as number,
      comment: payload.comment as string | undefined,
    });
    return { reviewId: review.id };
  },

  'note:create': async (payload, userId) => {
    const { NotesService } = await import('./notes.service');
    // NotesService.createNote(sessionId, learnerId, content)
    const note = await NotesService.createNote(
      payload.sessionId as string,
      userId,
      payload.content as string,
    );
    return { noteId: note.id };
  },

  'note:update': async (payload, userId) => {
    const { NotesService } = await import('./notes.service');
    // NotesService.updateNote(noteId, learnerId, content)
    const note = await NotesService.updateNote(
      payload.noteId as string,
      userId,
      payload.content as string,
    );
    return { noteId: note.id, updatedAt: note.updated_at };
  },

  'goal:update': async (payload, userId) => {
    const { GoalService } = await import('./goal.service');
    // GoalService.updateGoal(id, learnerId, data)
    const goal = await GoalService.updateGoal(
      payload.goalId as string,
      userId,
      payload.updates as Record<string, unknown>,
    );
    return { goalId: goal.id, updatedAt: goal.updated_at };
  },

  'profile:update': async (payload, userId) => {
    const { UsersService } = await import('./users.service');
    // UsersService.update(id, UpdateUserPayload)
    const user = await UsersService.update(userId, {
      firstName: payload.firstName as string | undefined,
      lastName: payload.lastName as string | undefined,
      bio: payload.bio as string | undefined,
      notificationPreferences: payload.notificationPreferences as
        | Record<string, Record<string, boolean>>
        | undefined,
    });
    if (!user) throw new Error('User not found');
    // Invalidate user cache after profile update
    await CacheService.del(`mm:user:${userId}`);
    return { userId: user.id, updatedAt: user.updated_at };
  },

  'message:send': async (payload, userId) => {
    const { MessagingService } = await import('./messaging.service');
    // MessagingService.sendMessage(conversationId, senderId, body)
    const message = await MessagingService.sendMessage(
      payload.conversationId as string,
      userId,
      payload.content as string,
    );
    if (!message) throw new Error('Failed to send message — conversation not found');
    return { messageId: message.id, sentAt: message.created_at };
  },
};

// ─── Conflict Detection ───────────────────────────────────────────────────────
// Returns conflict metadata if a conflict exists, null otherwise.
//
// Conflict rules:
//  - booking:cancel / booking:reschedule → booking already cancelled/completed,
//    or server updated it after the client went offline
//  - note:update  → server version is newer than client's offline snapshot
//  - profile:update → server profile updated after client's offline snapshot

async function detectConflict(
  action: EnqueueInput,
): Promise<Record<string, unknown> | null> {
  const { actionType, payload, clientTimestamp, userId } = action;
  const clientTs = new Date(clientTimestamp);

  try {
    switch (actionType) {
      case 'booking:cancel':
      case 'booking:reschedule': {
        const { rows } = await pool.query<any>(
          `SELECT status, updated_at FROM bookings WHERE id = $1`,
          [payload.bookingId],
        );
        if (!rows[0]) return null;
        const booking = rows[0];
        if (['cancelled', 'completed'].includes(booking.status)) {
          return {
            type: 'booking_state_changed',
            currentStatus: booking.status,
            serverUpdatedAt: booking.updated_at,
            message: `Booking is already ${booking.status} on the server.`,
          };
        }
        if (new Date(booking.updated_at) > clientTs) {
          return {
            type: 'stale_data',
            serverUpdatedAt: booking.updated_at,
            message: 'Booking was modified on the server after you went offline.',
          };
        }
        return null;
      }

      case 'note:update': {
        const { rows } = await pool.query<any>(
          `SELECT updated_at FROM session_notes WHERE id = $1`,
          [payload.noteId],
        );
        if (!rows[0]) return null;
        if (new Date(rows[0].updated_at) > clientTs) {
          return {
            type: 'note_modified',
            serverUpdatedAt: rows[0].updated_at,
            message: 'Note was modified on the server after you went offline.',
          };
        }
        return null;
      }

      case 'profile:update': {
        const { rows } = await pool.query<any>(
          `SELECT updated_at FROM users WHERE id = $1`,
          [userId],
        );
        if (!rows[0]) return null;
        if (new Date(rows[0].updated_at) > clientTs) {
          return {
            type: 'profile_modified',
            serverUpdatedAt: rows[0].updated_at,
            message: 'Profile was updated on the server after you went offline.',
          };
        }
        return null;
      }

      default:
        return null;
    }
  } catch (err) {
    logger.warn('OfflineQueueService: conflict detection error', {
      actionType,
      error: err,
    });
    return null; // fail open — let the action proceed
  }
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapRow(row: any): OfflineAction {
  return {
    id: row.id,
    userId: row.user_id,
    clientKey: row.client_key,
    actionType: row.action_type,
    payload: row.payload ?? {},
    status: row.status,
    clientTimestamp: new Date(row.client_timestamp),
    result: row.result ?? null,
    errorMessage: row.error_message ?? null,
    conflictData: row.conflict_data ?? null,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    createdAt: new Date(row.created_at),
    processedAt: row.processed_at ? new Date(row.processed_at) : null,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const OfflineQueueService = {
  /**
   * Persist a single offline action.
   * Idempotent: re-submitting the same clientKey returns the existing record.
   */
  async enqueue(input: EnqueueInput): Promise<OfflineAction> {
    const { userId, clientKey, actionType, payload, clientTimestamp } = input;

    const { rows } = await pool.query<any>(
      `INSERT INTO offline_action_queue
         (user_id, client_key, action_type, payload, client_timestamp)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, client_key) DO UPDATE
         SET updated_at = NOW()
       RETURNING *`,
      [userId, clientKey, actionType, JSON.stringify(payload), clientTimestamp],
    );

    return mapRow(rows[0]);
  },

  /**
   * Enqueue a batch of offline actions.
   * Returns the persisted actions sorted by client_timestamp.
   */
  async enqueueBatch(inputs: EnqueueInput[]): Promise<OfflineAction[]> {
    if (inputs.length === 0) return [];
    const results: OfflineAction[] = [];
    for (const input of inputs) {
      results.push(await this.enqueue(input));
    }
    results.sort(
      (a, b) => a.clientTimestamp.getTime() - b.clientTimestamp.getTime(),
    );
    return results;
  },

  /**
   * Process all pending actions for a user in client_timestamp order.
   */
  async processQueue(userId: string): Promise<ProcessResult[]> {
    const { rows } = await pool.query<any>(
      `SELECT * FROM offline_action_queue
       WHERE user_id = $1
         AND status IN ('pending', 'failed')
         AND attempt_count < max_attempts
       ORDER BY client_timestamp ASC`,
      [userId],
    );

    if (rows.length === 0) return [];

    const results: ProcessResult[] = [];
    for (const row of rows) {
      results.push(await this.processAction(mapRow(row)));
    }
    return results;
  },

  /**
   * Process a single queued action.
   */
  async processAction(action: OfflineAction): Promise<ProcessResult> {
    const { id, userId, clientKey, actionType, payload } = action;

    // Mark as processing
    await pool.query(
      `UPDATE offline_action_queue
       SET status = 'processing', attempt_count = attempt_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    // Conflict detection before executing
    const conflictData = await detectConflict({
      userId,
      clientKey,
      actionType,
      payload,
      clientTimestamp: action.clientTimestamp.toISOString(),
    });

    if (conflictData) {
      await pool.query(
        `UPDATE offline_action_queue
         SET status = 'conflict', conflict_data = $2, processed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id, JSON.stringify(conflictData)],
      );
      logger.info('OfflineQueueService: conflict detected', {
        userId,
        actionType,
        clientKey,
      });
      return { clientKey, status: 'conflict', conflictData };
    }

    // Execute the action
    const handler = ACTION_HANDLERS[actionType];
    if (!handler) {
      const errorMessage = `Unknown action type: ${actionType}`;
      await pool.query(
        `UPDATE offline_action_queue
         SET status = 'failed', error_message = $2, processed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id, errorMessage],
      );
      return { clientKey, status: 'failed', error: errorMessage };
    }

    try {
      const result = await handler(payload, userId);

      await pool.query(
        `UPDATE offline_action_queue
         SET status = 'completed', result = $2, processed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id, JSON.stringify(result)],
      );

      logger.info('OfflineQueueService: action completed', {
        userId,
        actionType,
        clientKey,
      });
      return { clientKey, status: 'completed', result };
    } catch (err: any) {
      const errorMessage = err?.message ?? 'Unknown error';
      const isFinal = action.attemptCount + 1 >= action.maxAttempts;

      await pool.query(
        `UPDATE offline_action_queue
         SET status = $2, error_message = $3, processed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id, isFinal ? 'failed' : 'pending', errorMessage],
      );

      logger.warn('OfflineQueueService: action failed', {
        userId,
        actionType,
        clientKey,
        error: errorMessage,
        isFinal,
      });
      return {
        clientKey,
        status: isFinal ? 'failed' : 'pending',
        error: errorMessage,
      };
    }
  },

  /**
   * Get the current queue status summary for a user.
   */
  async getQueueStatus(userId: string): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    conflict: number;
    total: number;
  }> {
    const { rows } = await pool.query<any>(
      `SELECT status, COUNT(*)::int AS count
       FROM offline_action_queue
       WHERE user_id = $1
       GROUP BY status`,
      [userId],
    );

    const counts = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      conflict: 0,
      total: 0,
    };
    for (const row of rows) {
      const key = row.status as keyof typeof counts;
      if (key in counts) counts[key] = row.count;
      counts.total += row.count;
    }
    return counts;
  },

  /**
   * Get actions for a user with optional status filter and pagination.
   */
  async getActions(
    userId: string,
    options: {
      status?: OfflineActionStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ actions: OfflineAction[]; total: number }> {
    const { status, limit = 50, offset = 0 } = options;

    const conditions = ['user_id = $1'];
    const params: unknown[] = [userId];

    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    const where = conditions.join(' AND ');

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query<any>(
        `SELECT * FROM offline_action_queue
         WHERE ${where}
         ORDER BY client_timestamp ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      pool.query<any>(
        `SELECT COUNT(*)::int AS total FROM offline_action_queue WHERE ${where}`,
        params,
      ),
    ]);

    return {
      actions: rows.map(mapRow),
      total: countRows[0]?.total ?? 0,
    };
  },

  /**
   * Resolve a conflict by choosing a resolution strategy.
   *
   * Strategies:
   *  - 'client_wins'  → re-process the action, ignoring the conflict
   *  - 'server_wins'  → discard the action, keep server state
   *  - 'merge'        → apply a client-supplied merged payload
   */
  async resolveConflict(
    userId: string,
    actionId: string,
    strategy: 'client_wins' | 'server_wins' | 'merge',
    mergedPayload?: Record<string, unknown>,
  ): Promise<ProcessResult> {
    const { rows } = await pool.query<any>(
      `SELECT * FROM offline_action_queue WHERE id = $1 AND user_id = $2`,
      [actionId, userId],
    );

    if (!rows[0]) throw new Error('Action not found');

    const action = mapRow(rows[0]);

    if (action.status !== 'conflict') {
      throw new Error(
        `Action is not in conflict state (current: ${action.status})`,
      );
    }

    if (strategy === 'server_wins') {
      await pool.query(
        `UPDATE offline_action_queue
         SET status = 'failed', error_message = 'Resolved: server_wins', updated_at = NOW()
         WHERE id = $1`,
        [actionId],
      );
      return {
        clientKey: action.clientKey,
        status: 'failed',
        error: 'Resolved: server_wins',
      };
    }

    // client_wins or merge: reset to pending with optional new payload
    const resolvedPayload =
      strategy === 'merge' && mergedPayload ? mergedPayload : action.payload;

    await pool.query(
      `UPDATE offline_action_queue
       SET status = 'pending',
           payload = $2,
           conflict_data = NULL,
           attempt_count = 0,
           updated_at = NOW()
       WHERE id = $1`,
      [actionId, JSON.stringify(resolvedPayload)],
    );

    // Re-process immediately
    const { rows: refreshed } = await pool.query<any>(
      `SELECT * FROM offline_action_queue WHERE id = $1`,
      [actionId],
    );
    return this.processAction(mapRow(refreshed[0]));
  },

  /**
   * Clean up old completed/failed actions (called by maintenance worker).
   */
  async cleanup(olderThanDays = 7): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM offline_action_queue
       WHERE status IN ('completed', 'failed')
         AND created_at < NOW() - ($1 || ' days')::INTERVAL`,
      [olderThanDays],
    );
    return rowCount ?? 0;
  },
};
