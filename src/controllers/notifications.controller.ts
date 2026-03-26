import { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

/**
 * Notifications Controller - Handles in-app notification operations
 */
export const NotificationsController = {
  /**
   * Get paginated list of notifications for the authenticated user
   * GET /api/v1/notifications
   */
  getNotifications: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    if (!userId) {
      return ResponseUtil.error(res, 'Unauthorized', 401);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    // Get notifications (unread first, then by created_at DESC)
    const notifications = await NotificationService.getUserNotifications(userId, {
      limit: limit + 1, // Fetch one extra to check if there are more
      offset,
    });

    const hasMore = notifications.length > limit;
    const items = hasMore ? notifications.slice(0, limit) : notifications;

    // Sort: unread first, then by created_at DESC
    items.sort((a, b) => {
      if (a.is_read === b.is_read) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return a.is_read ? 1 : -1;
    });

    ResponseUtil.success(res, {
      notifications: items,
      pagination: {
        page,
        limit,
        hasMore,
      },
    });
  }),

  /**
   * Get unread notification count
   * GET /api/v1/notifications/unread-count
   */
  getUnreadCount: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    if (!userId) {
      return ResponseUtil.error(res, 'Unauthorized', 401);
    }

    const counts = await NotificationService.getNotificationCounts(userId);

    ResponseUtil.success(res, { count: counts.unread });
  }),

  /**
   * Mark a single notification as read
   * PUT /api/v1/notifications/:id/read
   */
  markAsRead: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;

    if (!userId) {
      return ResponseUtil.error(res, 'Unauthorized', 401);
    }

    if (Array.isArray(id)) {
      return ResponseUtil.error(res, 'Invalid notification ID', 400);
    }

    // Verify notification belongs to user
    const notification = await NotificationService.getUserNotifications(userId, {
      limit: 1,
      offset: 0,
    });

    const userNotification = notification.find(n => n.id === id);
    if (!userNotification) {
      return ResponseUtil.error(res, 'Notification not found', 404);
    }

    const success = await NotificationService.markAsRead(id);

    if (!success) {
      return ResponseUtil.error(res, 'Failed to mark notification as read', 500);
    }

    ResponseUtil.success(res, { message: 'Notification marked as read' });
  }),

  /**
   * Mark all notifications as read for the authenticated user
   * PUT /api/v1/notifications/read-all
   */
  markAllAsRead: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    if (!userId) {
      return ResponseUtil.error(res, 'Unauthorized', 401);
    }

    const count = await NotificationService.markAllAsRead(userId);

    ResponseUtil.success(res, {
      message: `${count} notification${count !== 1 ? 's' : ''} marked as read`,
      count,
    });
  }),

  /**
   * Delete a notification
   * DELETE /api/v1/notifications/:id
   */
  deleteNotification: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;

    if (!userId) {
      return ResponseUtil.error(res, 'Unauthorized', 401);
    }

    if (Array.isArray(id)) {
      return ResponseUtil.error(res, 'Invalid notification ID', 400);
    }

    // Verify notification belongs to user before deleting
    const notifications = await NotificationService.getUserNotifications(userId, {
      limit: 1000, // Get all to find the specific one
      offset: 0,
    });

    const userNotification = notifications.find(n => n.id === id);
    if (!userNotification) {
      return ResponseUtil.error(res, 'Notification not found', 404);
    }

    const success = await NotificationService.cancelScheduledNotification(id);

    if (!success) {
      return ResponseUtil.error(res, 'Failed to delete notification', 500);
    }

    ResponseUtil.success(res, { message: 'Notification deleted successfully' });
  }),
};

export default NotificationsController;
