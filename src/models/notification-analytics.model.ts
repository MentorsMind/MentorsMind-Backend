import { db } from "../config/database";
import { Logger } from "../utils/logger.utils";

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
   * Upsert analytics data for a specific date, type, and channel
   */
  async upsert(
    input: NotificationAnalyticsInput,
  ): Promise<NotificationAnalyticsRecord | null> {
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
      const { rows } = await db.query(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error("Failed to upsert notification analytics:", error);
      return null;
    }
  },

  /**
   * Increment a specific metric for a date, type, and channel
   */
  async incrementMetric(
    date: Date,
    notification_type: string,
    channel: string,
    metric: 'total_sent' | 'total_delivered' | 'total_failed' | 'total_opened' | 'total_clicked'
  ): Promise<NotificationAnalyticsRecord | null> {
    return this.upsert({
      date,
      notification_type,
      channel,
      [metric]: 1
    });
  },

  /**
   * Get aggregated stats for a period
   */
  async getStats(filters: AnalyticsFilters): Promise<AnalyticsStats> {
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

    const values = [];
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
      const { rows } = await db.query(query, values);
      const stats = rows[0];

      const totalSent = parseInt(stats.total_sent || 0);
      const totalDelivered = parseInt(stats.total_delivered || 0);
      const totalFailed = parseInt(stats.total_failed || 0);
      const totalOpened = parseInt(stats.total_opened || 0);
      const totalClicked = parseInt(stats.total_clicked || 0);

      return {
        totalSent,
        totalDelivered,
        totalFailed,
        totalOpened,
        totalClicked,
        deliveryRate: totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0,
        openRate: totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0,
        clickRate: totalOpened > 0 ? (totalClicked / totalOpened) * 100 : 0,
      };
    } catch (error) {
      logger.error("Failed to get notification analytics stats:", error);
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
};

