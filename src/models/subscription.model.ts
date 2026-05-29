import pool from "../config/database";
import { logger } from "../utils/logger";

export type SubscriptionTier = "free" | "pro" | "premium" | "enterprise";
export type SubscriptionStatus = "active" | "cancelled" | "expired" | "trial";
export type BillingCycle = "monthly" | "yearly";

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  price: string;
  features: string[];
  start_date: Date;
  end_date: Date | null;
  trial_ends_at: Date | null;
  auto_renew: boolean;
  stellar_tx_id: string | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSubscriptionInput {
  user_id: string;
  tier: SubscriptionTier;
  billing_cycle: BillingCycle;
  price: number;
  features: string[];
  end_date?: Date;
  trial_ends_at?: Date;
  stellar_tx_id?: string;
}

export const SubscriptionModel = {
  async create(
    input: CreateSubscriptionInput,
  ): Promise<SubscriptionRecord | null> {
    const status: SubscriptionStatus = input.trial_ends_at ? "trial" : "active";
    try {
      const { rows } = await pool.query<SubscriptionRecord>(
        `INSERT INTO subscriptions
           (user_id, tier, status, billing_cycle, price, features, end_date, trial_ends_at, stellar_tx_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          input.user_id,
          input.tier,
          status,
          input.billing_cycle,
          input.price,
          input.features,
          input.end_date ?? null,
          input.trial_ends_at ?? null,
          input.stellar_tx_id ?? null,
        ],
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("Failed to create subscription:", error);
      return null;
    }
  },

  async findActiveByUserId(userId: string): Promise<SubscriptionRecord | null> {
    try {
      const { rows } = await pool.query<SubscriptionRecord>(
        `SELECT * FROM subscriptions
         WHERE user_id = $1 AND status IN ('active', 'trial')
         ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("Failed to find active subscription:", error);
      return null;
    }
  },

  async findByUserId(userId: string): Promise<SubscriptionRecord[]> {
    try {
      const { rows } = await pool.query<SubscriptionRecord>(
        `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return rows;
    } catch (error) {
      logger.error("Failed to find subscriptions by user:", error);
      return [];
    }
  },

  async cancel(id: string, userId: string): Promise<SubscriptionRecord | null> {
    try {
      const { rows } = await pool.query<SubscriptionRecord>(
        `UPDATE subscriptions
         SET status = 'cancelled', auto_renew = FALSE, cancelled_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status IN ('active', 'trial')
         RETURNING *`,
        [id, userId],
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("Failed to cancel subscription:", error);
      return null;
    }
  },

  async expireOverdue(): Promise<number> {
    try {
      const { rowCount } = await pool.query(
        `UPDATE subscriptions
         SET status = 'expired', updated_at = NOW()
         WHERE status IN ('active', 'trial')
           AND end_date IS NOT NULL AND end_date < NOW()`,
      );
      return rowCount ?? 0;
    } catch (error) {
      logger.error("Failed to expire overdue subscriptions:", error);
      return 0;
    }
  },
};
