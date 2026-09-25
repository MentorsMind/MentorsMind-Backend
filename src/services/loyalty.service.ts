import pool from "../config/database";
import { logger } from "../utils/logger.utils";

export interface LoyaltyToken {
  symbol: string;
  totalSupply: string;
  circulatingSupply: string;
  holders: number;
  price: string;
}

export interface LoyaltyAccount {
  userId: string;
  balance: string;
  earned: string;
  redeemed: string;
  tier: "bronze" | "silver" | "gold" | "platinum";
  benefits: string[];
}

export interface EarnRule {
  action: string;
  tokensEarned: string;
  cooldown?: number;
  maxPerDay?: string;
}

// bps discount applied to the platform fee per tier (1.5% for platinum, per issue #680)
const TIER_DISCOUNT_BPS: Record<string, number> = {
  bronze: 0,
  silver: 50,
  gold: 100,
  platinum: 150,
};

const TIER_THRESHOLDS = { bronze: 0, silver: 100, gold: 500, platinum: 1000 };
const TIER_BENEFITS: Record<string, string[]> = {
  bronze: ["5% session discount"],
  silver: ["10% session discount", "Priority support"],
  gold: ["15% session discount", "Priority support", "Free session monthly"],
  platinum: [
    "20% session discount",
    "Priority support",
    "2 free sessions monthly",
    "Exclusive mentors",
  ],
};

const EARN_RULES: EarnRule[] = [
  { action: "complete_session", tokensEarned: "10", cooldown: 0 },
  { action: "write_review", tokensEarned: "5", maxPerDay: "15" },
  { action: "referral", tokensEarned: "50" },
  { action: "daily_login", tokensEarned: "1", maxPerDay: "1" },
];

function computeTier(
  balance: number,
): "bronze" | "silver" | "gold" | "platinum" {
  if (balance >= TIER_THRESHOLDS.platinum) return "platinum";
  if (balance >= TIER_THRESHOLDS.gold) return "gold";
  if (balance >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

export const LoyaltyService = {
  async getOrCreateAccount(userId: string): Promise<LoyaltyAccount> {
    const { rows } = await pool.query(
      "SELECT * FROM loyalty_accounts WHERE user_id=$1",
      [userId],
    );
    if (rows[0]) {
      const row = rows[0];
      const tier = computeTier(parseFloat(row.balance));
      return {
        userId,
        balance: row.balance,
        earned: row.earned,
        redeemed: row.redeemed,
        tier,
        benefits: TIER_BENEFITS[tier],
      };
    }
    await pool.query(
      "INSERT INTO loyalty_accounts (user_id, balance, earned, redeemed) VALUES ($1, 0, 0, 0) ON CONFLICT (user_id) DO NOTHING",
      [userId],
    );
    return {
      userId,
      balance: "0",
      earned: "0",
      redeemed: "0",
      tier: "bronze",
      benefits: TIER_BENEFITS.bronze,
    };
  },

  async earnTokens(userId: string, action: string): Promise<LoyaltyAccount> {
    const rule = EARN_RULES.find((r) => r.action === action);
    if (!rule) throw new Error(`Unknown earn action: ${action}`);

    const tokens = parseFloat(rule.tokensEarned);
    await pool.query(
      `INSERT INTO loyalty_accounts (user_id, balance, earned, redeemed)
       VALUES ($1, $2, $2, 0)
       ON CONFLICT (user_id) DO UPDATE
       SET balance = loyalty_accounts.balance + $2,
           earned = loyalty_accounts.earned + $2,
           updated_at = CURRENT_TIMESTAMP`,
      [userId, tokens],
    );
    await pool.query(
      "INSERT INTO loyalty_transactions (user_id, action, tokens, type) VALUES ($1,$2,$3,'earn')",
      [userId, action, tokens],
    );
    return this.getOrCreateAccount(userId);
  },

  async redeemTokens(userId: string, tokens: number): Promise<LoyaltyAccount> {
    const account = await this.getOrCreateAccount(userId);
    if (parseFloat(account.balance) < tokens)
      throw new Error("Insufficient token balance");

    await pool.query(
      `UPDATE loyalty_accounts SET balance = balance - $2, redeemed = redeemed + $2, updated_at = CURRENT_TIMESTAMP WHERE user_id=$1`,
      [userId, tokens],
    );
    await pool.query(
      "INSERT INTO loyalty_transactions (user_id, action, tokens, type) VALUES ($1,'redeem',$2,'redeem')",
      [userId, tokens],
    );
    return this.getOrCreateAccount(userId);
  },

  async getTokenInfo(): Promise<LoyaltyToken> {
    const { rows } = await pool.query(
      "SELECT COALESCE(SUM(earned),0) as circulating, COUNT(DISTINCT user_id) as holders FROM loyalty_accounts",
    );
    return {
      symbol: "MMLP",
      totalSupply: "10000000",
      circulatingSupply: rows[0]?.circulating ?? "0",
      holders: parseInt(rows[0]?.holders ?? "0"),
      price: "0.01",
    };
  },

  async getEarnRules(): Promise<EarnRule[]> {
    return EARN_RULES;
  },

  async getTransactionHistory(userId: string): Promise<unknown[]> {
    const { rows } = await pool.query(
      "SELECT * FROM loyalty_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
      [userId],
    );
    return rows;
  },

  /**
   * Award loyalty points when a session completes. 10 points per hour
   * (rounded up), 10 points per session floor. Idempotent: the DB unique
   * index on (user_id, action, reference_id) rejects a second award for the
   * same bookingId, so completing a booking twice never double-awards.
   */
  async accruePointsForCompletion(
    menteeId: string,
    bookingId: string,
    durationMinutes: number,
  ): Promise<LoyaltyAccount | null> {
    const points = Math.ceil(durationMinutes / 60) * 10;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const inserted = await client.query(
        `INSERT INTO loyalty_transactions (user_id, action, tokens, type, reference_id)
         VALUES ($1, 'complete_session', $2, 'earn', $3)
         ON CONFLICT (user_id, action, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [menteeId, points, bookingId],
      );

      if (inserted.rows.length === 0) {
        // Already accrued for this booking — no-op.
        await client.query("ROLLBACK");
        logger.debug("Loyalty points already accrued for booking", {
          bookingId,
          menteeId,
        });
        return null;
      }

      await client.query(
        `INSERT INTO loyalty_accounts (user_id, balance, earned, redeemed)
         VALUES ($1, $2, $2, 0)
         ON CONFLICT (user_id) DO UPDATE
         SET balance = loyalty_accounts.balance + $2,
             earned = loyalty_accounts.earned + $2,
             updated_at = CURRENT_TIMESTAMP`,
        [menteeId, points],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    logger.info("Loyalty points accrued for session completion", {
      menteeId,
      bookingId,
      points,
    });

    return this.getOrCreateAccount(menteeId);
  },

  /** Platform-fee discount in basis points for the user's current tier. */
  async getDiscountBps(userId: string): Promise<number> {
    const account = await this.getOrCreateAccount(userId);
    return TIER_DISCOUNT_BPS[account.tier] ?? 0;
  },

  /** GET /api/v1/loyalty/status payload: points, tier, next tier, discount. */
  async getStatus(userId: string): Promise<{
    points: number;
    tier: LoyaltyAccount["tier"];
    nextTier: LoyaltyAccount["tier"] | null;
    nextTierThreshold: number | null;
    discountBps: number;
    discountPercent: number;
  }> {
    const account = await this.getOrCreateAccount(userId);
    const balance = parseFloat(account.balance);

    const tiersInOrder: Array<keyof typeof TIER_THRESHOLDS> = [
      "bronze",
      "silver",
      "gold",
      "platinum",
    ];
    const currentIndex = tiersInOrder.indexOf(account.tier);
    const nextTier =
      currentIndex < tiersInOrder.length - 1
        ? tiersInOrder[currentIndex + 1]
        : null;

    const discountBps = TIER_DISCOUNT_BPS[account.tier] ?? 0;

    return {
      points: balance,
      tier: account.tier,
      nextTier,
      nextTierThreshold: nextTier ? TIER_THRESHOLDS[nextTier] : null,
      discountBps,
      discountPercent: discountBps / 100,
    };
  },
};
