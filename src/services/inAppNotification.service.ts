import pool from "../config/database";
import { SocketService } from "./socket.service";
import { logger } from "../utils/logger.utils";

export type InAppNotificationType =
  | "booking_confirmed"
  | "session_reminder"
  | "payment_received"
  | "review_received"
  | "message_received"
  | "verification_approved"
  | "dispute_opened"
  | "session_booked"
  | "session_cancelled"
  | "payment_failed"
  | "escrow_released"
  | "meeting_confirmed"
  | "system_alert";

export interface InAppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, any>;
  action_url: string | null;
  is_read: boolean;
  dismissed_at: Date | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateNotificationInput {
  userId: string;
  type: InAppNotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  actionUrl?: string;
}

export const InAppNotificationService = {
  /**
   * Create a notification and deliver via Socket.IO in real time.
   */
  async create(input: CreateNotificationInput): Promise<InAppNotification> {
    const { rows } = await pool.query<InAppNotification>(
      `INSERT INTO notifications
         (user_id, type, title, message, data, action_url, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '90 days')
       RETURNING *`,
      [
        input.userId,
        input.type,
        input.title,
        input.message,
        JSON.stringify(input.data || {}),
        input.actionUrl || null,
      ],
    );

    const notification = rows[0];

    SocketService.emitToUser(input.userId, "notification:new", notification);

    logger.debug("InAppNotificationService: created", {
      notificationId: notification.id,
      userId: input.userId,
      type: input.type,
    });

    return notification;
  },

  /**
   * List notifications for a user (excluding dismissed/expired), unread first then newest.
   */
  async list(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    notifications: InAppNotification[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const offset = (page - 1) * limit;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query<InAppNotification>(
        `SELECT * FROM notifications
         WHERE user_id = $1
           AND dismissed_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY is_read ASC, created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM notifications
         WHERE user_id = $1
           AND dismissed_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [userId],
      ),
    ]);

    const total = parseInt(countRows[0].count, 10);

    return {
      notifications: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  },

  /**
   * Mark a single notification as read.
   */
  async markRead(notificationId: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_read = FALSE`,
      [notificationId, userId],
    );

    return (rowCount ?? 0) > 0;
  },

  /**
   * Mark all unread notifications as read for a user.
   */
  async markAllRead(userId: string): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE, updated_at = NOW()
       WHERE user_id = $1
         AND is_read = FALSE
         AND dismissed_at IS NULL`,
      [userId],
    );

    return rowCount ?? 0;
  },

  /**
   * Soft-dismiss (delete) a notification.
   */
  async dismiss(notificationId: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE notifications
       SET dismissed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL`,
      [notificationId, userId],
    );

    return (rowCount ?? 0) > 0;
  },

  /**
   * Lightweight unread count for badge display.
   */
  async unreadCount(userId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications
       WHERE user_id = $1
         AND is_read = FALSE
         AND dismissed_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId],
    );

    return parseInt(rows[0].count, 10);
  },

  /**
   * Hard-delete expired notifications (expires_at < NOW()).
   * Called by the daily cleanup cron job.
   */
  async deleteExpired(): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM notifications WHERE expires_at < NOW()`,
    );

    return rowCount ?? 0;
  },
};
