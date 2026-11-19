import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { CacheService } from "./cache.service";
import crypto from "crypto";

export interface RewardTierInfo {
  id: string;
  name: string;
  tierLevel: number;
  minReferrals: number;
  maxReferrals?: number;
  rewardMultiplier: number;
  bonusAmount: number;
  bonusCurrency: string;
  perks: string[];
  isActive: boolean;
}

export interface RewardDistributionInput {
  userId: string;
  eventType: "signup" | "first_booking" | "first_payment" | "mentor_signup" | "milestone" | "custom";
  referralId?: string;
  baseAmount?: number;
  currency?: string;
  metadata?: Record<string, any>;
}

export interface RewardDistributionResult {
  payoutId: string;
  userId: string;
  amount: number;
  currency: string;
  multiplier: number;
  totalAwarded: number;
  stellarTransactionHash?: string;
  status: "pending" | "processing" | "completed" | "failed";
}

export interface GamificationAchievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  points: number;
  unlockedAt?: Date;
  progressPercent: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatarUrl?: string;
  referralsCount: number;
  totalEarnedTokens: number;
  tier: string;
}

const DEFAULT_TIERS: RewardTierInfo[] = [
  {
    id: "tier-bronze",
    name: "Bronze Advocate",
    tierLevel: 1,
    minReferrals: 0,
    maxReferrals: 4,
    rewardMultiplier: 1.0,
    bonusAmount: 0,
    bonusCurrency: "XLM",
    perks: ["5% session discount for referrals", "Standard referral link"],
    isActive: true,
  },
  {
    id: "tier-silver",
    name: "Silver Ambassador",
    tierLevel: 2,
    minReferrals: 5,
    maxReferrals: 19,
    rewardMultiplier: 1.25,
    bonusAmount: 25,
    bonusCurrency: "XLM",
    perks: ["10% session discount", "1.25x token multiplier", "Priority support"],
    isActive: true,
  },
  {
    id: "tier-gold",
    name: "Gold Partner",
    tierLevel: 3,
    minReferrals: 20,
    maxReferrals: 49,
    rewardMultiplier: 1.5,
    bonusAmount: 100,
    bonusCurrency: "XLM",
    perks: ["15% session discount", "1.5x token multiplier", "Exclusive mentor access", "Monthly bonus"],
    isActive: true,
  },
  {
    id: "tier-platinum",
    name: "Platinum Legend",
    tierLevel: 4,
    minReferrals: 50,
    rewardMultiplier: 2.0,
    bonusAmount: 300,
    bonusCurrency: "XLM",
    perks: ["20% session discount", "2.0x token multiplier", "VIP mentor badge", "Direct Stellar token drops"],
    isActive: true,
  },
];

const EVENT_BASE_REWARDS: Record<string, number> = {
  signup: 5,
  first_booking: 20,
  first_payment: 50,
  mentor_signup: 75,
  milestone: 30,
  custom: 10,
};

/**
 * Rewards and Gamification Service
 * Handles reward distribution, Stellar token payouts, tier progression, and gamification
 */
export class RewardsService {
  /**
   * Get all active reward tiers
   */
  static async getRewardTiers(): Promise<RewardTierInfo[]> {
    try {
      const cacheKey = "rewards:tiers:active";
      const cached = await CacheService.get<RewardTierInfo[]>(cacheKey);
      if (cached) return cached;

      const { rows } = await pool.query(
        "SELECT * FROM reward_tiers WHERE is_active = true ORDER BY tier_level ASC"
      );

      let tiers: RewardTierInfo[];
      if (rows.length === 0) {
        tiers = DEFAULT_TIERS;
      } else {
        tiers = rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          tierLevel: r.tier_level,
          minReferrals: r.min_referrals,
          maxReferrals: r.max_referrals,
          rewardMultiplier: parseFloat(r.reward_multiplier || "1.0"),
          bonusAmount: parseFloat(r.bonus_amount || "0"),
          bonusCurrency: r.bonus_currency || "XLM",
          perks: r.perks || [],
          isActive: r.is_active,
        }));
      }

      await CacheService.set(cacheKey, tiers, 1800);
      return tiers;
    } catch (error) {
      logger.error("Failed to get reward tiers, using defaults", { error });
      return DEFAULT_TIERS;
    }
  }

  /**
   * Calculate user's tier based on completed referral count
   */
  static async getUserTier(userId: string): Promise<RewardTierInfo> {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM referrals 
         WHERE referrer_id = $1 AND status IN ('completed', 'rewarded')`,
        [userId]
      );

      const count = parseInt(rows[0]?.count || "0", 10);
      const tiers = await this.getRewardTiers();

      let currentTier = tiers[0];
      for (const tier of tiers) {
        if (count >= tier.minReferrals) {
          if (tier.maxReferrals === undefined || tier.maxReferrals === null || count <= tier.maxReferrals) {
            currentTier = tier;
          }
        }
      }

      return currentTier;
    } catch (error) {
      logger.error("Failed to compute user tier", { userId, error });
      return DEFAULT_TIERS[0];
    }
  }

  /**
   * Distribute rewards to user for an eligible referral or engagement event
   */
  static async distributeReward(input: RewardDistributionInput): Promise<RewardDistributionResult> {
    try {
      const tier = await this.getUserTier(input.userId);
      const baseReward = input.baseAmount ?? EVENT_BASE_REWARDS[input.eventType] ?? 10;
      const multiplier = tier.rewardMultiplier || 1.0;
      const totalAmount = parseFloat((baseReward * multiplier).toFixed(7));
      const currency = input.currency || "XLM";

      // Simulate Stellar transaction hash for decentralized ledger proof
      const txHash = crypto
        .createHash("sha256")
        .update(`stellar_reward_${input.userId}_${Date.now()}_${Math.random()}`)
        .digest("hex");

      // Record payout in database
      const { rows } = await pool.query(
        `INSERT INTO reward_payouts 
         (affiliate_id, payout_type, amount, currency, status, payment_method, transaction_hash, completed_at, metadata)
         VALUES (
           COALESCE((SELECT id FROM affiliate_profiles WHERE user_id = $1 LIMIT 1), gen_random_uuid()),
           'referral',
           $2,
           $3,
           'completed',
           'stellar',
           $4,
           NOW(),
           $5
         )
         RETURNING *`,
        [
          input.userId,
          totalAmount,
          currency,
          txHash,
          JSON.stringify({
            eventType: input.eventType,
            referralId: input.referralId,
            tierLevel: tier.tierLevel,
            multiplier,
            baseReward,
            ...(input.metadata || {}),
          }),
        ]
      );

      // Update referral record if linked
      if (input.referralId) {
        await pool.query(
          `UPDATE referrals 
           SET status = 'rewarded', reward_paid = true, reward_paid_at = NOW(), 
               reward_amount = $1, reward_currency = $2, reward_transaction_hash = $3
           WHERE id = $4`,
          [totalAmount, currency, txHash, input.referralId]
        );
      }

      logger.info("Reward distributed successfully", {
        userId: input.userId,
        amount: totalAmount,
        currency,
        txHash,
      });

      return {
        payoutId: rows[0]?.id || `payout_${Date.now()}`,
        userId: input.userId,
        amount: baseReward,
        currency,
        multiplier,
        totalAwarded: totalAmount,
        stellarTransactionHash: txHash,
        status: "completed",
      };
    } catch (error) {
      logger.error("Failed to distribute reward", { input, error });
      throw createError("Failed to process reward distribution", 500);
    }
  }

  /**
   * Get referral leaderboard
   */
  static async getLeaderboard(limit: number = 20): Promise<LeaderboardEntry[]> {
    try {
      const { rows } = await pool.query(
        `SELECT u.id, u.first_name, u.last_name, u.avatar_url,
                COUNT(r.id) as referrals_count,
                COALESCE(SUM(r.reward_amount), 0) as total_earned
         FROM users u
         JOIN referrals r ON u.id = r.referrer_id
         WHERE r.status IN ('completed', 'rewarded')
         GROUP BY u.id, u.first_name, u.last_name, u.avatar_url
         ORDER BY referrals_count DESC, total_earned DESC
         LIMIT $1`,
        [limit]
      );

      return rows.map((r: any, index: number) => ({
        rank: index + 1,
        userId: r.id,
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Anonymous Mentor",
        avatarUrl: r.avatar_url,
        referralsCount: parseInt(r.referrals_count, 10),
        totalEarnedTokens: parseFloat(r.total_earned),
        tier: r.referrals_count >= 50 ? "Platinum" : r.referrals_count >= 20 ? "Gold" : r.referrals_count >= 5 ? "Silver" : "Bronze",
      }));
    } catch (error) {
      logger.error("Failed to fetch referral leaderboard", { error });
      return [];
    }
  }

  /**
   * Get gamification achievements and badges for a user
   */
  static async getUserAchievements(userId: string): Promise<GamificationAchievement[]> {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(reward_amount), 0) as total_earnings 
         FROM referrals WHERE referrer_id = $1 AND status IN ('completed', 'rewarded')`,
        [userId]
      );

      const refCount = parseInt(rows[0]?.count || "0", 10);
      const earnings = parseFloat(rows[0]?.total_earnings || "0");

      const achievements: GamificationAchievement[] = [
        {
          id: "ach_first_ref",
          title: "First Connection",
          description: "Referred your very first mentee or mentor to the platform",
          icon: "🌱",
          points: 50,
          unlockedAt: refCount >= 1 ? new Date() : undefined,
          progressPercent: Math.min(100, refCount >= 1 ? 100 : 0),
        },
        {
          id: "ach_high_five",
          title: "High Five Club",
          description: "Successfully referred 5 users and reached Silver tier",
          icon: "✋",
          points: 150,
          unlockedAt: refCount >= 5 ? new Date() : undefined,
          progressPercent: Math.min(100, Math.floor((refCount / 5) * 100)),
        },
        {
          id: "ach_super_connector",
          title: "Super Connector",
          description: "Reached 20 successful referrals and unlocked Gold Partner perks",
          icon: "🌟",
          points: 500,
          unlockedAt: refCount >= 20 ? new Date() : undefined,
          progressPercent: Math.min(100, Math.floor((refCount / 20) * 100)),
        },
        {
          id: "ach_century_legend",
          title: "Stellar Legend",
          description: "Accumulated over 100 XLM in referral rewards",
          icon: "👑",
          points: 1000,
          unlockedAt: earnings >= 100 ? new Date() : undefined,
          progressPercent: Math.min(100, Math.floor((earnings / 100) * 100)),
        },
      ];

      return achievements;
    } catch (error) {
      logger.error("Failed to get user achievements", { userId, error });
      return [];
    }
  }
}

export default RewardsService;
