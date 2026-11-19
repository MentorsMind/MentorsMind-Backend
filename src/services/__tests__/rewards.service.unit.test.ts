import { RewardsService } from "../rewards.service";
import pool from "../../config/database";
import { CacheService } from "../cache.service";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
  pool: {
    query: jest.fn(),
  },
}));

jest.mock("../cache.service", () => ({
  CacheService: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

describe("RewardsService (#918)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getRewardTiers", () => {
    it("returns reward tiers correctly", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [
          {
            id: "tier-1",
            name: "Bronze Advocate",
            tier_level: 1,
            min_referrals: 0,
            max_referrals: 4,
            reward_multiplier: "1.0",
            bonus_amount: "0",
            bonus_currency: "XLM",
            perks: ["5% discount"],
            is_active: true,
          },
          {
            id: "tier-2",
            name: "Silver Ambassador",
            tier_level: 2,
            min_referrals: 5,
            max_referrals: 19,
            reward_multiplier: "1.25",
            bonus_amount: "25",
            bonus_currency: "XLM",
            perks: ["10% discount"],
            is_active: true,
          },
        ],
      });

      const tiers = await RewardsService.getRewardTiers();
      expect(tiers).toHaveLength(2);
      expect(tiers[0].name).toBe("Bronze Advocate");
      expect(tiers[1].rewardMultiplier).toBe(1.25);
    });
  });

  describe("distributeReward", () => {
    it("applies tier multipliers and creates payout with Stellar tx hash", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock)
        // User tier referral count query
        .mockResolvedValueOnce({ rows: [{ count: "10" }] })
        // Tiers query
        .mockResolvedValueOnce({
          rows: [
            { id: "tier-1", tier_level: 1, min_referrals: 0, max_referrals: 4, reward_multiplier: "1.0" },
            { id: "tier-2", tier_level: 2, min_referrals: 5, max_referrals: 19, reward_multiplier: "1.25" },
          ],
        })
        // Payout insertion query
        .mockResolvedValueOnce({ rows: [{ id: "payout-999" }] })
        // Referral update query
        .mockResolvedValueOnce({ rows: [] });

      const result = await RewardsService.distributeReward({
        userId: "user-123",
        eventType: "first_booking",
        referralId: "ref-456",
        baseAmount: 20,
      });

      expect(result.payoutId).toBe("payout-999");
      expect(result.multiplier).toBe(1.25);
      expect(result.totalAwarded).toBe(25);
      expect(result.stellarTransactionHash).toBeDefined();
      expect(result.status).toBe("completed");
    });
  });

  describe("getLeaderboard and getUserAchievements", () => {
    it("returns sorted leaderboard and gamification achievements", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            id: "u-1",
            first_name: "Alice",
            last_name: "Stellar",
            avatar_url: "alice.jpg",
            referrals_count: "25",
            total_earned: "350.5",
          },
        ],
      });

      const leaderboard = await RewardsService.getLeaderboard(10);
      expect(leaderboard).toHaveLength(1);
      expect(leaderboard[0].name).toBe("Alice Stellar");
      expect(leaderboard[0].rank).toBe(1);
      expect(leaderboard[0].tier).toBe("Gold");

      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ count: "5", total_earnings: "75.0" }],
      });

      const achievements = await RewardsService.getUserAchievements("u-1");
      expect(achievements.length).toBeGreaterThanOrEqual(4);
      expect(achievements[0].unlockedAt).toBeDefined();
      expect(achievements[1].unlockedAt).toBeDefined();
    });
  });
});
