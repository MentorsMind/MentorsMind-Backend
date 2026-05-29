import { Request, Response } from 'express';
import { InAppNotificationService } from '../services/inAppNotification.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

/**
 * Notifications Controller - Handles in-app notification CRUD operations
 */
export const NotificationsController = {
  /**
   * GET /api/v1/notifications
   * Paginated list of notifications for the authenticated user (unread first).
   */
  getNotifications: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return ResponseUtil.error(res, 'Unauthorized', 401);

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const result = await InAppNotificationService.list(userId, page, limit);

    ResponseUtil.success(
      res,
      result,
      'Notifications retrieved',
      200,
      {
        page: result.page,
        limit,
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.page < result.totalPages,
        hasPrev: result.page > 1,
      },
    );
  }),

  /**
   * GET /api/v1/notifications/unread-count
   * Lightweight unread count for badge display.
   */
  getUnreadCount: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return ResponseUtil.error(res, 'Unauthorized', 401);

    const count = await InAppNotificationService.unreadCount(userId);
    ResponseUtil.success(res, { unreadCount: count }, 'Unread count retrieved');
  }),

  /**
   * PUT /api/v1/notifications/:id/read
   * Mark a single notification as read.
   */
  markAsRead: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    if (!userId) return ResponseUtil.error(res, 'Unauthorized', 401);

    const updated = await InAppNotificationService.markRead(id, userId);
    if (!updated) return ResponseUtil.error(res, 'Notification not found', 404);

    ResponseUtil.success(res, null, 'Notification marked as read');
  }),

  /**
   * PUT /api/v1/notifications/read-all
   * Mark all notifications as read for the authenticated user.
   */
  markAllAsRead: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return ResponseUtil.error(res, 'Unauthorized', 401);

    const count = await InAppNotificationService.markAllRead(userId);
    ResponseUtil.success(
      res,
      { markedRead: count },
      `${count} notification${count !== 1 ? 's' : ''} marked as read`,
    );
  }),

  /**
   * DELETE /api/v1/notifications/:id
   * Dismiss (soft-delete) a notification.
   */
  deleteNotification: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    if (!userId) return ResponseUtil.error(res, 'Unauthorized', 401);

    const dismissed = await InAppNotificationService.dismiss(id, userId);
    if (!dismissed) return ResponseUtil.error(res, 'Notification not found', 404);

    ResponseUtil.success(res, null, 'Notification dismissed');
  }),
};

export default NotificationsController;
