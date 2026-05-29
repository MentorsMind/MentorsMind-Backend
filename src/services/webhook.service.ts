/**
 * Webhook Service
 *
 * Manages outbound webhook subscriptions and delivery orchestration.
 * - HMAC-SHA256 payload signing (X-Signature header)
 * - Retry schedule: attempt 1 → immediate, 2 → +1 min, 3 → +5 min, 4 → +30 min
 * - Auto-disable after 10 consecutive failures + owner notification
 * - Subscription filters: resource_types and filter_statuses narrow delivery
 * - AES-256-GCM encryption for API keys and secrets at rest
 */

import crypto from 'crypto';
import pool from '../config/database';
import { webhookQueue } from '../queues/webhook.queue';
import { logger } from '../utils/logger';
import { NotificationService } from './notification.service';
import { UsersService } from './users.service';
import { EncryptionUtil } from '../utils/encryption.utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const SUPPORTED_EVENT_TYPES = [
  // Booking lifecycle
  'booking.created',
  'booking.confirmed',
  'booking.cancelled',
  'booking.completed',
  'booking.rescheduled',
  // Payment lifecycle
  'payment.created',
  'payment.confirmed',
  'payment.failed',
  'payment.refunded',
  'payment.pending',
  // Session lifecycle
  'session.started',
  'session.completed',
  'session.cancelled',
  'session.no_show',
  // Dispute lifecycle
  'dispute.opened',
  'dispute.created',
  'dispute.resolved',
  'dispute.escalated',
  // Review lifecycle
  'review.created',
  'review.updated',
  // User lifecycle
  'user.verified',
  'user.suspended',
] as const;

export type WebhookEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

/** Resource types that can appear in webhook payloads */
export const SUPPORTED_RESOURCE_TYPES = [
  'booking',
  'payment',
  'session',
  'dispute',
  'review',
  'user',
] as const;

export type WebhookResourceType = (typeof SUPPORTED_RESOURCE_TYPES)[number];

/** Status values that can be used as subscription filters */
export const SUPPORTED_FILTER_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'rescheduled',
  'no_show',
  'created',
  'failed',
  'refunded',
  'opened',
  'resolved',
  'escalated',
  'verified',
  'suspended',
] as const;

export type WebhookFilterStatus = (typeof SUPPORTED_FILTER_STATUSES)[number];

export interface WebhookRecord {
  id: string;
  user_id: string;
  url: string;
  secret_plain: string;
  api_key_hash?: string;
  api_key_plain?: string;
  api_key_last_used_at?: Date | null;
  api_key_expires_at?: Date | null;
  api_key_grace_period_end?: Date | null;
  event_types: string[];
  resource_types: string[];
  filter_statuses: string[];
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

// Retry delays in milliseconds: 1 min, 5 min, 30 min, 2 hours, 8 hours (5 retries over ~11 hours)
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];
const MAX_CONSECUTIVE_FAILURES = 10;
const ALERT_AFTER_FAILURES = 3; // Alert after 3 consecutive failures

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateApiKey(): { plain: string; hashed: string } {
  const plain = `whk_${crypto.randomBytes(24).toString('hex')}`;
  const hashed = crypto.createHash('sha256').update(plain).digest('hex');
  return { plain, hashed };
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
    resourceTypes: string[] = [],
    filterStatuses: string[] = [],
  ): Promise<WebhookRecord> {
    const secret = generateSecret();
    const { rows } = await pool.query<WebhookRecord>(
      `INSERT INTO webhooks
         (user_id, url, secret, secret_plain, event_types, description, resource_types, filter_statuses)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, url, secret, secret, eventTypes, description ?? null, resourceTypes, filterStatuses],
    const secretPlain = generateSecret();
    const secretHash = crypto.createHash('sha256').update(secretPlain).digest('hex');
    const { plain: apiKeyPlain, hashed: apiKeyHash } = generateApiKey();

    // Encrypt API key and secret at rest
    const apiKeyEncrypted = await EncryptionUtil.encrypt(apiKeyPlain);
    const secretEncrypted = await EncryptionUtil.encrypt(secretPlain);
    const encryptionVersion = await EncryptionUtil.getCurrentKeyVersion();

    const { rows } = await pool.query<WebhookRecord>(
      `INSERT INTO webhooks (user_id, url, secret, secret_plain, secret_encrypted, event_types, description, api_key_hash, api_key_plain, api_key_encrypted, api_key_encryption_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [userId, url, secretHash, secretPlain, secretEncrypted, eventTypes, description ?? null, apiKeyHash, apiKeyPlain, apiKeyEncrypted, encryptionVersion],
    );
    return rows[0];
  },

  async listByUser(userId: string): Promise<Omit<WebhookRecord, 'secret_plain'>[]> {
    const { rows } = await pool.query(
      `SELECT id, user_id, url, event_types, resource_types, filter_statuses,
              is_active, failure_count, disabled_at, description, created_at, updated_at
       FROM webhooks
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  },

  async findById(id: string, userId: string): Promise<WebhookRecord | null> {
    const { rows } = await pool.query<WebhookRecord>(
      'SELECT * FROM webhooks WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows[0] ?? null;
  },

  async update(
    id: string,
    userId: string,
    updates: {
      url?: string;
      eventTypes?: string[];
      description?: string;
      resourceTypes?: string[];
      filterStatuses?: string[];
    },
  ): Promise<WebhookRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const push = (col: string, val: unknown) => {
      fields.push(col + ' = $' + idx++);
      values.push(val);
    };

    if (updates.url !== undefined)           push('url', updates.url);
    if (updates.eventTypes !== undefined)    push('event_types', updates.eventTypes);
    if (updates.description !== undefined)   push('description', updates.description);
    if (updates.resourceTypes !== undefined) push('resource_types', updates.resourceTypes);
    if (updates.filterStatuses !== undefined) push('filter_statuses', updates.filterStatuses);

    if (fields.length === 0) return this.findById(id, userId);

    values.push(id, userId);
    const { rows } = await pool.query<WebhookRecord>(
      'UPDATE webhooks SET ' + fields.join(', ') +
      ' WHERE id = $' + idx++ + ' AND user_id = $' + idx +
      ' RETURNING *',
      values,
    );
    return rows[0] ?? null;
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM webhooks WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  // ── API Key Management ────────────────────────────────────────────────────

  async rotateApiKey(id: string, userId: string, gracePeriodHours = 24): Promise<WebhookRecord | null> {
    const { plain: newPlain, hashed: newHash } = generateApiKey();
    const gracePeriodEnd = new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000);

    // Encrypt new API key at rest
    const apiKeyEncrypted = await EncryptionUtil.encrypt(newPlain);
    const encryptionVersion = await EncryptionUtil.getCurrentKeyVersion();

    const { rows } = await pool.query<WebhookRecord>(
      `UPDATE webhooks
       SET api_key_hash = $1,
           api_key_plain = $2,
           api_key_encrypted = $3,
           api_key_encryption_version = $4,
           api_key_grace_period_end = $5,
           updated_at = NOW()
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [newHash, newPlain, apiKeyEncrypted, encryptionVersion, gracePeriodEnd, id, userId],
    );

    return rows[0] ?? null;
  },

  async validateApiKey(plainKey: string): Promise<WebhookRecord | null> {
    const hash = crypto.createHash('sha256').update(plainKey).digest('hex');

    const { rows } = await pool.query<WebhookRecord>(
      `SELECT * FROM webhooks
       WHERE api_key_hash = $1
         AND is_active = TRUE
         AND (api_key_expires_at IS NULL OR api_key_expires_at > NOW())`,
      [hash],
    );

    const webhook = rows[0];
    if (webhook) {
      // Update last used
      await pool.query(
        `UPDATE webhooks SET api_key_last_used_at = NOW() WHERE id = $1`,
        [webhook.id],
      );
    }

    return webhook ?? null;
  },

  async logAuthFailure(webhookId: string | null, ip: string, userAgent: string, error: string): Promise<void> {
    await pool.query(
      `INSERT INTO webhook_auth_failures (webhook_id, ip_address, user_agent, error_message)
       VALUES ($1, $2, $3, $4)`,
      [webhookId, ip, userAgent, error],
    );
    logger.warn('Webhook auth failure logged', { webhookId, ip, error });
  },

  // ── Delivery history ──────────────────────────────────────────────────────

  async getDeliveries(
    webhookId: string,
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ deliveries: WebhookDeliveryRecord[]; total: number }> {
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
        'SELECT COUNT(*) AS count FROM webhook_deliveries WHERE webhook_id = $1',
        [webhookId],
      ),
    ]);

    return { deliveries: rows, total: parseInt(countRows[0].count, 10) };
  },

  // ── Dispatch ──────────────────────────────────────────────────────────────

  /**
   * Fan-out an event to all active webhooks subscribed to that event type.
   * Respects resource_types and filter_statuses subscription filters when provided.
   *
   * @param eventType  - e.g. 'payment.created'
   * @param payload    - event data; should include `resource_type` and `status` for filtering
   */
  async dispatch(eventType: string, payload: Record<string, unknown>): Promise<void> {
    const resourceType = payload.resource_type as string | undefined;
    const status       = payload.status as string | undefined;

    // Fetch webhooks subscribed to this event type, then apply optional filters:
    //   resource_types: empty array means "all", otherwise must contain the event's resource type
    //   filter_statuses: empty array means "all", otherwise must contain the event's status
    const { rows: webhooks } = await pool.query<{
      id: string;
      url: string;
      secret_plain: string;
    }>(
      `SELECT id, url, secret_plain
       FROM webhooks
       WHERE is_active = TRUE
         AND $1 = ANY(event_types)
         AND (array_length(resource_types, 1) IS NULL OR $2 = ANY(resource_types))
         AND (array_length(filter_statuses, 1) IS NULL OR $3 = ANY(filter_statuses))`,
      [eventType, resourceType ?? null, status ?? null],
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
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status, attempt_number)
           VALUES ($1, $2, $3, 'pending', 1)
           RETURNING id`,
          [wh.id, eventType, JSON.stringify(envelope)],
        );
        const deliveryId = rows[0].id;

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

    // Decrypt secret if encrypted version exists
    const secretPlain = webhook.secret_encrypted
      ? (await EncryptionUtil.decrypt(webhook.secret_encrypted)) ?? webhook.secret_plain
      : webhook.secret_plain;

    await webhookQueue.add(
      'deliver',
      {
        deliveryId,
        webhookId,
        url: webhook.url,
        secret: secretPlain,
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
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Webhook-Event': (payload as Record<string, string>).event ?? 'unknown',
          'X-Delivery-Id': deliveryId,
          'User-Agent': 'MentorsMind-Webhooks/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      responseStatus = response.status;
      const rawBody = await response.text();
      responseBody = rawBody.slice(0, 4096);
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
      await pool.query('UPDATE webhooks SET failure_count = 0 WHERE id = $1', [webhookId]);
      return;
    }

    const nextAttempt = attemptNumber + 1;
    const delayMs = RETRY_DELAYS_MS[attemptNumber - 1];

    if (delayMs !== undefined) {
      const nextRetryAt = new Date(Date.now() + delayMs);
      await pool.query(
        `UPDATE webhook_deliveries
         SET status = 'retrying', response_status = $1, response_body = $2,
             error_message = $3, duration_ms = $4, next_retry_at = $5, attempt_number = $6
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
          eventType: (payload as Record<string, string>).event ?? 'unknown',
          payload,
          attemptNumber: nextAttempt,
        },
        { jobId: `delivery-${deliveryId}-attempt-${nextAttempt}`, delay: delayMs },
      );

      logger.warn('Webhook delivery failed, scheduled retry', {
        deliveryId, webhookId, attempt: attemptNumber, nextAttempt, delayMs, responseStatus, errorMessage,
      });
    } else {
      await pool.query(
        `UPDATE webhook_deliveries
         SET status = 'failed', response_status = $1, response_body = $2,
             error_message = $3, duration_ms = $4
         WHERE id = $5`,
        [responseStatus, responseBody, errorMessage, durationMs, deliveryId],
      );

      const { rows } = await pool.query<{ failure_count: number; user_id: string; is_active: boolean }>(
        `UPDATE webhooks SET failure_count = failure_count + 1
      // Increment consecutive failure counter
      const { rows } = await pool.query<{ failure_count: number; user_id: string; is_active: boolean; alert_sent_at: Date | null }>(
        `UPDATE webhooks
         SET failure_count = failure_count + 1
         WHERE id = $1
         RETURNING failure_count, user_id, is_active, alert_sent_at`,
        [webhookId],
      );

      const wh = rows[0];
      if (!wh) return;

      // Alert after 3 consecutive failures (if not already alerted)
      if (wh.failure_count >= ALERT_AFTER_FAILURES && !wh.alert_sent_at) {
        await this.sendFailureAlert(webhookId, wh.user_id, wh.failure_count);
      }

      // Disable after max consecutive failures
      if (wh.is_active && wh.failure_count >= MAX_CONSECUTIVE_FAILURES) {
        await this.disableWebhook(webhookId, wh.user_id);
      }

      logger.error('Webhook delivery permanently failed', {
        deliveryId, webhookId, totalAttempts: attemptNumber, responseStatus, errorMessage,
      });
    }
  },

  // ── Internal helpers ──────────────────────────────────────────────────────

  async disableWebhook(webhookId: string, userId: string): Promise<void> {
    await pool.query(
      'UPDATE webhooks SET is_active = FALSE, disabled_at = NOW() WHERE id = $1',
      `UPDATE webhooks SET is_active = FALSE, disabled_at = NOW(), last_alert_type = 'webhook_disabled' WHERE id = $1`,
      [webhookId],
    );
    logger.warn('Webhook auto-disabled after consecutive failures', { webhookId, userId });

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

  async sendFailureAlert(webhookId: string, userId: string, failureCount: number): Promise<void> {
    // Mark alert as sent
    await pool.query(
      `UPDATE webhooks SET alert_sent_at = NOW(), last_alert_type = '3_consecutive_failures' WHERE id = $1`,
      [webhookId],
    );

    logger.warn('Webhook failure alert triggered', { webhookId, userId, failureCount });

    // Notify the owner
    try {
      const user = await UsersService.findById(userId);
      if (user) {
        await NotificationService.createInAppNotification(
          userId,
          'system_alert',
          'Webhook Delivery Failures',
          `Your webhook has experienced ${failureCount} consecutive delivery failures. Please check your endpoint. After ${MAX_CONSECUTIVE_FAILURES} failures, the webhook will be automatically disabled.`,
          { webhookId, failureCount },
        );
      }
    } catch (err) {
      logger.error('Failed to notify user of webhook failures', { err, webhookId, userId });
    }
  },

  /**
   * Manually retry a failed webhook delivery
   */
  async retryDelivery(deliveryId: string, userId: string): Promise<{ success: boolean; message: string }> {
    // Get the delivery record
    const { rows: deliveries } = await pool.query<WebhookDeliveryRecord>(
      `SELECT wd.*, w.user_id, w.url, w.secret_plain
       FROM webhook_deliveries wd
       JOIN webhooks w ON wd.webhook_id = w.id
       WHERE wd.id = $1`,
      [deliveryId],
    );

    const delivery = deliveries[0];
    if (!delivery) {
      return { success: false, message: 'Delivery not found' };
    }

    // Check ownership (admin or webhook owner)
    // For now, we'll allow any authenticated user to retry (admin should check authorization)
    // In production, add proper admin authorization check

    // Check if delivery can be retried
    if (delivery.status === 'success') {
      return { success: false, message: 'Delivery already succeeded' };
    }

    if (delivery.status === 'retrying') {
      return { success: false, message: 'Delivery is already scheduled for retry' };
    }

    // Calculate next attempt number
    const nextAttempt = (delivery.attempt_number || 0) + 1;

    // Check if max retries exceeded
    if (nextAttempt > RETRY_DELAYS_MS.length + 1) {
      return { success: false, message: 'Maximum retry attempts exceeded' };
    }

    // Get retry delay
    const delayMs = RETRY_DELAYS_MS[nextAttempt - 2] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    const nextRetryAt = new Date(Date.now() + delayMs);

    // Update delivery record
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = 'retrying', attempt_number = $1, next_retry_at = $2, updated_at = NOW()
       WHERE id = $3`,
      [nextAttempt, nextRetryAt, deliveryId],
    );

    // Enqueue for retry
    await webhookQueue.add(
      'deliver',
      {
        deliveryId,
        webhookId: delivery.webhook_id,
        url: delivery.url,
        secret: delivery.secret_plain,
        eventType: delivery.event_type,
        payload: delivery.payload,
        attemptNumber: nextAttempt,
      },
      {
        jobId: `delivery-${deliveryId}-attempt-${nextAttempt}-manual`,
        delay: delayMs,
      },
    );

    logger.info('Webhook delivery manually retried', {
      deliveryId,
      webhookId: delivery.webhook_id,
      attempt: nextAttempt,
      delayMs,
    });

    return { success: true, message: `Retry scheduled for attempt ${nextAttempt}` };
  },
};
