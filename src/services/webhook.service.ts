import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { CacheService } from "./cache.service";
import axios from "axios";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { Queue } from "bullmq";
import { redisConnection } from "../queues/queue.config";

export interface WebhookEvent {
  event: string;
  timestamp: string;
  data: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface WebhookSubscription {
  id: string;
  userId: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  createdAt: Date;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  event: string;
  payload: any;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttemptAt?: Date;
  deliveredAt?: Date;
  errorMessage?: string;
}

export interface WebhookRecord {
  id: string;
  user_id: string;
  url: string;
  secret: string;
  secret_plain: string;
  event_types: string[];
  resource_types: string[];
  filter_statuses: string[];
  is_active: boolean;
  failure_count: number;
  disabled_at: Date | null;
  description: string | null;
  api_key: string | null;
  api_key_plain: string | null;
  api_key_grace_period_end: Date | null;
  total_deliveries: number;
  successful_deliveries: number;
  failed_deliveries: number;
  avg_response_time_ms: number | null;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  alert_sent_at: Date | null;
  last_alert_type: string | null;
  created_at: Date;
  updated_at: Date;
}

export const SUPPORTED_EVENT_TYPES = [
  'booking.created', 'booking.updated', 'booking.cancelled', 'booking.completed',
  'payment.received', 'payment.confirmed', 'payment.failed', 'payment.refunded',
  'session.scheduled', 'session.started', 'session.completed', 'session.cancelled',
  'review.created', 'review.updated',
  'user.registered', 'user.verified', 'user.onboarded',
  'mentor.certified', 'mentor.verified',
  'escrow.held', 'escrow.released', 'escrow.disputed',
  'enrollment.created', 'enrollment.completed', 'enrollment.cancelled',
  'milestone.completed',
  'progress.updated',
  'certificate.issued',
  'analytics.bottleneck_detected',
] as const;

export const SUPPORTED_RESOURCE_TYPES = ['booking', 'payment', 'session', 'review', 'user', 'mentor', 'escrow', 'enrollment', 'milestone', 'certificate'] as const;
export const SUPPORTED_FILTER_STATUSES = ['active', 'completed', 'cancelled', 'pending', 'failed', 'refunded'] as const;

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];
const ALERT_AFTER_FAILURES = 3;
const MAX_CONSECUTIVE_FAILURES = 10;

export const WebhookService = {
  EVENTS: {
    ENROLLMENT_CREATED: 'enrollment.created',
    ENROLLMENT_COMPLETED: 'enrollment.completed',
    ENROLLMENT_CANCELLED: 'enrollment.cancelled',
    ENROLLMENT_PAUSED: 'enrollment.paused',
    ENROLLMENT_RESUMED: 'enrollment.resumed',
    MILESTONE_STARTED: 'milestone.started',
    MILESTONE_COMPLETED: 'milestone.completed',
    MILESTONE_SKIPPED: 'milestone.skipped',
    PROGRESS_UPDATED: 'progress.updated',
    PROGRESS_MILESTONE_REACHED: 'progress.milestone_reached',
    CERTIFICATE_ISSUED: 'certificate.issued',
    CERTIFICATE_REVOKED: 'certificate.revoked',
    SESSION_SCHEDULED: 'session.scheduled',
    SESSION_COMPLETED: 'session.completed',
    SESSION_OUTCOME_RECORDED: 'session.outcome_recorded',
    PATH_PUBLISHED: 'path.published',
    PATH_UNPUBLISHED: 'path.unpublished',
    PATH_UPDATED: 'path.updated',
    BOTTLENECK_DETECTED: 'analytics.bottleneck_detected',
    RISK_FACTOR_IDENTIFIED: 'analytics.risk_factor_identified',
    INTERVENTION_RECOMMENDED: 'analytics.intervention_recommended',
  } as const,

  async create(
    userId: string,
    url: string,
    eventTypes: string[],
    description?: string,
    resourceTypes: string[] = [],
    filterStatuses: string[] = [],
  ): Promise<WebhookRecord & { secret_plain: string }> {
    try {
      new URL(url);
      const invalidEvents = eventTypes.filter(e => !(SUPPORTED_EVENT_TYPES as readonly string[]).includes(e));
      if (invalidEvents.length > 0) {
        throw new Error(`Invalid event types: ${invalidEvents.join(', ')}`);
      }

      const secret = crypto.randomBytes(32).toString('hex');
      const apiKey = crypto.randomBytes(48).toString('hex');

      const { rows } = await pool.query(
        `INSERT INTO webhooks (user_id, url, secret, secret_plain, event_types, resource_types, filter_statuses, is_active, description, api_key, api_key_plain)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10)
         RETURNING *`,
        [userId, url, crypto.createHash('sha256').update(secret).digest('hex'), secret, eventTypes, resourceTypes, filterStatuses, description || null, crypto.createHash('sha256').update(apiKey).digest('hex'), apiKey],
      );

      logger.info("Webhook created", { userId, webhookId: rows[0].id, url, eventTypes });
      return rows[0];
    } catch (error) {
      logger.error("Failed to create webhook", { userId, url, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async listByUser(userId: string): Promise<WebhookRecord[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM webhooks WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [userId],
      );
      return rows;
    } catch (error) {
      logger.error("Failed to list webhooks", { userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async findById(id: string, userId: string): Promise<WebhookRecord | null> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM webhooks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [id, userId],
      );
      return rows[0] || null;
    } catch (error) {
      logger.error("Failed to find webhook", { id, userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async update(
    id: string,
    userId: string,
    updates: { url?: string; eventTypes?: string[]; description?: string; resourceTypes?: string[]; filterStatuses?: string[] },
  ): Promise<WebhookRecord | null> {
    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.url) { setClauses.push(`url = $${paramIndex++}`); values.push(updates.url); }
      if (updates.eventTypes) { setClauses.push(`event_types = $${paramIndex++}`); values.push(updates.eventTypes); }
      if (updates.description !== undefined) { setClauses.push(`description = $${paramIndex++}`); values.push(updates.description); }
      if (updates.resourceTypes) { setClauses.push(`resource_types = $${paramIndex++}`); values.push(updates.resourceTypes); }
      if (updates.filterStatuses) { setClauses.push(`filter_statuses = $${paramIndex++}`); values.push(updates.filterStatuses); }

      if (setClauses.length === 0) return null;

      values.push(id, userId);
      const { rows } = await pool.query(
        `UPDATE webhooks SET ${setClauses.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex++} AND deleted_at IS NULL RETURNING *`,
        values,
      );
      if (rows.length === 0) return null;

      logger.info("Webhook updated", { id, userId });
      return rows[0];
    } catch (error) {
      logger.error("Failed to update webhook", { id, userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async delete(id: string, userId: string): Promise<boolean> {
    try {
      const { rowCount } = await pool.query(
        `UPDATE webhooks SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [id, userId],
      );
      if (rowCount && rowCount > 0) {
        logger.info("Webhook deleted", { id, userId });
        return true;
      }
      return false;
    } catch (error) {
      logger.error("Failed to delete webhook", { id, userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getDeliveries(
    webhookId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ deliveries: any[]; total: number }> {
    try {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) as total FROM webhook_deliveries wd JOIN webhooks w ON wd.webhook_id = w.id WHERE w.id = $1 AND w.user_id = $2`,
        [webhookId, userId],
      );
      const total = parseInt(countRows[0]?.total || '0', 10);

      const { rows } = await pool.query(
        `SELECT wd.* FROM webhook_deliveries wd JOIN webhooks w ON wd.webhook_id = w.id WHERE w.id = $1 AND w.user_id = $2 ORDER BY wd.created_at DESC LIMIT $3 OFFSET $4`,
        [webhookId, userId, limit, offset],
      );
      return { deliveries: rows, total };
    } catch (error) {
      logger.error("Failed to get webhook deliveries", { webhookId, userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async sendTest(webhookId: string, userId: string): Promise<any> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM webhooks WHERE id = $1 AND user_id = $2 AND is_active = true AND deleted_at IS NULL`,
        [webhookId, userId],
      );
      if (rows.length === 0) throw Object.assign(new Error("Webhook not found"), { statusCode: 404 });

      const webhook = rows[0];
      const testPayload: WebhookEvent = {
        event: 'test.ping',
        timestamp: new Date().toISOString(),
        data: { message: 'This is a test webhook event', webhookId },
      };

      const signature = this.generateSignature(testPayload, webhook.secret_plain || webhook.secret);
      const startTime = Date.now();

      const response = await axios.post(webhook.url, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': 'test.ping',
          'X-Webhook-Timestamp': testPayload.timestamp,
          'User-Agent': 'MentorsMind-Webhooks/1.0',
        },
        timeout: 10000,
      });

      const durationMs = Date.now() - startTime;

      await pool.query(
        `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status, attempt_number, response_status, response_body, duration_ms, delivered_at)
         VALUES ($1, 'test.ping', $2, 'success', 1, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [webhookId, JSON.stringify(testPayload), response.status, JSON.stringify(response.data).substring(0, 4096), durationMs],
      );

      return { status: response.status, durationMs, body: response.data };
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw Object.assign(new Error(error.message || 'Test delivery failed'), { statusCode: 502 });
    }
  },

  async rotateApiKey(webhookId: string, userId: string, gracePeriodHours: number = 24): Promise<WebhookRecord & { api_key_plain: string }> {
    try {
      const webhook = await this.findById(webhookId, userId);
      if (!webhook) throw Object.assign(new Error("Webhook not found"), { statusCode: 404 });

      const newApiKey = crypto.randomBytes(48).toString('hex');
      const graceEnd = new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000);

      const { rows } = await pool.query(
        `UPDATE webhooks SET api_key = $1, api_key_plain = $2, api_key_grace_period_end = $3 WHERE id = $4 AND user_id = $5 RETURNING *`,
        [crypto.createHash('sha256').update(newApiKey).digest('hex'), newApiKey, graceEnd, webhookId, userId],
      );

      logger.info("Webhook API key rotated", { webhookId, userId, gracePeriodHours });
      return rows[0];
    } catch (error) {
      logger.error("Failed to rotate API key", { webhookId, userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async validateApiKey(apiKey: string): Promise<WebhookRecord | null> {
    try {
      const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
      const { rows } = await pool.query(
        `SELECT * FROM webhooks WHERE (api_key = $1 OR (api_key_plain IS NOT NULL AND deleted_at IS NULL)) AND is_active = true AND deleted_at IS NULL LIMIT 1`,
        [hashedKey],
      );

      if (rows.length === 0) return null;

      const row = rows[0];

      if (row.api_key === hashedKey) return row;

      if (row.api_key_grace_period_end && new Date(row.api_key_grace_period_end) > new Date()) {
        const oldHashed = crypto.createHash('sha256').update(apiKey).digest('hex');
        if (row.api_key === oldHashed) return row;
      }

      return null;
    } catch (error) {
      logger.error("Failed to validate API key", { error: error instanceof Error ? error.message : error });
      return null;
    }
  },

  async logAuthFailure(webhookId: string | null, ip: string, userAgent: string, reason: string): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO audit_logs (level, action, message, entity_type, entity_id, ip_address, user_agent, metadata)
         VALUES ('warn', 'WEBHOOK_AUTH_FAILURE', $1, 'webhook', $2, $3, $4, $5)`,
        [reason, webhookId || 'unknown', ip, userAgent, JSON.stringify({ webhookId, reason })],
      );
    } catch (error) {
      logger.error("Failed to log webhook auth failure", { error: error instanceof Error ? error.message : error });
    }
  },

  async executeDelivery(
    deliveryId: string,
    webhookId: string,
    url: string,
    secret: string,
    payload: Record<string, unknown>,
    attemptNumber: number,
  ): Promise<void> {
    try {
      const startTime = Date.now();
      const signature = this.generateSignature(payload as WebhookEvent, secret);

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': (payload as any).event || 'unknown',
          'X-Webhook-Timestamp': (payload as any).timestamp || new Date().toISOString(),
          'User-Agent': 'MentorsMind-Webhooks/1.0',
        },
        timeout: 15000,
      });

      const durationMs = Date.now() - startTime;

      if (response.status >= 200 && response.status < 300) {
        await pool.query(
          `UPDATE webhook_deliveries SET status = 'success', attempt_number = $1, response_status = $2, response_body = $3, duration_ms = $4, delivered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
          [attemptNumber, response.status, JSON.stringify(response.data).substring(0, 4096), durationMs, deliveryId],
        );

        const wp = await pool.query(`SELECT user_id FROM webhooks WHERE id = $1`, [webhookId]);
        if (wp.rows.length > 0) {
          await pool.query(
            `UPDATE webhooks SET total_deliveries = total_deliveries + 1, successful_deliveries = successful_deliveries + 1, failure_count = 0, last_success_at = CURRENT_TIMESTAMP, avg_response_time_ms = (SELECT AVG(duration_ms) FROM webhook_deliveries WHERE webhook_id = $1 AND status = 'success' AND duration_ms IS NOT NULL) WHERE id = $1`,
            [webhookId],
          );
        }

        logger.info("Webhook delivered successfully", { deliveryId, webhookId, attemptNumber, durationMs });
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error: any) {
      const durationMs = Date.now() - Date.now() + 1;
      const errorMessage = error.message || 'Unknown error';
      const responseStatus = error.response?.status;

      await pool.query(
        `UPDATE webhook_deliveries SET status = 'failed', attempt_number = $1, response_status = $2, error_message = $3, duration_ms = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
        [attemptNumber, responseStatus || null, errorMessage.substring(0, 1024), durationMs, deliveryId],
      );

      const nextAttempt = attemptNumber + 1;

      if (nextAttempt <= RETRY_DELAYS_MS.length + 1) {
        const delayMs = RETRY_DELAYS_MS[nextAttempt - 2] || 60000;
        const nextRetryAt = new Date(Date.now() + delayMs);

        await pool.query(
          `UPDATE webhook_deliveries SET status = 'retrying', attempt_number = $1, next_retry_at = $2, error_message = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
          [attemptNumber, nextRetryAt, errorMessage.substring(0, 1024), deliveryId],
        );

        const retryQueue = new Queue('webhook-delivery-queue', { connection: redisConnection });
        await retryQueue.add(`retry-${deliveryId}-${nextAttempt}`, {
          deliveryId,
          webhookId,
          url,
          secret,
          payload,
          attemptNumber: nextAttempt,
        }, { delay: delayMs });
        await retryQueue.close();

        logger.warn("Webhook delivery failed, scheduled retry", {
          deliveryId, webhookId, attempt: attemptNumber, nextAttempt, delayMs, error: errorMessage,
        });

        if (attemptNumber >= ALERT_AFTER_FAILURES) {
          await this.sendFailureAlert(webhookId, attemptNumber);
        }
      } else {
        await pool.query(
          `UPDATE webhook_deliveries SET status = 'failed', attempt_number = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
          [attemptNumber, errorMessage.substring(0, 1024), deliveryId],
        );

        await pool.query(
          `UPDATE webhooks SET total_deliveries = total_deliveries + 1, failed_deliveries = failed_deliveries + 1, failure_count = failure_count + 1, last_failure_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [webhookId],
        );

        await this.moveToDeadLetterQueue(webhookId, deliveryId, (payload as any).event_type || 'unknown', payload, errorMessage, attemptNumber);

        const { rows } = await pool.query(`SELECT failure_count FROM webhooks WHERE id = $1`, [webhookId]);
        if (rows.length > 0 && rows[0].failure_count >= MAX_CONSECUTIVE_FAILURES) {
          await this.disableWebhook(webhookId);
        }

        logger.error("Webhook delivery failed permanently", { deliveryId, webhookId, attemptNumber, error: errorMessage });
      }
    }
  },

  async sendFailureAlert(webhookId: string, failureCount: number): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT alert_sent_at, last_alert_type FROM webhooks WHERE id = $1`,
        [webhookId],
      );
      if (rows.length === 0) return;

      const alreadySent = rows[0].alert_sent_at && rows[0].last_alert_type === `${failureCount}_consecutive_failures`;
      if (alreadySent) return;

      const { rows: webhook } = await pool.query(
        `SELECT w.*, u.email FROM webhooks w JOIN users u ON w.user_id = u.id WHERE w.id = $1`,
        [webhookId],
      );
      if (webhook.length === 0) return;

      logger.warn("Webhook failure alert", {
        webhookId,
        userId: webhook[0].user_id,
        email: webhook[0].email,
        failureCount,
        message: `Webhook has experienced ${failureCount} consecutive delivery failures.`,
      });

      await pool.query(
        `UPDATE webhooks SET alert_sent_at = CURRENT_TIMESTAMP, last_alert_type = $1 WHERE id = $2`,
        [`${failureCount}_consecutive_failures`, webhookId],
      );
    } catch (error) {
      logger.error("Failed to send webhook failure alert", { webhookId, error: error instanceof Error ? error.message : error });
    }
  },

  async moveToDeadLetterQueue(
    webhookId: string,
    deliveryId: string,
    eventType: string,
    payload: Record<string, unknown>,
    failureReason: string,
    attemptCount: number,
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO webhook_dead_letter_queue (webhook_id, delivery_id, event_type, payload, failure_reason, attempt_count, last_attempt_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [webhookId, deliveryId || null, eventType, JSON.stringify(payload), failureReason.substring(0, 1024), attemptCount],
      );
      logger.info("Webhook moved to dead letter queue", { webhookId, deliveryId, eventType });
    } catch (error) {
      logger.error("Failed to move webhook to dead letter queue", { webhookId, error: error instanceof Error ? error.message : error });
    }
  },

  async disableWebhook(webhookId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE webhooks SET is_active = false, disabled_at = CURRENT_TIMESTAMP, last_alert_type = 'webhook_disabled', alert_sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [webhookId],
      );
      logger.warn("Webhook auto-disabled after excessive failures", { webhookId });
    } catch (error) {
      logger.error("Failed to disable webhook", { webhookId, error: error instanceof Error ? error.message : error });
    }
  },

  async getDeliveryStats(userId: string): Promise<any> {
    try {
      const { rows } = await pool.query(
        `SELECT
           COUNT(*)::INTEGER AS total_webhooks,
           COUNT(*) FILTER (WHERE is_active)::INTEGER AS active_webhooks,
           COALESCE(SUM(total_deliveries), 0)::INTEGER AS total_deliveries,
           COALESCE(SUM(successful_deliveries), 0)::INTEGER AS successful_deliveries,
           COALESCE(SUM(failed_deliveries), 0)::INTEGER AS failed_deliveries,
           CASE WHEN COALESCE(SUM(total_deliveries), 0) > 0
             THEN ROUND(COALESCE(SUM(successful_deliveries), 0)::NUMERIC / NULLIF(SUM(total_deliveries), 0) * 100, 2)
             ELSE 0
           END AS success_rate
         FROM webhooks WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId],
      );
      return rows[0] || { total_webhooks: 0, active_webhooks: 0, total_deliveries: 0, successful_deliveries: 0, failed_deliveries: 0, success_rate: 0 };
    } catch (error) {
      logger.error("Failed to get webhook delivery stats", { userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getDeadLetterQueue(webhookId: string, userId: string, limit: number = 50, offset: number = 0): Promise<{ items: any[]; total: number }> {
    try {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) as total FROM webhook_dead_letter_queue dlq JOIN webhooks w ON dlq.webhook_id = w.id WHERE w.id = $1 AND w.user_id = $2`,
        [webhookId, userId],
      );
      const total = parseInt(countRows[0]?.total || '0', 10);

      const { rows } = await pool.query(
        `SELECT dlq.* FROM webhook_dead_letter_queue dlq JOIN webhooks w ON dlq.webhook_id = w.id WHERE w.id = $1 AND w.user_id = $2 ORDER BY dlq.dlq_inserted_at DESC LIMIT $3 OFFSET $4`,
        [webhookId, userId, limit, offset],
      );
      return { items: rows, total };
    } catch (error) {
      logger.error("Failed to get dead letter queue", { webhookId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async reprocessDeadLetter(dlqId: string, userId: string): Promise<boolean> {
    try {
      const { rows } = await pool.query(
        `SELECT dlq.*, w.url, w.secret_plain, w.secret, w.user_id FROM webhook_dead_letter_queue dlq JOIN webhooks w ON dlq.webhook_id = w.id WHERE dlq.id = $1 AND w.user_id = $2`,
        [dlqId, userId],
      );
      if (rows.length === 0) return false;

      const item = rows[0];
      const secret = item.secret_plain || item.secret;

      const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;

      const deliveryId = uuidv4();
      await pool.query(
        `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, attempt_number)
         VALUES ($1, $2, $3, $4, 'pending', 1)`,
        [deliveryId, item.webhook_id, item.event_type, JSON.stringify(payload)],
      );

      await pool.query(
        `UPDATE webhook_dead_letter_queue SET reprocessed = true, reprocessed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [dlqId],
      );

      this.executeDelivery(deliveryId, item.webhook_id, item.url, secret, payload, 1).catch(err => {
        logger.error("Dead letter reprocess delivery failed", { dlqId, error: err.message });
      });

      return true;
    } catch (error) {
      logger.error("Failed to reprocess dead letter", { dlqId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  generateSignature(payload: any, secret: string): string {
    const payloadString = JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
  },

  verifySignature(payload: any, signature: string, secret: string): boolean {
    const expectedSignature = this.generateSignature(payload, secret);
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  },

  async createSubscription(
    userId: string,
    url: string,
    events: string[],
  ): Promise<WebhookSubscription> {
    try {
      new URL(url);
      const validEvents = Object.values(this.EVENTS);
      const invalidEvents = events.filter(e => !validEvents.includes(e as any));
      if (invalidEvents.length > 0) {
        throw new Error(`Invalid events: ${invalidEvents.join(', ')}`);
      }

      const secret = crypto.randomBytes(32).toString('hex');

      const { rows } = await pool.query(
        `INSERT INTO webhook_subscriptions (user_id, url, events, secret, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING *`,
        [userId, url, events, secret],
      );

      logger.info("Webhook subscription created", { userId, url, events, subscriptionId: rows[0].id });
      return this.transformSubscription(rows[0]);
    } catch (error) {
      logger.error("Failed to create webhook subscription", { userId, url, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getSubscriptions(userId: string): Promise<WebhookSubscription[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM webhook_subscriptions WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [userId],
      );
      return rows.map(row => this.transformSubscription(row));
    } catch (error) {
      logger.error("Failed to get webhook subscriptions", { userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async updateSubscription(
    subscriptionId: string,
    userId: string,
    updates: { url?: string; events?: string[]; isActive?: boolean },
  ): Promise<WebhookSubscription> {
    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.url) { setClauses.push(`url = $${paramIndex++}`); values.push(updates.url); }
      if (updates.events) { setClauses.push(`events = $${paramIndex++}`); values.push(updates.events); }
      if (updates.isActive !== undefined) { setClauses.push(`is_active = $${paramIndex++}`); values.push(updates.isActive); }
      setClauses.push('updated_at = CURRENT_TIMESTAMP');

      values.push(subscriptionId, userId);
      const { rows } = await pool.query(
        `UPDATE webhook_subscriptions SET ${setClauses.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex++} RETURNING *`,
        values,
      );

      if (rows.length === 0) throw new Error("Webhook subscription not found");

      logger.info("Webhook subscription updated", { subscriptionId, userId, updates });
      return this.transformSubscription(rows[0]);
    } catch (error) {
      logger.error("Failed to update webhook subscription", { subscriptionId, userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async deleteSubscription(subscriptionId: string, userId: string): Promise<void> {
    try {
      const { rowCount } = await pool.query(
        `UPDATE webhook_subscriptions SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2`,
        [subscriptionId, userId],
      );
      if (rowCount === 0) throw new Error("Webhook subscription not found");
      logger.info("Webhook subscription deleted", { subscriptionId, userId });
    } catch (error) {
      logger.error("Failed to delete webhook subscription", { subscriptionId, userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async triggerEvent(
    event: string,
    data: Record<string, any>,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const payload: WebhookEvent = {
        event,
        timestamp: new Date().toISOString(),
        data,
        metadata,
      };

      const { rows: subscriptions } = await pool.query(
        `SELECT * FROM webhook_subscriptions WHERE is_active = true AND deleted_at IS NULL AND $1 = ANY(events)`,
        [event],
      );

      logger.info("Triggering webhook event", { event, subscriptionCount: subscriptions.length });

      for (const subscription of subscriptions) {
        this.deliverWebhook(subscription, payload).catch(error => {
          logger.error("Webhook delivery failed", { subscriptionId: subscription.id, event, error: error instanceof Error ? error.message : error });
        });
      }
    } catch (error) {
      logger.error("Failed to trigger webhook event", { event, error: error instanceof Error ? error.message : error });
    }
  },

  async deliverWebhook(subscription: any, payload: WebhookEvent): Promise<void> {
    const maxAttempts = 3;
    let attempts = 0;
    let delivered = false;
    let errorMessage = '';

    const { rows: deliveryRows } = await pool.query(
      `INSERT INTO webhook_deliveries (subscription_id, event, payload, status, attempts) VALUES ($1, $2, $3, 'pending', 0) RETURNING id`,
      [subscription.id, payload.event, JSON.stringify(payload)],
    );
    const deliveryId = deliveryRows[0].id;

    while (attempts < maxAttempts && !delivered) {
      attempts++;
      try {
        const signature = this.generateSignature(payload, subscription.secret);
        const response = await axios.post(subscription.url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': payload.event,
            'X-Webhook-Timestamp': payload.timestamp,
            'User-Agent': 'MentorsMind-Webhooks/1.0',
          },
          timeout: 10000,
        });

        if (response.status >= 200 && response.status < 300) {
          delivered = true;
          await pool.query(
            `UPDATE webhook_deliveries SET status = 'delivered', attempts = $1, delivered_at = CURRENT_TIMESTAMP, last_attempt_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [attempts, deliveryId],
          );
          logger.info("Webhook delivered successfully", { subscriptionId: subscription.id, event: payload.event, attempts });
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn("Webhook delivery attempt failed", { subscriptionId: subscription.id, event: payload.event, attempt: attempts, error: errorMessage });

        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
        }
      }
    }

    if (!delivered) {
      await pool.query(
        `UPDATE webhook_deliveries SET status = 'failed', attempts = $1, error_message = $2, last_attempt_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [attempts, errorMessage, deliveryId],
      );
      logger.error("Webhook delivery failed after all attempts", { subscriptionId: subscription.id, event: payload.event, attempts, error: errorMessage });
    }
  },

  async getDeliveryHistory(
    subscriptionId: string,
    userId: string,
    limit: number = 50,
  ): Promise<WebhookDelivery[]> {
    try {
      const { rows } = await pool.query(
        `SELECT wd.* FROM webhook_deliveries wd JOIN webhook_subscriptions ws ON wd.subscription_id = ws.id WHERE ws.id = $1 AND ws.user_id = $2 ORDER BY wd.created_at DESC LIMIT $3`,
        [subscriptionId, userId, limit],
      );
      return rows.map(row => this.transformDelivery(row));
    } catch (error) {
      logger.error("Failed to get webhook delivery history", { subscriptionId, userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async retryDelivery(deliveryId: string, userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const { rows } = await pool.query(
        `SELECT wd.*, w.user_id, w.url, w.secret_plain, w.secret FROM webhook_deliveries wd JOIN webhooks w ON wd.webhook_id = w.id WHERE wd.id = $1 AND w.user_id = $2`,
        [deliveryId, userId],
      );
      if (rows.length === 0) {
        return { success: false, message: "Webhook delivery not found" };
      }

      const delivery = rows[0];
      if (delivery.status === 'success') {
        return { success: false, message: "Delivery already succeeded" };
      }

      const maxAttempt = 6;
      if (delivery.attempt_number >= maxAttempt) {
        return { success: false, message: "Maximum retry attempts exceeded" };
      }

      const secret = delivery.secret_plain || delivery.secret;
      let payload: Record<string, unknown>;
      try {
        payload = typeof delivery.payload === 'string' ? JSON.parse(delivery.payload) : delivery.payload;
      } catch {
        return { success: false, message: "Invalid payload format" };
      }

      const nextAttempt = delivery.attempt_number + 1;
      const newDeliveryId = uuidv4();

      await pool.query(
        `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, attempt_number)
         VALUES ($1, $2, $3, $4, 'pending', 1)`,
        [newDeliveryId, delivery.webhook_id, delivery.event_type, JSON.stringify(payload)],
      );

      this.executeDelivery(newDeliveryId, delivery.webhook_id, delivery.url, secret, payload, 1).catch(err => {
        logger.error("Retry delivery failed", { deliveryId, newDeliveryId, error: err.message });
      });

      logger.info("Webhook retry scheduled", { deliveryId, newDeliveryId, attempt: nextAttempt });
      return { success: true, message: `Retry scheduled for attempt ${nextAttempt}` };
    } catch (error) {
      logger.error("Failed to retry webhook delivery", { deliveryId, userId, error: error instanceof Error ? error.message : error });
      return { success: false, message: "Internal error scheduling retry" };
    }
  },

  transformSubscription(row: any): WebhookSubscription {
    return {
      id: row.id,
      userId: row.user_id,
      url: row.url,
      events: row.events,
      secret: row.secret,
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  },

  transformDelivery(row: any): WebhookDelivery {
    return {
      id: row.id,
      subscriptionId: row.subscription_id,
      event: row.event,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      status: row.status,
      attempts: row.attempts,
      lastAttemptAt: row.last_attempt_at,
      deliveredAt: row.delivered_at,
      errorMessage: row.error_message,
    };
  },
};
