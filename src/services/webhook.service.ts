/**
 * Webhook Service
 *
 * Manages outbound webhook subscriptions and delivery orchestration.
 * - HMAC-SHA256 payload signing (X-Signature header)
 * - Retry schedule: attempt 1 → immediate, 2 → +1 min, 3 → +5 min, 4 → +30 min
 * - Auto-disable after 10 consecutive failures + owner notification
 */

import crypto from 'crypto';
import pool from '../config/database';
import { webhookQueue } from '../queues/webhook.queue';
import { logger } from '../utils/logger';
import { NotificationService } from './notification.service';
import { UsersService } from './users.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const SUPPORTED_EVENT_TYPES = [
  'booking.created',
  'booking.confirmed',
  'booking.cancelled',
  'booking.completed',
  'payment.confirmed',
  'payment.failed',
  'payment.refunded',
  'session.completed',
  'session.cancelled',
  'dispute.created',
  'dispute.resolved',
  'review.created',
] as const;

export type WebhookEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

export interface WebhookRecord {
  id: string;
  user_id: string;
  url: string;
  secret_plain: string;
  event_types: string[];
  is_active: boolean;
  failure_count: number;
  disabled_at: Date | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WebhookDeliveryRecord {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  attempt_number: number;
  next_retry_at: Date | null;
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  duration_ms: number | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Retry delays in milliseconds: 1 min, 5 min, 30 min
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000];
const MAX_CONSECUTIVE_FAILURES = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function signPayload(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const WebhookService = {
  // ── CRUD ──────────────────────────────────────────────────────────────────

  async create(
    userId: string,
    url: string,
    eventTypes: string[],
    description?: string,
  ): Promise<WebhookRecord> {
    const secret = generateSecret();

    const { rows } = await pool.query<WebhookRecord>(
      `INSERT INTO webhooks (user_id, url, secret, secret_plain, event_types, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, url, secret, secret, eventTypes, description ?? null],
    );

    return rows[0];
  },

  async listByUser(userId: string): Promise<Omit<WebhookRecord, 'secret_plain'>[]> {
    const { rows } = await pool.query(
      `SELECT id, user_id, url, event_types, is_active, failure_count,
              disabled_at, description, created_at, updated_at
       FROM webhooks
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  },

  async findById(id: string, userId: string): Promise<WebhookRecord | null> {
    const { rows } = await pool.query<WebhookRecord>(
      `SELECT * FROM webhooks WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return rows[0] ?? null;
  },

  async update(
    id: string,
    userId: string,
    updates: { url?: string; eventTypes?: string[]; description?: string },
  ): Promise<WebhookRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.url !== undefined) {
      fields.push(`url = $${idx++}`);
      values.push(updates.url);
    }
    if (updates.eventTypes !== undefined) {
      fields.push(`event_types = $${idx++}`);
      values.push(updates.eventTypes);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(updates.description);
    }

    if (fields.length === 0) return this.findById(id, userId);

    values.push(id, userId);
    const { rows } = await pool.query<WebhookRecord>(
      `UPDATE webhooks SET ${fields.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM webhooks WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  // ── Delivery history ──────────────────────────────────────────────────────

  async getDeliveries(
    webhookId: string,
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ deliveries: WebhookDeliveryRecord[]; total: number }> {
    // Verify ownership
    const webhook = await this.findById(webhookId, userId);
    if (!webhook) return { deliveries: [], total: 0 };

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query<WebhookDeliveryRecord>(
        `SELECT * FROM webhook_deliveries
         WHERE webhook_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [webhookId, limit, offset],
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM webhook_deliveries WHERE webhook_id = $1`,
        [webhookId],
      ),
    ]);

    return { deliveries: rows, total: parseInt(countRows[0].count, 10) };
  },

  // ── Dispatch ──────────────────────────────────────────────────────────────

  /**
   * Fan-out an event to all active webhooks subscribed to that event type.
   * Called by other services after significant state changes.
   */
  async dispatch(eventType: string, payload: Record<string, unknown>): Promise<void> {
    const { rows: webhooks } = await pool.query<{
      id: string;
      url: string;
      secret_plain: string;
    }>(
      `SELECT id, url, secret_plain
       FROM webhooks
       WHERE is_active = TRUE
         AND $1 = ANY(event_types)`,
      [eventType],
    );

    if (webhooks.length === 0) return;

    const envelope = {
      id: crypto.randomUUID(),
      event: eventType,
      created_at: new Date().toISOString(),
      data: payload,
    };

    await Promise.all(
      webhooks.map(async (wh) => {
        // Create a delivery record
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status, attempt_number)
           VALUES ($1, $2, $3, 'pending', 1)
           RETURNING id`,
          [wh.id, eventType, JSON.stringify(envelope)],
        );
        const deliveryId = rows[0].id;

        // Enqueue for immediate delivery
        await webhookQueue.add(
          'deliver',
          {
            deliveryId,
            webhookId: wh.id,
            url: wh.url,
            secret: wh.secret_plain,
            eventType,
            payload: envelope,
            attemptNumber: 1,
          },
          { jobId: `delivery-${deliveryId}-attempt-1` },
        );
      }),
    );
  },

  /**
   * Send a test event to a specific webhook endpoint.
   */
  async sendTest(webhookId: string, userId: string): Promise<{ deliveryId: string }> {
    const webhook = await this.findById(webhookId, userId);
    if (!webhook) throw Object.assign(new Error('Webhook not found'), { statusCode: 404 });
    if (!webhook.is_active) throw Object.assign(new Error('Webhook is disabled'), { statusCode: 400 });

    const envelope = {
      id: crypto.randomUUID(),
      event: 'test',
      created_at: new Date().toISOString(),
      data: { message: 'This is a test event from MentorsMind.' },
    };

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status, attempt_number)
       VALUES ($1, 'test', $2, 'pending', 1)
       RETURNING id`,
      [webhookId, JSON.stringify(envelope)],
    );
    const deliveryId = rows[0].id;

    await webhookQueue.add(
      'deliver',
      {
        deliveryId,
        webhookId,
        url: webhook.url,
        secret: webhook.secret_plain,
        eventType: 'test',
        payload: envelope,
        attemptNumber: 1,
      },
      { jobId: `delivery-${deliveryId}-attempt-1` },
    );

    return { deliveryId };
  },

  // ── Delivery execution (called by the job worker) ─────────────────────────

  async executeDelivery(
    deliveryId: string,
    webhookId: string,
    url: string,
    secret: string,
    payload: Record<string, unknown>,
    attemptNumber: number,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = signPayload(secret, body);
    const startMs = Date.now();

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;
    let success = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10 s timeout

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Webhook-Event': (payload as any).event ?? 'unknown',
          'X-Delivery-Id': deliveryId,
          'User-Agent': 'MentorsMind-Webhooks/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      responseStatus = response.status;
      const rawBody = await response.text();
      responseBody = rawBody.slice(0, 4096); // cap at 4 KB
      success = response.ok;
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - startMs;

    if (success) {
      await pool.query(
        `UPDATE webhook_deliveries
         SET status = 'success', response_status = $1, response_body = $2,
             duration_ms = $3, delivered_at = NOW()
         WHERE id = $4`,
        [responseStatus, responseBody, durationMs, deliveryId],
      );
      // Reset consecutive failure counter on success
      await pool.query(
        `UPDATE webhooks SET failure_count = 0 WHERE id = $1`,
        [webhookId],
      );
      return;
    }

    // ── Delivery failed ──────────────────────────────────────────────────────
    const nextAttempt = attemptNumber + 1;
    const delayMs = RETRY_DELAYS_MS[attemptNumber - 1]; // index 0 = after attempt 1

    if (delayMs !== undefined) {
      // Schedule retry
      const nextRetryAt = new Date(Date.now() + delayMs);
      await pool.query(
        `UPDATE webhook_deliveries
         SET status = 'retrying', response_status = $1, response_body = $2,
             error_message = $3, duration_ms = $4, next_retry_at = $5,
             attempt_number = $6
         WHERE id = $7`,
        [responseStatus, responseBody, errorMessage, durationMs, nextRetryAt, attemptNumber, deliveryId],
      );

      await webhookQueue.add(
        'deliver',
        {
          deliveryId,
          webhookId,
          url,
          secret,
          eventType: (payload as any).event ?? 'unknown',
          payload,
          attemptNumber: nextAttempt,
        },
        {
          jobId: `delivery-${deliveryId}-attempt-${nextAttempt}`,
          delay: delayMs,
        },
      );

      logger.warn('Webhook delivery failed, scheduled retry', {
        deliveryId,
        webhookId,
        attempt: attemptNumber,
        nextAttempt,
        delayMs,
        responseStatus,
        errorMessage,
      });
    } else {
      // All retries exhausted — mark permanently failed
      await pool.query(
        `UPDATE webhook_deliveries
         SET status = 'failed', response_status = $1, response_body = $2,
             error_message = $3, duration_ms = $4
         WHERE id = $5`,
        [responseStatus, responseBody, errorMessage, durationMs, deliveryId],
      );

      // Increment consecutive failure counter
      const { rows } = await pool.query<{ failure_count: number; user_id: string; is_active: boolean }>(
        `UPDATE webhooks
         SET failure_count = failure_count + 1
         WHERE id = $1
         RETURNING failure_count, user_id, is_active`,
        [webhookId],
      );

      const wh = rows[0];
      if (!wh) return;

      if (wh.is_active && wh.failure_count >= MAX_CONSECUTIVE_FAILURES) {
        await this.disableWebhook(webhookId, wh.user_id);
      }

      logger.error('Webhook delivery permanently failed', {
        deliveryId,
        webhookId,
        totalAttempts: attemptNumber,
        responseStatus,
        errorMessage,
      });
    }
  },

  // ── Internal helpers ──────────────────────────────────────────────────────

  async disableWebhook(webhookId: string, userId: string): Promise<void> {
    await pool.query(
      `UPDATE webhooks SET is_active = FALSE, disabled_at = NOW() WHERE id = $1`,
      [webhookId],
    );

    logger.warn('Webhook auto-disabled after consecutive failures', { webhookId, userId });

    // Notify the owner
    try {
      const user = await UsersService.findById(userId);
      if (user) {
        await NotificationService.createInAppNotification(
          userId,
          'system_alert',
          'Webhook Disabled',
          `Your webhook has been automatically disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive delivery failures. Please check your endpoint and re-enable it.`,
          { webhookId },
        );
      }
    } catch (err) {
      logger.error('Failed to notify user of webhook disable', { err, webhookId, userId });
    }
  },
};
