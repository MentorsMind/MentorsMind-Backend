import { redis } from "../config/redis";
import pool from "../config/database";
import { logger } from "../utils/logger.utils";

const TTL_SECONDS = 24 * 60 * 60;

export interface WebhookEventRecord {
  id: string;
  provider: string;
  eventId: string;
  eventType: string | null;
  payload: Record<string, unknown>;
  status: string;
  processedAt: Date | null;
  replayedAt: Date | null;
  replayCount: number;
  createdAt: Date;
}

export interface IdempotencyResult {
  /** True when this is a brand-new event that should be processed. */
  isDuplicate: boolean;
  /** The durable inbox record for this event. */
  record: WebhookEventRecord | null;
}

/**
 * Redis-backed inbound webhook idempotency + durable event inbox (issue #979).
 *
 * Provider events (SendGrid/Mailgun/Stripe/Stellar) are often re-delivered on
 * network retries. We track the natural event ID (sg_message_id, message-id,
 * tx hash) in Redis with a 24-hour TTL, and persist every received event to the
 * `webhook_events` inbox. Already-seen IDs short-circuit to HTTP 200, and the
 * durable inbox powers the admin replay endpoint.
 */
export const WebhookIdempotencyService = {
  /**
   * Claim a webhook event for processing.
   *
   * - Returns isDuplicate=false the first time an event is seen, atomically
   *   reserving it in Redis (SET NX, 24h TTL).
   * - Returns isDuplicate=true on re-delivery within the TTL window.
   * - Persists the event to the inbox (idempotent via UNIQUE(provider,event_id)).
   *
   * Fails open: if Redis is unavailable we still persist to the inbox and treat
   * the event as new so delivery is never lost.
   */
  async claim(
    provider: string,
    eventId: string,
    eventType: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<IdempotencyResult> {
    if (!eventId) {
      // No natural dedup key — persist but mark as fresh (cannot dedupe).
      const record = await this.persist(provider, "", eventType, payload);
      return { isDuplicate: false, record };
    }

    const key = `webhook:event:${provider}:${eventId}`;
    let isDuplicate = false;

    try {
      const claimed = await redis.set(key, "1", "EX", TTL_SECONDS, "NX");
      isDuplicate = claimed !== "OK";
      if (isDuplicate) {
        logger.info("Webhook event already processed — skipping", {
          provider,
          eventId,
        });
      }
    } catch (err) {
      // Fail open on Redis errors.
      logger.warn("Webhook idempotency Redis error — failing open", { err });
      isDuplicate = false;
    }

    const record = await this.persist(provider, eventId, eventType, payload);
    return { isDuplicate, record };
  },

  /**
   * Insert (or no-op if already present) a webhook event into the inbox.
   */
  async persist(
    provider: string,
    eventId: string,
    eventType: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<WebhookEventRecord | null> {
    try {
      const { rows } = await pool.query(
        `INSERT INTO webhook_events (provider, event_id, event_type, payload, status, processed_at)
         VALUES ($1, $2, $3, $4, 'processed', NOW())
         ON CONFLICT (provider, event_id) DO UPDATE SET
           event_type = COALESCE(EXCLUDED.event_type, webhook_events.event_type)
         RETURNING *`,
        [provider, eventId, eventType ?? null, JSON.stringify(payload)],
      );
      return rows[0] ? this.mapRow(rows[0]) : null;
    } catch (error) {
      logger.error("Failed to persist webhook event", {
        provider,
        eventId,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  },

  /**
   * Fetch a single event by id for replay.
   */
  async findById(id: string): Promise<WebhookEventRecord | null> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM webhook_events WHERE id = $1`,
        [id],
      );
      return rows[0] ? this.mapRow(rows[0]) : null;
    } catch (error) {
      logger.error("Failed to get webhook event", { id, error });
      return null;
    }
  },

  /**
   * List recorded events (admin).
   */
  async list(limit = 50, offset = 0): Promise<{ rows: WebhookEventRecord[]; total: number }> {
    try {
      const countRes = await pool.query(
        `SELECT COUNT(*)::INTEGER AS total FROM webhook_events`,
      );
      const { rows } = await pool.query(
        `SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      return { rows: rows.map((r) => this.mapRow(r)), total: countRes.rows[0]?.total ?? 0 };
    } catch (error) {
      logger.error("Failed to list webhook events", { error });
      return { rows: [], total: 0 };
    }
  },

  /**
   * Mark an event as replayed (admin replay flow). Clears the Redis claim so a
   * reprocessed event can be delivered again, then bumps the replay counters.
   */
  async markReplayed(id: string, provider: string, eventId: string): Promise<boolean> {
    try {
      if (eventId) {
        await redis.del(`webhook:event:${provider}:${eventId}`).catch(() => undefined);
      }
      const { rowCount } = await pool.query(
        `UPDATE webhook_events
         SET status = 'replayed', replayed_at = NOW(), replay_count = replay_count + 1, processed_at = NOW()
         WHERE id = $1`,
        [id],
      );
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("Failed to mark webhook event replayed", { id, error });
      return false;
    }
  },

  mapRow(row: any): WebhookEventRecord {
    return {
      id: row.id,
      provider: row.provider,
      eventId: row.event_id,
      eventType: row.event_type,
      payload: row.payload || {},
      status: row.status,
      processedAt: row.processed_at,
      replayedAt: row.replayed_at,
      replayCount: row.replay_count,
      createdAt: row.created_at,
    };
  },
};
