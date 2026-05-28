import { Request, Response } from "express";
import { z } from "zod";
import { SubscriptionService } from "../services/subscription.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";

const subscribeSchema = z.object({
  tier: z.enum(["free", "pro", "premium", "enterprise"]),
  billingCycle: z.enum(["monthly", "yearly"]),
  trial: z.boolean().optional(),
  stellarTxId: z.string().optional(),
});

export const SubscriptionController = {
  /**
   * GET /api/v1/subscriptions/tiers
   * Public — list available tiers and pricing
   */
  getTiers: asyncHandler(
    async (_req: Request, res: Response): Promise<void> => {
      ResponseUtil.success(res, SubscriptionService.getTierInfo());
    },
  ),

  /**
   * GET /api/v1/subscriptions/current
   * Get the authenticated user's active subscription
   */
  getCurrent: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;
      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      const sub = await SubscriptionService.getCurrent(userId);
      ResponseUtil.success(res, sub);
    },
  ),

  /**
   * GET /api/v1/subscriptions
   * List all subscriptions for the authenticated user
   */
  list: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      ResponseUtil.error(res, "Unauthorized", 401);
      return;
    }

    const subs = await SubscriptionService.listByUser(userId);
    ResponseUtil.success(res, { subscriptions: subs });
  }),

  /**
   * POST /api/v1/subscriptions
   * Subscribe to a tier
   */
  subscribe: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;
      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      const validation = subscribeSchema.safeParse(req.body);
      if (!validation.success) {
        ResponseUtil.error(res, validation.error.issues[0].message, 400);
        return;
      }

      const { tier, billingCycle, trial, stellarTxId } = validation.data;
      const sub = await SubscriptionService.subscribe(
        userId,
        tier,
        billingCycle,
        { trial, stellarTxId },
      );
      ResponseUtil.success(res, sub, "Subscription created", 201);
    },
  ),

  /**
   * DELETE /api/v1/subscriptions/:id
   * Cancel a subscription
   */
  cancel: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      ResponseUtil.error(res, "Unauthorized", 401);
      return;
    }

    const { id } = req.params;
    try {
      const sub = await SubscriptionService.cancel(userId, id);
      ResponseUtil.success(res, sub, "Subscription cancelled");
    } catch (err: any) {
      ResponseUtil.error(res, err.message, 404);
    }
  }),
};
