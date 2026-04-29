import pool from "../config/database";
import { logger } from "../utils/logger";

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, any>;
  action_url: string | null;
  is_read: boolean;
  dismissed_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationInput {
  user_id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  action_url?: string;
  expires_at?: Date;
}

export enum NotificationType {
  BOOKING_CONFIRMED = "booking_confirmed",
  PAYMENT_PROCESSED = "payment_processed",
  SESSION_REMINDER = "session_reminder",
  DISPUTE_CREATED = "dispute_created",
  SYSTEM_ALERT = "system_alert",
  MEETING_CONFIRMED = "meeting_confirmed",
  MESSAGE_RECEIVED = "message_received",
  SESSION_CANCELLED = "session_cancelled",
  CALENDAR_CONNECTION_EXPIRED = "calendar_connection_expired",
}

export enum NotificationChannel {
  EMAIL = "email",
  IN_APP = "in_app",
  PUSH = "push",
}

export enum NotificationPriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Enhanced Notifications Model supporting multiple channels, priorities, and scheduling
 */
export const NotificationsModel = {
  /**
   * Notifications table schemas are managed by database migrations.
   * Runtime DDL creation is intentionally removed to avoid schema drift.
   */

  /**
   * Create a new notification
   */
  async create(input: NotificationInput): Promise<NotificationRecord | null> {
    const query = `
      INSERT INTO notifications (
        user_id, type, title, message, data, action_url, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW() + INTERVAL '90 days'))
      RETURNING *;
    `;

    const values = [
      input.user_id,
      input.type,
      input.channel,
      input.priority || "normal",
      input.title,
      input.message,
      JSON.stringify(input.data || {}),
      input.action_url ?? null,
      input.expires_at ?? null,
    ];

    try {
      const { rows } = await pool.query<NotificationRecord>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error("Failed to create notification:", error);
      return null;
    }
  },

  /**
   * Get notification by ID
   */
  async getById(id: string): Promise<NotificationRecord | null> {
    const query = `
      SELECT * FROM notifications
      WHERE id = $1;
    `;

    try {
      const { rows } = await pool.query<NotificationRecord>(query, [id]);
      return rows[0] || null;
    } catch (error) {
      logger.error("Failed to get notification by ID:", error);
      return null;
    }
  },

  /**
   * Get notifications for a user with filtering options.
   * All dynamic WHERE, LIMIT, and OFFSET clauses use $N placeholders (e.g. $${paramCount++}) — verified correct, no bare paramCount interpolation.
   */
  async getByUserId(
    userId: string,
    options: {
      type?: string;
      isRead?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<NotificationRecord[]> {
    let query = `
      SELECT * FROM notifications
      WHERE user_id = $1
        AND dismissed_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    const values: any[] = [userId];
    let paramCount = 2;

    if (options.type) {
      query += ` AND type = $${paramCount++}`;
      values.push(options.type);
    }

    if (options.isRead !== undefined) {
      query += ` AND is_read = $${paramCount++}`;
      values.push(options.isRead);
    }

    query += ` ORDER BY created_at DESC`;

    if (options.limit) {
      query += ` LIMIT $${paramCount++}`;
      values.push(options.limit);
    }

    if (options.offset) {
      query += ` OFFSET $${paramCount++}`;
      values.push(options.offset);
    }

    try {
      const { rows } = await pool.query<NotificationRecord>(query, values);
      return rows;
    } catch (error) {
      logger.error("Failed to get notifications by user ID:", error);
      return [];
    }
  },

  /**
   * Get unread notifications for a user
   */
  async getUnreadByUserId(
    userId: string,
    limit: number = 50,
  ): Promise<NotificationRecord[]> {
    return this.getByUserId(userId, { isRead: false, limit });
  },

  /**
   * Get scheduled notifications that are ready to be sent
   */
  async getScheduledNotifications(
    limit: number = 100,
  ): Promise<NotificationRecord[]> {
    const query = `
      SELECT * FROM notifications
      WHERE scheduled_at IS NOT NULL 
        AND scheduled_at <= NOW()
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY priority DESC, scheduled_at ASC
      LIMIT $1;
    `;

    try {
      const { rows } = await pool.query<NotificationRecord>(query, [limit]);
      return rows;
    } catch (error) {
      logger.error("Failed to get scheduled notifications:", error);
      return [];
    }
  },

  /**
   * Mark notification as read
   */
  async markAsRead(id: string): Promise<boolean> {
    const query = `
      UPDATE notifications
      SET is_read = TRUE, updated_at = NOW()
      WHERE id = $1
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [id]);
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("Failed to mark notification as read:", error);
      return false;
    }
  },

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsReadByUserId(userId: string): Promise<number> {
    const query = `
      UPDATE notifications
      SET is_read = TRUE, updated_at = NOW()
      WHERE user_id = $1 AND is_read = FALSE
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [userId]);
      return rowCount ?? 0;
    } catch (error) {
      logger.error("Failed to mark all notifications as read:", error);
      return 0;
    }
  },

  /**
   * Update notification
   */
  async update(
    id: string,
    updates: Partial<NotificationInput>,
  ): Promise<NotificationRecord | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.title !== undefined) {
      fields.push(`title = $${paramCount++}`);
      values.push(updates.title);
    }
    if (updates.message !== undefined) {
      fields.push(`message = $${paramCount++}`);
      values.push(updates.message);
    }
    if (updates.data !== undefined) {
      fields.push(`data = $${paramCount++}`);
      values.push(JSON.stringify(updates.data));
    }
    if (updates.action_url !== undefined) {
      fields.push(`action_url = $${paramCount++}`);
      values.push(updates.action_url);
    }
    if (updates.expires_at !== undefined) {
      fields.push(`expires_at = $${paramCount++}`);
      values.push(updates.expires_at);
    }

    if (fields.length === 0) {
      return null;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE notifications
      SET ${fields.join(", ")}
      WHERE id = $${paramCount}
      RETURNING *;
    `;

    try {
      const { rows } = await pool.query<NotificationRecord>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error("Failed to update notification:", error);
      return null;
    }
  },

  /**
   * Delete notification
   */
  async delete(id: string): Promise<boolean> {
    const query = `
      DELETE FROM notifications
      WHERE id = $1
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [id]);
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("Failed to delete notification:", error);
      return false;
    }
  },

  /**
   * Delete expired notifications
   */
  async deleteExpired(): Promise<number> {
    const query = `
      DELETE FROM notifications
      WHERE expires_at IS NOT NULL AND expires_at < NOW()
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query);
      return rowCount ?? 0;
    } catch (error) {
      logger.error("Failed to delete expired notifications:", error);
      return 0;
    }
  },

  /**
   * Get notification counts by status for a user
   */
  async getCountsByUserId(
    userId: string,
  ): Promise<{ total: number; unread: number; read: number }> {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_read = FALSE THEN 1 END) as unread,
        COUNT(CASE WHEN is_read = TRUE THEN 1 END) as read
      FROM notifications
      WHERE user_id = $1;
    `;

    try {
      const { rows } = await pool.query(query, [userId]);
      const row = rows[0];
      return {
        total: parseInt(row.total, 10),
        unread: parseInt(row.unread, 10),
        read: parseInt(row.read, 10),
      };
    } catch (error) {
      logger.error("Failed to get notification counts:", error);
      return { total: 0, unread: 0, read: 0 };
    }
  },
};
