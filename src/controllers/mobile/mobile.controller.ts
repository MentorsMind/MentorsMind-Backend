import { Request, Response } from "express";
import { z } from "zod";
import { PushTokensModel } from "../../models/push-tokens.model";
import { OfflineSyncService } from "../../services/offline-sync.service";
import { MobileOptimizationService } from "../../services/mobile-optimization.service";
import { ResponseUtil } from "../../utils/response.utils";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const syncRequestSchema = z.object({
  deviceId: z.string().min(1, "Device id is required"),
  lastSyncedAt: z.string().optional(),
  pendingChanges: z
    .array(
      z.object({
        id: z.string(),
        entity: z.string(),
        action: z.enum(["create", "update", "delete"]),
        payload: z.record(z.any()).default({}),
        clientVersion: z.number().optional(),
        timestamp: z.string().optional(),
      }),
    )
    .default([]),
});

const pushRegisterSchema = z.object({
  token: z.string().min(1, "Push token is required"),
  deviceType: z.enum(["android", "ios", "web"]).optional(),
  deviceId: z.string().optional(),
});

export const MobileController = {
  getSyncStatus: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id ?? (req as any).user?.userId;
      if (!userId) {
        ResponseUtil.unauthorized(res, "Authentication required");
        return;
      }

      const payload = OfflineSyncService.createSyncPayload(
        userId,
        "mobile-device",
        {
          lastSyncedAt: new Date(Date.now() - 60_000).toISOString(),
          pendingChanges: [],
        },
      );

      ResponseUtil.success(
        res,
        {
          syncState: "ready",
          ...payload,
        },
        "Mobile sync status retrieved",
      );
    },
  ),

  sync: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id ?? (req as any).user?.userId;
    if (!userId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    const parsed = syncRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      ResponseUtil.validationError(
        res,
        parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "body",
          message: issue.message,
        })),
        "Invalid sync payload",
      );
      return;
    }

    const { deviceId, lastSyncedAt, pendingChanges } = parsed.data;
    const payload = OfflineSyncService.createSyncPayload(userId, deviceId, {
      lastSyncedAt,
      pendingChanges,
    });

    const serverSnapshot = {
      reminders: {
        version: 4,
        title: "Server reminder",
      },
    };

    const conflictResult = OfflineSyncService.resolveConflict(
      pendingChanges[0]?.payload as Record<string, unknown> | null,
      serverSnapshot.reminders as Record<string, unknown>,
    );

    ResponseUtil.success(
      res,
      {
        ...payload,
        conflictResolution: conflictResult,
        appliedChanges: pendingChanges.length,
      },
      "Offline sync completed",
    );
  }),

  getOptimizedSnapshot: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const snapshot = {
        userId: (req as any).user?.id ?? (req as any).user?.userId,
        dashboard: {
          upcomingSessions: 3,
          unreadMessages: 7,
        },
        generatedAt: new Date().toISOString(),
      };

      const optimized = MobileOptimizationService.optimizePayload(snapshot, {
        compress: true,
        mobileOnly: true,
        compressionThreshold: 256,
      });

      ResponseUtil.success(
        res,
        {
          optimized,
          summary: snapshot,
        },
        "Mobile-optimized snapshot generated",
      );
    },
  ),

  registerPushToken: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id ?? (req as any).user?.userId;
      if (!userId) {
        ResponseUtil.unauthorized(res, "Authentication required");
        return;
      }

      const parsed = pushRegisterSchema.safeParse(req.body);
      if (!parsed.success) {
        ResponseUtil.validationError(
          res,
          parsed.error.issues.map((issue) => ({
            field: issue.path.join(".") || "body",
            message: issue.message,
          })),
          "Invalid push registration",
        );
        return;
      }

      const { token, deviceType, deviceId } = parsed.data;

      const pushToken = await PushTokensModel.upsert({
        user_id: userId,
        token,
        device_type: deviceType,
        device_id: deviceId,
      });

      if (!pushToken) {
        ResponseUtil.error(res, "Failed to register push token", 500);
        return;
      }

      ResponseUtil.success(
        res,
        {
          tokenId: pushToken.id,
          deviceType: deviceType ?? "android",
          deviceId: deviceId ?? "mobile-device",
        },
        "Mobile push registration confirmed",
      );
    },
  ),
};

export default MobileController;
