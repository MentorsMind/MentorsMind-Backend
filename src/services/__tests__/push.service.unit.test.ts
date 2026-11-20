import * as admin from "firebase-admin";
import { PushService } from "../push.service";
import { pushTokenInvalidTotal } from "../../config/metrics";

jest.mock("firebase-admin", () => ({
  __esModule: true,
  apps: [{}],
  messaging: jest.fn(),
}));

jest.mock("../../models/push-tokens.model", () => ({
  PushTokensModel: {
    deleteByToken: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock("../users.service", () => ({
  UsersService: {
    getNotificationPreferences: jest.fn(),
  },
}));

jest.mock("../notification.service", () => ({
  NotificationChannel: { PUSH: "push" },
}));

jest.mock("../../config/metrics", () => ({
  pushTokenInvalidTotal: { inc: jest.fn() },
  pushNotificationsSentTotal: { inc: jest.fn() },
}));

describe("PushService invalid token metrics", () => {
  const sendEachForMulticast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (admin.messaging as jest.Mock).mockReturnValue({ sendEachForMulticast });
  });

  it("increments the invalid-token counter with the FCM error reason", async () => {
    sendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        {
          success: false,
          error: { code: "messaging/registration-token-not-registered" },
        },
      ],
    });

    const result = await PushService.sendToTokens(["invalid-token"], {
      title: "Test",
      body: "Test",
    });

    expect(result.invalidTokens).toEqual(["invalid-token"]);
    expect(pushTokenInvalidTotal.inc).toHaveBeenCalledWith({
      reason: "messaging/registration-token-not-registered",
    });
  });
});
