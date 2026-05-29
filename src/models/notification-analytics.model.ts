import pool from '../config/database';
import { logger } from '../utils/logger';

export interface NotificationAnalyticsRecord {
  id: string;
  date: Date;
  notification_type: string;
  channel: string;
  total_sent: number;
  total_delivered: number;
  total_failed: number;
  total_opened: number;
  total_clicked: number;
  created_at: Date;
}

export interface NotificationAnalyticsInput {
  date: Date;
  notification_type: string;
  channel: string;
  total_sent?: number;
  total_delivered?: number;
  total_failed?: number;
  total_opened?: number;
  total_clicked?: number;
}

export interface AnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  notificationType?: string;
  channel?: string;
}

export interface AnalyticsStats {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  totalOpened: number;
  totalClicked: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
}

/**
 * Notification Analytics Model for tracking notification metrics and performance
 */
export const NotificationAnalyticsModel = {
  /**
   * Initialize the notification_analytics table
   */
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS notification_analytics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        notification_type VARCHAR(50) NOT NULL,
        channel VARCHAR(20) NOT NULL,
        total_sent INTEGER DEFAULT 0,
        total_delivered INTEGER DEFAULT 0,
        total_failed INTEGER DEFAULT 0,
        total_opened INTEGER DEFAULT 0,
        total_clicked INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_analytics_unique 
        ON notification_analytics(date, notification_type, channel);
      CREATE INDEX IF NOT EXISTS idx_notification_analytics_date ON notification_analytics(date);
    `;
    await pool.query(query);
  },

  /**
   * Upsert analytics data for a specific date, type, and channel
   */
  async upsert(input: NotificationAnalyticsInput): Promise<NotificationAnalyticsRecord | null> {
    const query = `
      INSERT INTO notification_analytics (
        date, notification_type, channel, total_sent, total_delivered, 
        total_failed, total_opened, total_clicked
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (date, notification_type, channel)
      DO UPDATE SET
        total_sent = notification_analytics.total_sent + COALESCE($4, 0),
        total_delivered = notification_analytics.total_delivered + COALESCE($5, 0),
        total_failed = notification_analytics.total_failed + COALESCE($6, 0),
        total_opened = notification_analytics.total_opened + COALESCE($7, 0),
        total_clicked = notification_analytics.total_clicked + COALESCE($8, 0)
      RETURNING *;
    `;

    const values = [
      input.date,
      input.notification_type,
      input.channel,
      input.total_sent || 0,
      input.total_delivered || 0,
      input.total_failed || 0,
      input.total_opened || 0,
      input.total_clicked || 0,
    ];

    try {
      const { rows } = await pool.query<NotificationAnalyticsRecord>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to upsert notification analytics:', error);
      return null;
    }
  },

  /**
   * Increment a specific metric for a date, type, and channel
   */
  async incrementMetric(
    date: Date,
    notificationType: string,
    channel: string,
    metric: 'sent' | 'delivered' | 'failed' | 'opened' | 'clicked',
    count: number = 1
  ): Promise<boolean> {
    const metricColumn = `total_${metric}`;
    const query = `
      INSERT INTO notification_analytics (date, notification_type, channel, ${metricColumn})
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (date, notification_type, channel)
      DO UPDATE SET ${metricColumn} = notification_analytics.${metricColumn} + $4
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [date, notificationType, channel, count]);
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to increment analytics metric:', error);
      return false;
    }
  },

  /**
   * Get analytics data with filters
   */
  async getAnalytics(filters: AnalyticsFilters): Promise<NotificationAnalyticsRecord[]> {
    let query = `
      SELECT * FROM notification_analytics
      WHERE 1=1
    `;
    const values: any[] = [];
    let paramCount = 1;

    if (filters.startDate) {
      query += ` AND date >= $${paramCount++}`;
      values.push(filters.startDate);
    }

    if (filters.endDate) {
      query += ` AND date <= $${paramCount++}`;
      values.push(filters.endDate);
    }

    if (filters.notificationType) {
      query += ` AND notification_type = $${paramCount++}`;
      values.push(filters.notificationType);
    }

    if (filters.channel) {
      query += ` AND channel = $${paramCount++}`;
      values.push(filters.channel);
    }

    query += ` ORDER BY date DESC, notification_type, channel;`;

    try {
      const { rows } = await pool.query<NotificationAnalyticsRecord>(query, values);
      return rows;
    } catch (error) {
      logger.error('Failed to get analytics data:', error);
      return [];
    }
  },

  /**
   * Get aggregated analytics statistics
   */
  async getAggregatedStats(filters: AnalyticsFilters): Promise<AnalyticsStats> {
    let query = `
      SELECT 
        SUM(total_sent) as total_sent,
        SUM(total_delivered) as total_delivered,
        SUM(total_failed) as total_failed,
        SUM(total_opened) as total_opened,
        SUM(total_clicked) as total_clicked
      FROM notification_analytics
      WHERE 1=1
    `;
    const values: any[] = [];
    let paramCount = 1;

    if (filters.startDate) {
      query += ` AND date >= $${paramCount++}`;
      values.push(filters.startDate);
    }

    if (filters.endDate) {
      query += ` AND date <= $${paramCount++}`;
      values.push(filters.endDate);
    }

    if (filters.notificationType) {
      query += ` AND notification_type = $${paramCount++}`;
      values.push(filters.notificationType);
    }

    if (filters.channel) {
      query += ` AND channel = $${paramCount++}`;
      values.push(filters.channel);
    }

    try {
      const { rows } = await pool.query(query, values);
      const row = rows[0];

      const totalSent = parseInt(row.total_sent || '0', 10);
      const totalDelivered = parseInt(row.total_delivered || '0', 10);
      const totalFailed = parseInt(row.total_failed || '0', 10);
      const totalOpened = parseInt(row.total_opened || '0', 10);
      const totalClicked = parseInt(row.total_clicked || '0', 10);

      const deliveryRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;
      const openRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
      const clickRate = totalOpened > 0 ? (totalClicked / totalOpened) * 100 : 0;

      return {
        totalSent,
        totalDelivered,
        totalFailed,
        totalOpened,
        totalClicked,
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        openRate: Math.round(openRate * 100) / 100,
        clickRate: Math.round(clickRate * 100) / 100,
      };
    } catch (error) {
      logger.error('Failed to get aggregated analytics stats:', error);
      return {
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        totalOpened: 0,
        totalClicked: 0,
        deliveryRate: 0,
        openRate: 0,
        clickRate: 0,
      };
    }
  },

  /**
   * Get daily analytics trends
   */
  async getDailyTrends(
    startDate: Date,
    endDate: Date,
    notificationType?: string,
    channel?: string
  ): Promise<NotificationAnalyticsRecord[]> {
    let query = `
      SELECT 
        date,
        COALESCE(notification_type, 'all') as notification_type,
        COALESCE(channel, 'all') as channel,
        SUM(total_sent) as total_sent,
        SUM(total_delivered) as total_delivered,
        SUM(total_failed) as total_failed,
        SUM(total_opened) as total_opened,
        SUM(total_clicked) as total_clicked,
        MIN(created_at) as created_at
      FROM notification_analytics
      WHERE date >= $1 AND date <= $2
    `;
    const values: any[] = [startDate, endDate];
    let paramCount = 3;

    if (notificationType) {
      query += ` AND notification_type = $${paramCount++}`;
      values.push(notificationType);
    }

    if (channel) {
      query += ` AND channel = $${paramCount++}`;
      values.push(channel);
    }

    query += ` GROUP BY date ORDER BY date;`;

    try {
      const { rows } = await pool.query<NotificationAnalyticsRecord>(query, values);
      return rows;
    } catch (error) {
      logger.error('Failed to get daily trends:', error);
      return [];
    }
  },
};