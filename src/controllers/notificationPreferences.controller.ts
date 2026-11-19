import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { NotificationService } from '../services/notification.service';
import { UsersService } from '../services/users.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

export const NotificationPreferencesController = {
  getPreferences: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return ResponseUtil.error(res, 'Unauthorized', 401);

    const preferences = await NotificationService.getUserPreferences(userId);
    ResponseUtil.success(res, { preferences });
  }),

  updatePreferences: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
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

  resetPreferences: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

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
