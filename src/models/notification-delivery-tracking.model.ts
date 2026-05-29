import pool from '../config/database';
import { logger } from '../utils/logger';

export interface NotificationDeliveryTrackingRecord {
  id: string;
  notification_id: string;
  status: DeliveryStatus;
  channel: string;
  provider?: string;
  external_id?: string;
  error_message?: string;
  metadata: Record<string, any>;
  created_at: Date;
}

export interface NotificationDeliveryTrackingInput {
  notification_id: string;
  status: DeliveryStatus;
  channel: string;
  provider?: string;
  external_id?: string;
  error_message?: string;
  metadata?: Record<string, any>;
}

export enum DeliveryStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  BOUNCED = 'bounced',
  OPENED = 'opened',
  CLICKED = 'clicked'
}

/**
 * Notification Delivery Tracking Model for monitoring notification delivery status
 */
export const NotificationDeliveryTrackingModel = {
  /**
   * Initialize the notification_delivery_tracking table
   */
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS notification_delivery_tracking (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL,
        channel VARCHAR(20) NOT NULL,
        provider VARCHAR(50),
        external_id VARCHAR(255),
        error_message TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_delivery_tracking_notification_id ON notification_delivery_tracking(notification_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_tracking_status ON notification_delivery_tracking(status);
      CREATE INDEX IF NOT EXISTS idx_delivery_tracking_created_at ON notification_delivery_tracking(created_at);
    `;
    await pool.query(query);
  },

  /**
   * Create a new delivery tracking record
   */
  async create(input: NotificationDeliveryTrackingInput): Promise<NotificationDeliveryTrackingRecord | null> {
    const query = `
      INSERT INTO notification_delivery_tracking (
        notification_id, status, channel, provider, external_id, error_message, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;

    const values = [
      input.notification_id,
      input.status,
      input.channel,
      input.provider,
      input.external_id,
      input.error_message,
      JSON.stringify(input.metadata || {}),
    ];

    try {
      const { rows } = await pool.query<NotificationDeliveryTrackingRecord>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to create delivery tracking record:', error);
      return null;
    }
  },

  /**
   * Get delivery history for a notification
   */
  async getByNotificationId(notificationId: string): Promise<NotificationDeliveryTrackingRecord[]> {
    const query = `
      SELECT * FROM notification_delivery_tracking
      WHERE notification_id = $1
      ORDER BY created_at ASC;
    `;

    try {
      const { rows } = await pool.query<NotificationDeliveryTrackingRecord>(query, [notificationId]);
      return rows;
    } catch (error) {
      logger.error('Failed to get delivery tracking records:', error);
      return [];
    }
  },

  /**
   * Get latest delivery status for a notification
   */
  async getLatestStatus(notificationId: string): Promise<NotificationDeliveryTrackingRecord | null> {
    const query = `
      SELECT * FROM notification_delivery_tracking
      WHERE notification_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    try {
      const { rows } = await pool.query<NotificationDeliveryTrackingRecord>(query, [notificationId]);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to get latest delivery status:', error);
      return null;
    }
  },

  /**
   * Get delivery statistics for a date range
   */
  async getDeliveryStats(
    startDate: Date,
    endDate: Date,
    channel?: string
  ): Promise<{ status: string; count: number }[]> {
    let query = `
      SELECT status, COUNT(*) as count
      FROM notification_delivery_tracking
      WHERE created_at >= $1 AND created_at <= $2
    `;
    const values: any[] = [startDate, endDate];

    if (channel) {
      query += ` AND channel = $3`;
      values.push(channel);
    }

    query += ` GROUP BY status ORDER BY count DESC;`;

    try {
      const { rows } = await pool.query(query, values);
      return rows.map(row => ({
        status: row.status,
        count: parseInt(row.count, 10),
      }));
    } catch (error) {
      logger.error('Failed to get delivery statistics:', error);
      return [];
    }
  },

  /**
   * Get failed deliveries for retry processing
   */
  async getFailedDeliveries(
    limit: number = 100,
    olderThan?: Date
  ): Promise<NotificationDeliveryTrackingRecord[]> {
    let query = `
      SELECT DISTINCT ON (notification_id) *
      FROM notification_delivery_tracking
      WHERE status = 'failed'
    `;
    const values: any[] = [];

    if (olderThan) {
      query += ` AND created_at < $1`;
      values.push(olderThan);
    }

    query += ` ORDER BY notification_id, created_at DESC LIMIT $${values.length + 1};`;
    values.push(limit);

    try {
      const { rows } = await pool.query<NotificationDeliveryTrackingRecord>(query, values);
      return rows;
    } catch (error) {
      logger.error('Failed to get failed deliveries:', error);
      return [];
    }
  },

  /**
   * Update delivery status with external provider information
   */
  async updateStatus(
    notificationId: string,
    status: DeliveryStatus,
    externalId?: string,
    errorMessage?: string,
    metadata?: Record<string, any>
  ): Promise<NotificationDeliveryTrackingRecord | null> {
    const query = `
      INSERT INTO notification_delivery_tracking (
        notification_id, status, channel, external_id, error_message, metadata
      )
      SELECT $1, $2, channel, $3, $4, $5
      FROM notification_delivery_tracking
      WHERE notification_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      RETURNING *;
    `;

    const values = [
      notificationId,
      status,
      externalId,
      errorMessage,
      JSON.stringify(metadata || {}),
    ];

    try {
      const { rows } = await pool.query<NotificationDeliveryTrackingRecord>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to update delivery status:', error);
      return null;
    }
  },
};