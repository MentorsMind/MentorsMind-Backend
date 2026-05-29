/**
 * ZapierService Integration Tests
 *
 * Tests the SQL parameter placeholder fix in unsubscribe method - ensures $N syntax is used correctly
 * when building dynamic DELETE queries for webhook unsubscription.
 */
import { ZapierService } from "../../services/zapier.service";
import { createZapierApiKey, createZapierWebhookSubscription, createZapierWebhookSubscriptionWithUser } from "../factories/zapier.factory";
import { testPool } from "../setup/testDb";

describe("ZapierService Integration", () => {
  describe("unsubscribe", () => {
    it("should unsubscribe by subscription ID", async () => {
      const { apiKey, subscription } = await createZapierWebhookSubscriptionWithUser();
      
      const context = {
        apiKeyId: apiKey.id,
        ownerUserId: apiKey.owner_user_id,
      };

      const result = await ZapierService.unsubscribe(context, {
        subscriptionId: subscription.id,
      });

      expect(result).toBe(true);

      // Verify the subscription is deleted
      const { rows } = await testPool.query(
        "SELECT id FROM zapier_webhook_subscriptions WHERE id = $1",
        [subscription.id],
      );
      expect(rows).toHaveLength(0);
    });

    it("should unsubscribe by target URL", async () => {
      const { apiKey, subscription } = await createZapierWebhookSubscriptionWithUser();
      
      const context = {
        apiKeyId: apiKey.id,
        ownerUserId: apiKey.owner_user_id,
      };

      const result = await ZapierService.unsubscribe(context, {
        targetUrl: subscription.target_url,
      });

      expect(result).toBe(true);

      // Verify the subscription is deleted
      const { rows } = await testPool.query(
        "SELECT id FROM zapier_webhook_subscriptions WHERE target_url = $1",
        [subscription.target_url],
      );
      expect(rows).toHaveLength(0);
    });

    it("should unsubscribe by both subscription ID and target URL", async () => {
      const { apiKey, subscription } = await createZapierWebhookSubscriptionWithUser();
      
      const context = {
        apiKeyId: apiKey.id,
        ownerUserId: apiKey.owner_user_id,
      };

      const result = await ZapierService.unsubscribe(context, {
        subscriptionId: subscription.id,
        targetUrl: subscription.target_url,
      });

      expect(result).toBe(true);

      // Verify the subscription is deleted
      const { rows } = await testPool.query(
        "SELECT id FROM zapier_webhook_subscriptions WHERE id = $1",
        [subscription.id],
      );
      expect(rows).toHaveLength(0);
    });

    it("should return false when subscription ID not found", async () => {
      const apiKey = await createZapierApiKey();
      
      const context = {
        apiKeyId: apiKey.id,
        ownerUserId: apiKey.owner_user_id,
      };

      const result = await ZapierService.unsubscribe(context, {
        subscriptionId: "00000000-0000-0000-0000-000000000000",
      });

      expect(result).toBe(false);
    });

    it("should return false when target URL not found", async () => {
      const apiKey = await createZapierApiKey();
      
      const context = {
        apiKeyId: apiKey.id,
        ownerUserId: apiKey.owner_user_id,
      };

      const result = await ZapierService.unsubscribe(context, {
        targetUrl: "https://nonexistent.example.com/webhook",
      });

      expect(result).toBe(false);
    });

    it("should only delete subscriptions belonging to the API key", async () => {
      // Create two different API keys with subscriptions
      const apiKey1 = await createZapierApiKey();
      const apiKey2 = await createZapierApiKey();
      
      const subscription1 = await createZapierWebhookSubscription({ apiKeyId: apiKey1.id });
      const subscription2 = await createZapierWebhookSubscription({ apiKeyId: apiKey2.id });

      const context1 = {
        apiKeyId: apiKey1.id,
        ownerUserId: apiKey1.owner_user_id,
      };

      // Try to delete subscription2 using context1 (should fail)
      const result = await ZapierService.unsubscribe(context1, {
        subscriptionId: subscription2.id,
      });

      expect(result).toBe(false);

      // Verify subscription2 still exists
      const { rows } = await testPool.query(
        "SELECT id FROM zapier_webhook_subscriptions WHERE id = $1",
        [subscription2.id],
      );
      expect(rows).toHaveLength(1);

      // Now delete subscription1 using context1 (should succeed)
      const result2 = await ZapierService.unsubscribe(context1, {
        subscriptionId: subscription1.id,
      });

      expect(result2).toBe(true);
    });

    it("should correctly build SQL with proper $N parameter placeholders", async () => {
      // This test verifies the bug fix - ensuring the SQL is built with $N syntax
      // not bare numbers like "id = 2"
      const { apiKey, subscription } = await createZapierWebhookSubscriptionWithUser();
      
      const context = {
        apiKeyId: apiKey.id,
        ownerUserId: apiKey.owner_user_id,
      };

      // Spy on pool.query to capture the generated SQL
      const querySpy = jest.spyOn(testPool, "query");

      await ZapierService.unsubscribe(context, {
        subscriptionId: subscription.id,
        targetUrl: subscription.target_url,
      });

      const calls = querySpy.mock.calls;
      const sqlCall = calls.find((call: [string, ...unknown[]]) =>
        call[0].toString().includes("DELETE FROM zapier_webhook_subscriptions"),
      );

      expect(sqlCall).toBeDefined();
      const sql = sqlCall![0].toString();

      // Verify the SQL contains proper PostgreSQL parameter placeholders ($1, $2, etc.)
      // NOT bare numbers like "id = 2"
      expect(sql).toContain("api_key_id = $1");
      expect(sql).toContain("id = $2");
      expect(sql).toContain("target_url = $3");

      // Ensure there's NO occurrence of "= 2" without the $
      expect(sql).not.toMatch(/= 2[^0-9]/); // should not have "= 2" followed by non-digit
      expect(sql).not.toMatch(/= 3[^0-9]/);

      // Verify the values array contains the correct parameters
      expect(sqlCall![1]).toEqual([
        apiKey.id,
        subscription.id,
        subscription.target_url,
      ]);

      querySpy.mockRestore();
    });

    it("should handle empty params gracefully", async () => {
      const apiKey = await createZapierApiKey();
      
      const context = {
        apiKeyId: apiKey.id,
        ownerUserId: apiKey.owner_user_id,
      };

      // Spy on pool.query to capture the generated SQL
      const querySpy = jest.spyOn(testPool, "query");

      const result = await ZapierService.unsubscribe(context, {});

      expect(result).toBe(false); // No filters means no deletion

      const calls = querySpy.mock.calls;
      const sqlCall = calls.find((call: [string, ...unknown[]]) =>
        call[0].toString().includes("DELETE FROM zapier_webhook_subscriptions"),
      );

      expect(sqlCall).toBeDefined();
      const sql = sqlCall![0].toString();

      // Should only have the api_key_id filter
      expect(sql).toContain("api_key_id = $1");
      expect(sql).not.toContain("id =");
      expect(sql).not.toContain("target_url =");

      querySpy.mockRestore();
    });
  });
});
