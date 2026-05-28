import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import axios from "axios";
import crypto from "crypto";

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

/**
 * Webhook Service for Learning Path Builder
 * Handles real-time event notifications to external systems
 */
export const WebhookService = {
  /**
   * Available webhook events
   */
  EVENTS: {
    // Enrollment events
    ENROLLMENT_CREATED: 'enrollment.created',
    ENROLLMENT_COMPLETED: 'enrollment.completed',
    ENROLLMENT_CANCELLED: 'enrollment.cancelled',
    ENROLLMENT_PAUSED: 'enrollment.paused',
    ENROLLMENT_RESUMED: 'enrollment.resumed',
    
    // Milestone events
    MILESTONE_STARTED: 'milestone.started',
    MILESTONE_COMPLETED: 'milestone.completed',
    MILESTONE_SKIPPED: 'milestone.skipped',
    
    // Progress events
    PROGRESS_UPDATED: 'progress.updated',
    PROGRESS_MILESTONE_REACHED: 'progress.milestone_reached',
    
    // Certificate events
    CERTIFICATE_ISSUED: 'certificate.issued',
    CERTIFICATE_REVOKED: 'certificate.revoked',
    
    // Session events
    SESSION_SCHEDULED: 'session.scheduled',
    SESSION_COMPLETED: 'session.completed',
    SESSION_OUTCOME_RECORDED: 'session.outcome_recorded',
    
    // Path events
    PATH_PUBLISHED: 'path.published',
    PATH_UNPUBLISHED: 'path.unpublished',
    PATH_UPDATED: 'path.updated',
    
    // Analytics events
    BOTTLENECK_DETECTED: 'analytics.bottleneck_detected',
    RISK_FACTOR_IDENTIFIED: 'analytics.risk_factor_identified',
    INTERVENTION_RECOMMENDED: 'analytics.intervention_recommended'
  } as const,

  /**
   * Create a webhook subscription
   */
  async createSubscription(
    userId: string,
    url: string,
    events: string[]
  ): Promise<WebhookSubscription> {
    try {
      // Validate URL
      try {
        new URL(url);
      } catch {
        throw new Error("Invalid webhook URL");
      }

      // Validate events
      const validEvents = Object.values(this.EVENTS);
      const invalidEvents = events.filter(e => !validEvents.includes(e as any));
      if (invalidEvents.length > 0) {
        throw new Error(`Invalid events: ${invalidEvents.join(', ')}`);
      }

      // Generate secret for signature verification
      const secret = crypto.randomBytes(32).toString('hex');

      const { rows } = await pool.query(
        `INSERT INTO webhook_subscriptions 
         (user_id, url, events, secret, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING *`,
        [userId, url, events, secret]
      );

      logger.info("Webhook subscription created", {
        userId,
        url,
        events,
        subscriptionId: rows[0].id
      });

      return this.transformSubscription(rows[0]);
    } catch (error) {
      logger.error("Failed to create webhook subscription", {
        userId,
        url,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get webhook subscriptions for a user
   */
  async getSubscriptions(userId: string): Promise<WebhookSubscription[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM webhook_subscriptions 
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [userId]
      );

      return rows.map(row => this.transformSubscription(row));
    } catch (error) {
      logger.error("Failed to get webhook subscriptions", {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update webhook subscription
   */
  async updateSubscription(
    subscriptionId: string,
    userId: string,
    updates: { url?: string; events?: string[]; isActive?: boolean }
  ): Promise<WebhookSubscription> {
    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.url) {
        setClauses.push(`url = $${paramIndex++}`);
        values.push(updates.url);
      }

      if (updates.events) {
        setClauses.push(`events = $${paramIndex++}`);
        values.push(updates.events);
      }

      if (updates.isActive !== undefined) {
        setClauses.push(`is_active = $${paramIndex++}`);
        values.push(updates.isActive);
      }

      setClauses.push(`updated_at = CURRENT_TIMESTAMP`);

      values.push(subscriptionId, userId);

      const { rows } = await pool.query(
        `UPDATE webhook_subscriptions 
         SET ${setClauses.join(', ')}
         WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
         RETURNING *`,
        values
      );

      if (rows.length === 0) {
        throw new Error("Webhook subscription not found");
      }

      logger.info("Webhook subscription updated", {
        subscriptionId,
        userId,
        updates
      });

      return this.transformSubscription(rows[0]);
    } catch (error) {
      logger.error("Failed to update webhook subscription", {
        subscriptionId,
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Delete webhook subscription
   */
  async deleteSubscription(subscriptionId: string, userId: string): Promise<void> {
    try {
      const { rowCount } = await pool.query(
        `UPDATE webhook_subscriptions 
         SET deleted_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2`,
        [subscriptionId, userId]
      );

      if (rowCount === 0) {
        throw new Error("Webhook subscription not found");
      }

      logger.info("Webhook subscription deleted", {
        subscriptionId,
        userId
      });
    } catch (error) {
      logger.error("Failed to delete webhook subscription", {
        subscriptionId,
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Trigger a webhook event
   */
  async triggerEvent(
    event: string,
    data: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const payload: WebhookEvent = {
        event,
        timestamp: new Date().toISOString(),
        data,
        metadata
      };

      // Get all active subscriptions for this event
      const { rows: subscriptions } = await pool.query(
        `SELECT * FROM webhook_subscriptions 
         WHERE is_active = true 
         AND deleted_at IS NULL
         AND $1 = ANY(events)`,
        [event]
      );

      logger.info("Triggering webhook event", {
        event,
        subscriptionCount: subscriptions.length
      });

      // Deliver to all subscriptions (async, non-blocking)
      for (const subscription of subscriptions) {
        this.deliverWebhook(subscription, payload).catch(error => {
          logger.error("Webhook delivery failed", {
            subscriptionId: subscription.id,
            event,
            error: error instanceof Error ? error.message : error
          });
        });
      }
    } catch (error) {
      logger.error("Failed to trigger webhook event", {
        event,
        error: error instanceof Error ? error.message : error
      });
      // Don't throw - webhook failures shouldn't break main flow
    }
  },

  /**
   * Deliver webhook to a subscription
   */
  async deliverWebhook(
    subscription: any,
    payload: WebhookEvent
  ): Promise<void> {
    const maxAttempts = 3;
    let attempts = 0;
    let delivered = false;
    let errorMessage = '';

    // Create delivery record
    const { rows: deliveryRows } = await pool.query(
      `INSERT INTO webhook_deliveries 
       (subscription_id, event, payload, status, attempts)
       VALUES ($1, $2, $3, 'pending', 0)
       RETURNING id`,
      [subscription.id, payload.event, JSON.stringify(payload)]
    );

    const deliveryId = deliveryRows[0].id;

    while (attempts < maxAttempts && !delivered) {
      attempts++;

      try {
        // Generate signature
        const signature = this.generateSignature(payload, subscription.secret);

        // Send webhook
        const response = await axios.post(subscription.url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': payload.event,
            'X-Webhook-Timestamp': payload.timestamp,
            'User-Agent': 'MentorsMind-Webhooks/1.0'
          },
          timeout: 10000 // 10 second timeout
        });

        if (response.status >= 200 && response.status < 300) {
          delivered = true;

          // Update delivery record
          await pool.query(
            `UPDATE webhook_deliveries 
             SET status = 'delivered', 
                 attempts = $1,
                 delivered_at = CURRENT_TIMESTAMP,
                 last_attempt_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [attempts, deliveryId]
          );

          logger.info("Webhook delivered successfully", {
            subscriptionId: subscription.id,
            event: payload.event,
            attempts
          });
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);

        logger.warn("Webhook delivery attempt failed", {
          subscriptionId: subscription.id,
          event: payload.event,
          attempt: attempts,
          error: errorMessage
        });

        // Wait before retry (exponential backoff)
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
        }
      }
    }

    // If all attempts failed, mark as failed
    if (!delivered) {
      await pool.query(
        `UPDATE webhook_deliveries 
         SET status = 'failed',
             attempts = $1,
             error_message = $2,
             last_attempt_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [attempts, errorMessage, deliveryId]
      );

      logger.error("Webhook delivery failed after all attempts", {
        subscriptionId: subscription.id,
        event: payload.event,
        attempts,
        error: errorMessage
      });
    }
  },

  /**
   * Generate HMAC signature for webhook payload
   */
  generateSignature(payload: WebhookEvent, secret: string): string {
    const payloadString = JSON.stringify(payload);
    return crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');
  },

  /**
   * Verify webhook signature
   */
  verifySignature(payload: WebhookEvent, signature: string, secret: string): boolean {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  },

  /**
   * Get webhook delivery history
   */
  async getDeliveryHistory(
    subscriptionId: string,
    userId: string,
    limit: number = 50
  ): Promise<WebhookDelivery[]> {
    try {
      const { rows } = await pool.query(
        `SELECT wd.* 
         FROM webhook_deliveries wd
         JOIN webhook_subscriptions ws ON wd.subscription_id = ws.id
         WHERE ws.id = $1 AND ws.user_id = $2
         ORDER BY wd.created_at DESC
         LIMIT $3`,
        [subscriptionId, userId, limit]
      );

      return rows.map(row => this.transformDelivery(row));
    } catch (error) {
      logger.error("Failed to get webhook delivery history", {
        subscriptionId,
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Retry failed webhook delivery
   */
  async retryDelivery(deliveryId: string, userId: string): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT wd.*, ws.* 
         FROM webhook_deliveries wd
         JOIN webhook_subscriptions ws ON wd.subscription_id = ws.id
         WHERE wd.id = $1 AND ws.user_id = $2`,
        [deliveryId, userId]
      );

      if (rows.length === 0) {
        throw new Error("Webhook delivery not found");
      }

      const delivery = rows[0];
      const payload = JSON.parse(delivery.payload);

      await this.deliverWebhook(delivery, payload);
    } catch (error) {
      logger.error("Failed to retry webhook delivery", {
        deliveryId,
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  // Helper methods
  private transformSubscription(row: any): WebhookSubscription {
    return {
      id: row.id,
      userId: row.user_id,
      url: row.url,
      events: row.events,
      secret: row.secret,
      isActive: row.is_active,
      createdAt: row.created_at
    };
  },

  private transformDelivery(row: any): WebhookDelivery {
    return {
      id: row.id,
      subscriptionId: row.subscription_id,
      event: row.event,
      payload: JSON.parse(row.payload),
      status: row.status,
      attempts: row.attempts,
      lastAttemptAt: row.last_attempt_at,
      deliveredAt: row.delivered_at,
      errorMessage: row.error_message
    };
  }
};
