import request from "supertest";
import app from "../../../src/app";
import { setupContainers, teardownContainers } from "../setup";
import pool from "../../../src/config/database";
import { SubscriptionService, TIER_FEATURES } from "../../../src/services/subscription.service";
import { logger } from "../../../src/utils/logger";

describe("Subscription Tier Change Integration Tests", () => {
  const testUserId = "test-user-tier-change";
  let testSubscriptionId: string;

  beforeAll(async () => {
    await setupContainers();
  });

  afterAll(async () => {
    await teardownContainers();
  });

  // Mock auth middleware to inject user ID
  beforeEach(() => {
    jest.doMock("../../../src/middleware/auth.middleware", () => ({
      authenticate: (req: any, res: any, next: any) => {
        req.user = { id: testUserId, role: "user" };
        next();
      },
    }));
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe("Upgrade from free to pro", () => {
    it("should upgrade user from free (synthetic) to pro tier", async () => {
      // User starts with a synthetic free subscription
      const currentSub = await SubscriptionService.getCurrent(testUserId);
      expect(currentSub.tier).toBe("free");
      expect(currentSub.features).toEqual(TIER_FEATURES.free);

      // Subscribe to pro
      const proSub = await SubscriptionService.subscribe(testUserId, "pro", "monthly");

      expect(proSub).toBeDefined();
      expect(proSub.tier).toBe("pro");
      expect(proSub.billing_cycle).toBe("monthly");
      expect(proSub.features).toEqual(TIER_FEATURES.pro);
      expect(proSub.status).toBe("active");
      expect(proSub.end_date).toBeDefined();
      expect(proSub.cancelled_at).toBeNull();

      testSubscriptionId = proSub.id;

      // Verify features are correct
      expect(proSub.features).toContain("unlimited_sessions");
      expect(proSub.features).toContain("priority_support");
      expect(proSub.features).toContain("analytics_basic");
      expect(proSub.features).toContain("calendar_sync");

      // Verify it's not free tier
      expect(proSub.features).not.toContain("5_sessions_per_month");
    });
  });

  describe("Upgrade from pro to premium", () => {
    it("should upgrade user from pro to premium tier", async () => {
      // First subscribe to pro
      const proSub = await SubscriptionService.subscribe(testUserId, "pro", "monthly");
      expect(proSub.tier).toBe("pro");

      // Upgrade to premium
      const premiumSub = await SubscriptionService.subscribe(testUserId, "premium", "monthly");

      expect(premiumSub.tier).toBe("premium");
      expect(premiumSub.features).toEqual(TIER_FEATURES.premium);
      expect(premiumSub.features).toContain("recording");
      expect(premiumSub.features).toContain("custom_branding");

      // Pro subscription should be cancelled
      const proSubAfter = await pool.query(
        `SELECT status FROM subscriptions WHERE id = $1`,
        [proSub.id]
      );
      if (proSubAfter.rows.length > 0) {
        expect(proSubAfter.rows[0].status).toBe("cancelled");
      }

      testSubscriptionId = premiumSub.id;
    });
  });

  describe("Downgrade from pro to free", () => {
    it("should downgrade user from pro to free tier", async () => {
      // First subscribe to pro
      const proSub = await SubscriptionService.subscribe(testUserId, "pro", "monthly");
      expect(proSub.tier).toBe("pro");

      // Downgrade to free by cancelling
      const cancelledSub = await SubscriptionService.cancel(testUserId, proSub.id);

      expect(cancelledSub.tier).toBe("pro"); // Tier doesn't change on cancel
      expect(cancelledSub.status).toBe("cancelled");
      expect(cancelledSub.cancelled_at).toBeDefined();
      expect(cancelledSub.cancelled_at).not.toBeNull();

      // User should now have synthetic free subscription
      const currentSub = await SubscriptionService.getCurrent(testUserId);
      expect(currentSub.tier).toBe("free");
    });
  });

  describe("Downgrade from premium to pro", () => {
    it("should downgrade user from premium to pro with tier features verification", async () => {
      // Subscribe to premium
      const premiumSub = await SubscriptionService.subscribe(testUserId, "premium", "yearly");
      expect(premiumSub.tier).toBe("premium");
      expect(premiumSub.features).toContain("recording");

      // Downgrade to pro
      const proSub = await SubscriptionService.subscribe(testUserId, "pro", "monthly");

      expect(proSub.tier).toBe("pro");
      expect(proSub.features).toEqual(TIER_FEATURES.pro);
      expect(proSub.features).not.toContain("recording");
      expect(proSub.features).not.toContain("custom_branding");

      // Previous premium subscription should be cancelled
      const premiumSubAfter = await pool.query(
        `SELECT status, cancelled_at FROM subscriptions WHERE id = $1`,
        [premiumSub.id]
      );
      if (premiumSubAfter.rows.length > 0) {
        expect(premiumSubAfter.rows[0].status).toBe("cancelled");
        expect(premiumSubAfter.rows[0].cancelled_at).not.toBeNull();
      }

      testSubscriptionId = proSub.id;
    });
  });

  describe("Cancellation mid-period", () => {
    it("should cancel subscription mid-period with cancelled_at timestamp", async () => {
      const preSub = await SubscriptionService.subscribe(testUserId, "pro", "monthly");
      const beforeCancel = new Date();

      // Cancel immediately (mid-period)
      const cancelledSub = await SubscriptionService.cancel(testUserId, preSub.id);

      expect(cancelledSub.status).toBe("cancelled");
      expect(cancelledSub.cancelled_at).toBeDefined();
      expect(cancelledSub.cancelled_at).not.toBeNull();

      const cancelledAt = new Date(cancelledSub.cancelled_at!);
      expect(cancelledAt.getTime()).toBeGreaterThanOrEqual(beforeCancel.getTime() - 1000);
      expect(cancelledAt.getTime()).toBeLessThanOrEqual(new Date().getTime() + 1000);
    });
  });

  describe("Subscription status after cancellation at period end", () => {
    it("should have cancelled status immediately after cancellation", async () => {
      const sub = await SubscriptionService.subscribe(testUserId, "premium", "monthly");
      expect(sub.status).toBe("active");

      const cancelledSub = await SubscriptionService.cancel(testUserId, sub.id);

      expect(cancelledSub.status).toBe("cancelled");
      expect(cancelledSub.cancelled_at).not.toBeNull();

      // Verify in database
      const dbResult = await pool.query(
        `SELECT status, cancelled_at FROM subscriptions WHERE id = $1`,
        [sub.id]
      );

      expect(dbResult.rows.length).toBeGreaterThan(0);
      expect(dbResult.rows[0].status).toBe("cancelled");
      expect(dbResult.rows[0].cancelled_at).not.toBeNull();
    });

    it("should have cancelled status persisted in database", async () => {
      const sub = await SubscriptionService.subscribe(testUserId, "pro", "yearly");

      await SubscriptionService.cancel(testUserId, sub.id);

      // Query database directly
      const dbResult = await pool.query(
        `SELECT * FROM subscriptions WHERE id = $1 AND user_id = $2`,
        [sub.id, testUserId]
      );

      expect(dbResult.rows.length).toBe(1);
      const cancelled = dbResult.rows[0];
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancelled_at).not.toBeNull();
      expect(cancelled.user_id).toBe(testUserId);
    });
  });

  describe("Active sessions with tier change", () => {
    it("should handle tier change when user has active subscriptions", async () => {
      // Create initial subscription
      const sub1 = await SubscriptionService.subscribe(testUserId, "pro", "monthly");
      expect(sub1.status).toBe("active");

      // Get current subscription
      const currentBefore = await SubscriptionService.getCurrent(testUserId);
      expect(currentBefore.tier).toBe("pro");

      // Upgrade tier
      const sub2 = await SubscriptionService.subscribe(testUserId, "premium", "monthly");
      expect(sub2.tier).toBe("premium");
      expect(sub2.status).toBe("active");

      // Previous subscription should be cancelled
      const sub1After = await pool.query(
        `SELECT status FROM subscriptions WHERE id = $1`,
        [sub1.id]
      );
      if (sub1After.rows.length > 0) {
        expect(sub1After.rows[0].status).toBe("cancelled");
      }

      // Get current subscription
      const currentAfter = await SubscriptionService.getCurrent(testUserId);
      expect(currentAfter.tier).toBe("premium");
    });
  });

  describe("Feature flag effects of tier change", () => {
    it("should have correct features for each tier after upgrade", async () => {
      // Free -> Pro
      const proSub = await SubscriptionService.subscribe(testUserId, "pro", "monthly");
      expect(proSub.features).toEqual(TIER_FEATURES.pro);

      // Pro -> Premium
      const premiumSub = await SubscriptionService.subscribe(testUserId, "premium", "monthly");
      expect(premiumSub.features).toEqual(TIER_FEATURES.premium);

      // Premium features should be superset of Pro
      TIER_FEATURES.pro.forEach((feature) => {
        expect(TIER_FEATURES.premium).toContain(feature);
      });
    });

    it("should verify enterprise tier has all advanced features", async () => {
      const entSub = await SubscriptionService.subscribe(testUserId, "enterprise", "yearly");

      expect(entSub.tier).toBe("enterprise");
      expect(entSub.features).toEqual(TIER_FEATURES.enterprise);

      // Enterprise should have all features from lower tiers plus more
      expect(entSub.features).toContain("sso");
      expect(entSub.features).toContain("api_access");
      expect(entSub.features).toContain("sla");
      expect(entSub.features).toContain("dedicated_support");

      // Verify it includes premium features
      TIER_FEATURES.premium.forEach((feature) => {
        expect(entSub.features).toContain(feature);
      });

      testSubscriptionId = entSub.id;
    });
  });

  describe("Billing cycle changes during tier change", () => {
    it("should allow changing billing cycle on tier upgrade", async () => {
      const monthlySub = await SubscriptionService.subscribe(testUserId, "pro", "monthly");
      expect(monthlySub.billing_cycle).toBe("monthly");

      // Upgrade to premium with yearly billing
      const yearlySub = await SubscriptionService.subscribe(
        testUserId,
        "premium",
        "yearly"
      );

      expect(yearlySub.tier).toBe("premium");
      expect(yearlySub.billing_cycle).toBe("yearly");

      // End dates should reflect different billing cycles
      if (monthlySub.end_date && yearlySub.end_date) {
        const monthlyDuration =
          monthlySub.end_date.getTime() - monthlySub.start_date.getTime();
        const yearlyDuration =
          yearlySub.end_date.getTime() - yearlySub.start_date.getTime();

        expect(yearlyDuration).toBeGreaterThan(monthlyDuration);
      }

      testSubscriptionId = yearlySub.id;
    });
  });

  describe("List subscriptions history", () => {
    it("should list all subscriptions for user including cancelled ones", async () => {
      // Create and cancel multiple subscriptions
      const sub1 = await SubscriptionService.subscribe(testUserId, "pro", "monthly");
      const sub2 = await SubscriptionService.subscribe(testUserId, "premium", "monthly");

      // Get all subscriptions
      const allSubs = await SubscriptionService.listByUser(testUserId);

      expect(allSubs.length).toBeGreaterThanOrEqual(1);

      // Should include the active subscription
      const activeSub = allSubs.find((s) => s.status === "active");
      expect(activeSub).toBeDefined();
      expect(activeSub?.tier).toBe("premium");

      // Should include cancelled subscriptions
      const cancelledSubs = allSubs.filter((s) => s.status === "cancelled");
      expect(cancelledSubs.length).toBeGreaterThan(0);
    });
  });

  describe("Error handling", () => {
    it("should throw error when cancelling non-existent subscription", async () => {
      await expect(
        SubscriptionService.cancel(testUserId, "non-existent-id")
      ).rejects.toThrow("Subscription not found or already cancelled");
    });

    it("should throw error when cancelling already cancelled subscription", async () => {
      const sub = await SubscriptionService.subscribe(testUserId, "pro", "monthly");
      await SubscriptionService.cancel(testUserId, sub.id);

      // Try to cancel again
      await expect(
        SubscriptionService.cancel(testUserId, sub.id)
      ).rejects.toThrow();
    });
  });
});
