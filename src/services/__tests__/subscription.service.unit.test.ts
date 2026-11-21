jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../models/subscription.model", () => ({
  SubscriptionModel: {
    findActiveByUserId: jest.fn(),
    cancel: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock("../database.service", () => ({
  DatabaseService: { withTransaction: jest.fn() },
}));

jest.mock("../../utils/logger.utils", () => ({
  Logger: {},
  logger: { info: jest.fn(), error: jest.fn() },
}));

import { SubscriptionModel } from "../../models/subscription.model";
import { DatabaseService } from "../database.service";
import { SubscriptionService } from "../subscription.service";
import type { SubscriptionRecord } from "../../models/subscription.model";

describe("SubscriptionService.subscribe", () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const existing = { id: "old-subscription" } as SubscriptionRecord;
  const created = { id: "new-subscription" } as SubscriptionRecord;

  beforeEach(() => {
    jest.clearAllMocks();
    (DatabaseService.withTransaction as jest.Mock).mockImplementation(
      async (callback) => callback(client),
    );
    (SubscriptionModel.findActiveByUserId as jest.Mock).mockResolvedValue(
      existing,
    );
    (SubscriptionModel.cancel as jest.Mock).mockResolvedValue(existing);
    (SubscriptionModel.create as jest.Mock).mockResolvedValue(created);
  });

  it("cancels the existing subscription and creates its replacement using the same transaction client", async () => {
    await expect(
      SubscriptionService.subscribe("user-1", "pro", "monthly"),
    ).resolves.toBe(created);

    expect(SubscriptionModel.findActiveByUserId).toHaveBeenCalledWith(
      "user-1",
      client,
    );
    expect(SubscriptionModel.cancel).toHaveBeenCalledWith(
      existing.id,
      "user-1",
      client,
    );
    expect(SubscriptionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", tier: "pro" }),
      client,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users"),
      ["pro", "user-1"],
    );
  });

  it("fails the transaction when creating the replacement subscription fails", async () => {
    (SubscriptionModel.create as jest.Mock).mockResolvedValue(null);

    await expect(
      SubscriptionService.subscribe("user-1", "pro", "monthly"),
    ).rejects.toThrow("Failed to create subscription");

    expect(SubscriptionModel.cancel).toHaveBeenCalledWith(
      existing.id,
      "user-1",
      client,
    );
  });
});
