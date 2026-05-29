import { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service';
import { UsersService } from '../services/users.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

/**
 * Notification Preferences Controller - Handles user notification settings
 */
export const NotificationPreferencesController = {
  /**
   * Get current user's notification preferences
   * GET /api/v1/notifications/preferences
   */
  getPreferences: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    if (!userId) {
      return ResponseUtil.error(res, 'Unauthorized', 401);
    }

    const preferences = await NotificationService.getUserPreferences(userId);
    ResponseUtil.success(res, { preferences });
  }),

  /**
   * Update current user's notification preferences
   * PUT /api/v1/notifications/preferences
   */
  updatePreferences: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { preferences } = req.body;

    if (!userId) {
      return ResponseUtil.error(res, 'Unauthorized', 401);
    }

    if (!preferences || typeof preferences !== 'object') {
      return ResponseUtil.error(res, 'Invalid preferences data', 400);
    }

    const updatedUser = await UsersService.update(userId, {
      notificationPreferences: preferences,
    });

    if (!updatedUser) {
      return ResponseUtil.error(res, 'Failed to update preferences', 500);
    }

    ResponseUtil.success(res, {
      message: 'Notification preferences updated successfully',
      preferences: updatedUser.notification_preferences,
    });
  }),

  /**
   * Reset notification preferences to defaults
   * POST /api/v1/notifications/preferences/reset
   */
  resetPreferences: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    if (!userId) {
      return ResponseUtil.error(res, 'Unauthorized', 401);
    }

    const defaultPreferences = NotificationService.getDefaultPreferences();

    const updatedUser = await UsersService.update(userId, {
      notificationPreferences: defaultPreferences,
    });

    if (!updatedUser) {
      return ResponseUtil.error(res, 'Failed to reset preferences', 500);
    }

    ResponseUtil.success(res, {
      message: 'Notification preferences reset to defaults',
      preferences: updatedUser.notification_preferences,
    });
  }),
};

export default NotificationPreferencesController;
