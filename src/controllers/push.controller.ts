import { Request, Response } from "express";
import { PushTokensModel } from "../models/push-tokens.model";
import { PushService } from "../services/push.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { z } from "zod";

const subscribeSchema = z.object({
  token: z.string().min(1, "FCM token is required"),
  deviceType: z.enum(["web", "android", "ios"]).optional(),
  deviceId: z.string().optional(),
});

/**
 * Push Notifications Controller - Handles FCM token management
 */
export const PushController = {
  /**
   * Subscribe to push notifications
   * POST /api/v1/notifications/push/subscribe
   */
  subscribe: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;

      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      // Validate request body
      const validation = subscribeSchema.safeParse(req.body);
      if (!validation.success) {
        ResponseUtil.error(res, validation.error.issues[0].message, 400);
        return;
      }

      const { token, deviceType, deviceId } = validation.data;

      // Save token to database
      const pushToken = await PushTokensModel.upsert({
        user_id: userId,
        token,
        device_type: deviceType,
        device_id: deviceId,
      });

      if (!pushToken) {
        ResponseUtil.error(res, "Failed to save push token", 500);
        return;
      }

      ResponseUtil.success(res, {
        message: "Successfully subscribed to push notifications",
        tokenId: pushToken.id,
      });
    },
  ),

  /**
   * Unsubscribe from push notifications
   * DELETE /api/v1/notifications/push/unsubscribe
   */
  unsubscribe: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;

      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      const { token } = req.body;

      if (!token || typeof token !== "string") {
        ResponseUtil.error(res, "FCM token is required", 400);
        return;
      }

      // Delete token from database
      const success = await PushTokensModel.deleteToken(userId, token);

      if (!success) {
        ResponseUtil.error(res, "Token not found or already removed", 404);
        return;
      }

      ResponseUtil.success(res, {
        message: "Successfully unsubscribed from push notifications",
      });
    },
  ),

  /**
   * Get all active push tokens for the authenticated user
   * GET /api/v1/notifications/push/tokens
   */
  getTokens: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;

      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      const tokens = await PushTokensModel.getActiveTokensByUserId(userId);

      ResponseUtil.success(res, {
        tokens: tokens.map((t) => ({
          id: t.id,
          deviceType: t.device_type,
          deviceId: t.device_id,
          lastUsedAt: t.last_used_at,
          createdAt: t.created_at,
        })),
      });
    },
  ),

  /**
   * Send test push notification
   * POST /api/v1/notifications/push/test
   */
  sendTest: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;

    if (!userId) {
      ResponseUtil.error(res, "Unauthorized", 401);
      return;
    }

    const result = await PushService.sendTestNotification(userId);

    if (!result.success) {
      ResponseUtil.error(res, result.errors.join(", "), 500);
      return;
    }

    ResponseUtil.success(res, {
      message: "Test notification sent",
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  }),

  /**
   * Send rich push notification with actions and deep link
   * POST /api/v1/notifications/push/send
   */
  sendRich: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      ResponseUtil.error(res, "Unauthorized", 401);
      return;
    }

    const schema = z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      data: z.record(z.string()).optional(),
      imageUrl: z.string().url().optional(),
      deepLink: z.string().optional(),
      priority: z.enum(["high", "normal"]).optional(),
      actions: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            icon: z.string().optional(),
          }),
        )
        .optional(),
      badge: z.number().int().nonnegative().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      ResponseUtil.error(res, validation.error.issues[0].message, 400);
      return;
    }

    const result = await PushService.sendRich(userId, validation.data);

    if (!result.success && result.successCount === 0) {
      ResponseUtil.error(
        res,
        result.errors.join(", ") || "Failed to send notification",
        500,
      );
      return;
    }

    ResponseUtil.success(res, {
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  }),
};

export default PushController;
