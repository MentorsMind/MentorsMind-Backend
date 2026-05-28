import pool from "../config/database";
import {
  SubscriptionModel,
  SubscriptionTier,
  BillingCycle,
  SubscriptionRecord,
} from "../models/subscription.model";
import { logger } from "../utils/logger";

// ─── Tier definitions ─────────────────────────────────────────────────────────

export const TIER_PRICES: Record<
  SubscriptionTier,
  { monthly: number; yearly: number }
> = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 29, yearly: 290 },
  premium: { monthly: 79, yearly: 790 },
  enterprise: { monthly: 299, yearly: 2990 },
};

export const TIER_FEATURES: Record<SubscriptionTier, string[]> = {
  free: ["5_sessions_per_month", "basic_support", "community_access"],
  pro: [
    "unlimited_sessions",
    "priority_support",
    "analytics_basic",
    "calendar_sync",
  ],
  premium: [
    "unlimited_sessions",
    "priority_support",
    "analytics_advanced",
    "calendar_sync",
    "recording",
    "custom_branding",
  ],
  enterprise: [
    "unlimited_sessions",
    "dedicated_support",
    "analytics_advanced",
    "calendar_sync",
    "recording",
    "custom_branding",
    "sso",
    "api_access",
    "sla",
  ],
};

const TRIAL_DAYS = 14;

export const SubscriptionService = {
  /**
   * Get the current active subscription for a user (or a synthetic free one).
   */
  async getCurrent(userId: string): Promise<SubscriptionRecord> {
    const sub = await SubscriptionModel.findActiveByUserId(userId);
    if (sub) return sub;

    // Return a synthetic free subscription (not persisted)
    return {
      id: "",
      user_id: userId,
      tier: "free",
      status: "active",
      billing_cycle: "monthly",
      price: "0",
      features: TIER_FEATURES.free,
      start_date: new Date(),
      end_date: null,
      trial_ends_at: null,
      auto_renew: false,
      stellar_tx_id: null,
      cancelled_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
  },

  /**
   * Subscribe a user to a tier. Cancels any existing active subscription first.
   */
  async subscribe(
    userId: string,
    tier: SubscriptionTier,
    billingCycle: BillingCycle,
    options: { trial?: boolean; stellarTxId?: string } = {},
  ): Promise<SubscriptionRecord> {
    // Cancel existing active subscription
    const existing = await SubscriptionModel.findActiveByUserId(userId);
    if (existing) {
      await SubscriptionModel.cancel(existing.id, userId);
    }

    const price = TIER_PRICES[tier][billingCycle];
    const features = TIER_FEATURES[tier];

    const now = new Date();
    const endDate = new Date(now);
    if (billingCycle === "monthly") {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const trialEndsAt = options.trial
      ? new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
      : undefined;

    const sub = await SubscriptionModel.create({
      user_id: userId,
      tier,
      billing_cycle: billingCycle,
      price,
      features,
      end_date: endDate,
      trial_ends_at: trialEndsAt,
      stellar_tx_id: options.stellarTxId,
    });

    if (!sub) throw new Error("Failed to create subscription");

    // Update user_tier column
    await pool.query(
      `UPDATE users SET user_tier = $1, updated_at = NOW() WHERE id = $2`,
      [
        tier === "enterprise"
          ? "enterprise"
          : tier === "premium"
            ? "premium"
            : tier === "pro"
              ? "pro"
              : "free",
        userId,
      ],
    );

    logger.info("Subscription created", { userId, tier, billingCycle });
    return sub;
  },

  /**
   * Cancel a user's active subscription.
   */
  async cancel(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionRecord> {
    const sub = await SubscriptionModel.cancel(subscriptionId, userId);
    if (!sub) throw new Error("Subscription not found or already cancelled");

    // Downgrade user_tier to free
    await pool.query(
      `UPDATE users SET user_tier = 'free', updated_at = NOW() WHERE id = $1`,
      [userId],
    );

    return sub;
  },

  /**
   * List all subscriptions for a user.
   */
  async listByUser(userId: string): Promise<SubscriptionRecord[]> {
    return SubscriptionModel.findByUserId(userId);
  },

  /**
   * Get available tiers with pricing.
   */
  getTierInfo(): Record<
    SubscriptionTier,
    { prices: (typeof TIER_PRICES)[SubscriptionTier]; features: string[] }
  > {
    const tiers = [
      "free",
      "pro",
      "premium",
      "enterprise",
    ] as SubscriptionTier[];
    return Object.fromEntries(
      tiers.map((t) => [
        t,
        { prices: TIER_PRICES[t], features: TIER_FEATURES[t] },
      ]),
    ) as any;
  },

  /**
   * Expire overdue subscriptions (called by a cron job).
   */
  async expireOverdue(): Promise<number> {
    const count = await SubscriptionModel.expireOverdue();
    if (count > 0) logger.info(`Expired ${count} overdue subscriptions`);
    return count;
  },
};
