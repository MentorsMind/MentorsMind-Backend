import { LoyaltyService, TIER_THRESHOLDS, computeTier } from "../loyalty.service";
import pool from "../../config/database";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

const mockedQuery = pool.query as jest.Mock;

function mockAccountRow(balance: string) {
  mockedQuery.mockResolvedValue({
    rows: [
      {
        user_id: "user-1",
        balance,
        earned: balance,
        redeemed: "0",
      },
    ],
  });
}

describe("LoyaltyService tier calculation (#1075)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("computeTier boundary values (N-1, N, N+1)", () => {
    it("returns bronze at and below the bronze threshold", () => {
      expect(computeTier(TIER_THRESHOLDS.bronze)).toBe("bronze");
      expect(computeTier(TIER_THRESHOLDS.bronze - 1)).toBe("bronze");
      expect(computeTier(-100)).toBe("bronze");
    });

    it("returns bronze at 99 points, silver at exactly 100 points", () => {
      const { silver } = TIER_THRESHOLDS;
      expect(computeTier(silver - 1)).toBe("bronze");
      expect(computeTier(silver)).toBe("silver");
      expect(computeTier(silver + 1)).toBe("silver");
    });

    it("maps session counts to tiers (10 pts per completed session)", () => {
      // 9 completed sessions → 90 points → bronze
      // 10 completed sessions → 100 points → silver
      const pointsPerSession = 10;
      expect(computeTier(9 * pointsPerSession)).toBe("bronze");
      expect(computeTier(10 * pointsPerSession)).toBe("silver");
      expect(computeTier(11 * pointsPerSession)).toBe("silver");
    });

    it("returns silver at 499 points, gold at exactly 500 points", () => {
      const { gold } = TIER_THRESHOLDS;
      expect(computeTier(gold - 1)).toBe("silver");
      expect(computeTier(gold)).toBe("gold");
      expect(computeTier(gold + 1)).toBe("gold");
    });

    it("returns gold at 1999 points, platinum at exactly 2000 points", () => {
      const { platinum } = TIER_THRESHOLDS;
      expect(computeTier(platinum - 1)).toBe("gold");
      expect(computeTier(platinum)).toBe("platinum");
      expect(computeTier(platinum + 1)).toBe("platinum");
    });
  });

  describe("getOrCreateAccount tier from stored spending balance", () => {
    it.each([
      [TIER_THRESHOLDS.silver - 1, "bronze"],
      [TIER_THRESHOLDS.silver, "silver"],
      [TIER_THRESHOLDS.silver + 1, "silver"],
      [TIER_THRESHOLDS.gold - 1, "silver"],
      [TIER_THRESHOLDS.gold, "gold"],
      [TIER_THRESHOLDS.gold + 1, "gold"],
      [TIER_THRESHOLDS.platinum - 1, "gold"],
      [TIER_THRESHOLDS.platinum, "platinum"],
      [TIER_THRESHOLDS.platinum + 1, "platinum"],
    ])("balance %i → %s", async (balance, expectedTier) => {
      mockAccountRow(String(balance));

      const account = await LoyaltyService.getOrCreateAccount("user-1");

      expect(account.tier).toBe(expectedTier);
      expect(account.balance).toBe(String(balance));
      expect(account.benefits.length).toBeGreaterThan(0);
      expect(mockedQuery).toHaveBeenCalledWith(
        "SELECT * FROM loyalty_accounts WHERE user_id=$1",
        ["user-1"],
      );
    });

    it("creates a fresh bronze account with zero balance", async () => {
      mockedQuery.mockResolvedValue({ rows: [] });

      const account = await LoyaltyService.getOrCreateAccount("new-user");

      expect(account).toEqual({
        userId: "new-user",
        balance: "0",
        earned: "0",
        redeemed: "0",
        tier: "bronze",
        benefits: expect.any(Array),
      });
      // Second call performs the INSERT of the zero-balance row
      expect(mockedQuery).toHaveBeenCalledTimes(2);
      expect(mockedQuery.mock.calls[1][0]).toContain(
        "INSERT INTO loyalty_accounts",
      );
    });
  });

  describe("getStatus — tier, next tier, and spending thresholds", () => {
    it("reports the next tier threshold at each boundary", async () => {
      mockAccountRow(String(TIER_THRESHOLDS.silver));

      const status = await LoyaltyService.getStatus("user-1");

      expect(status.tier).toBe("silver");
      expect(status.points).toBe(TIER_THRESHOLDS.silver);
      expect(status.nextTier).toBe("gold");
      expect(status.nextTierThreshold).toBe(TIER_THRESHOLDS.gold);
      expect(status.discountBps).toBe(50);
      expect(status.discountPercent).toBe(0.5);
    });

    it("returns null next tier at the platinum boundary", async () => {
      mockAccountRow(String(TIER_THRESHOLDS.platinum));

      const status = await LoyaltyService.getStatus("user-1");

      expect(status.tier).toBe("platinum");
      expect(status.nextTier).toBeNull();
      expect(status.nextTierThreshold).toBeNull();
      expect(status.discountBps).toBe(150);
      expect(status.discountPercent).toBe(1.5);
    });

    it("still points bronze users at the silver threshold", async () => {
      mockAccountRow("0");

      const status = await LoyaltyService.getStatus("user-1");

      expect(status.tier).toBe("bronze");
      expect(status.nextTier).toBe("silver");
      expect(status.nextTierThreshold).toBe(TIER_THRESHOLDS.silver);
      expect(status.discountBps).toBe(0);
    });
  });

  describe("getDiscountBps per tier", () => {
    it.each([
      [TIER_THRESHOLDS.bronze, "bronze", 0],
      [TIER_THRESHOLDS.silver, "silver", 50],
      [TIER_THRESHOLDS.gold, "gold", 100],
      [TIER_THRESHOLDS.platinum, "platinum", 150],
    ])(
      "balance %i (%s) → %i bps",
      async (balance, expectedTier, expectedBps) => {
        mockAccountRow(String(balance));

        const bps = await LoyaltyService.getDiscountBps("user-1");

        expect(bps).toBe(expectedBps);
        const account = await LoyaltyService.getOrCreateAccount("user-1");
        expect(account.tier).toBe(expectedTier);
      },
    );
  });

  describe("earn rules backing the session → points → tier path", () => {
    it("grants 10 points per completed session (10 sessions reach silver)", async () => {
      const rules = await LoyaltyService.getEarnRules();
      const sessionRule = rules.find((r) => r.action === "complete_session");

      expect(sessionRule).toBeDefined();
      expect(sessionRule!.tokensEarned).toBe("10");

      const tenSessionsPoints =
        parseInt(sessionRule!.tokensEarned, 10) * 10;
      expect(computeTier(tenSessionsPoints)).toBe("silver");
      expect(computeTier(tenSessionsPoints - 10)).toBe("bronze");
    });
  });
});
