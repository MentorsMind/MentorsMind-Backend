import { PushNotificationService } from "../push-notification.service";
import { PushTokensModel } from "../../models/push-tokens.model";
import pool from "../../config/database";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
  pool: {
    query: jest.fn(),
  },
}));

jest.mock("../../models/push-tokens.model", () => ({
  PushTokensModel: {
    getActiveTokensByUserId: jest.fn(),
    updateLastUsed: jest.fn(),
    deleteByToken: jest.fn(),
  },
}));

describe("PushNotificationService (#919)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("sendToUser", () => {
    it("handles missing tokens gracefully", async () => {
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue([]);

      const result = await PushNotificationService.sendToUser("user-1", {
        title: "Session Reminder",
        body: "Your session starts in 15 minutes",
        deepLink: "mentorminds://session/123",
      });

      expect(result.success).toBe(false);
      expect(result.successCount).toBe(0);
      expect(result.errors).toContain("No active push tokens found for user");
    });

    it("delivers rich push notification when tokens exist", async () => {
      (PushTokensModel.getActiveTokensByUserId as jest.Mock).mockResolvedValue([
        {
          id: "tok-1",
          user_id: "user-1",
          token: "fcm_token_123",
          device_type: "android",
          is_active: true,
          is_valid: true,
        },
      ]);
      (PushTokensModel.updateLastUsed as jest.Mock).mockResolvedValue(true);

      const result = await PushNotificationService.sendToUser("user-1", {
        title: "New Booking Request",
        body: "Alice requested a 1-hour session",
        deepLink: "mentorminds://bookings/456",
        priority: "high",
        actions: [{ id: "accept", title: "Accept" }, { id: "decline", title: "Decline" }],
      });

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(1);
      expect(PushTokensModel.updateLastUsed).toHaveBeenCalledWith("fcm_token_123");
    });
  });

  describe("sendToSegment and Analytics", () => {
    it("resolves segment filters and sends notifications", async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: "user-1" }, { id: "user-2" }],
        })
        .mockResolvedValueOnce({
          rows: [
            { id: "tok-1", user_id: "user-1", token: "tok_1", device_type: "ios" },
            { id: "tok-2", user_id: "user-2", token: "tok_2", device_type: "android" },
          ],
        });

      const result = await PushNotificationService.sendToSegment(
        { role: "mentor", tier: "gold" },
        { title: "Mentor Update", body: "Check new student inquiries" }
      );

      expect(result.targetUsersCount).toBe(2);
      expect(result.successCount).toBe(2);
    });

    it("computes delivery and open rate analytics", () => {
      PushNotificationService.recordNotificationOpened("test_notif_1", "user-1");
      const analytics = PushNotificationService.getAnalytics();

      expect(analytics).toBeDefined();
      expect(typeof analytics.totalSent).toBe("number");
      expect(typeof analytics.deliveryRatePercent).toBe("number");
      expect(typeof analytics.openRatePercent).toBe("number");
    });
  });
});
