import { accountDeletionService } from "../../accountDeletion.service";
import pool from "../../../config/database";
import { EmailService } from "../../email.service";
import { enqueueEmail } from "../../../queues/email.queue";

jest.mock("../../../config/database");
jest.mock("../../email.service");
jest.mock("../../../queues/email.queue", () => ({
  enqueueEmail: jest.fn().mockResolvedValue(undefined),
}));

describe("accountDeletionService - deletion emails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends confirmation email when deletion is requested", async () => {
    const scheduledFor = new Date("2026-06-25T00:00:00Z");
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user1",
            email: "user1@test.com",
            full_name: "User One",
            deletion_requested_at: new Date(),
            deletion_scheduled_for: scheduledFor,
            deletion_completed_at: null,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });

    await accountDeletionService.requestDeletion("user1");

    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["user1@test.com"],
        templateId: "account_deletion_requested",
      }),
    );
  });

  it("sends cancellation email when deletion is cancelled", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: "user1",
          email: "user1@test.com",
          full_name: "User One",
          deletion_requested_at: new Date(),
          deletion_scheduled_for: new Date(),
          deletion_completed_at: null,
        },
      ],
    });

    await accountDeletionService.cancelDeletion("user1");

    expect(enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["user1@test.com"],
        templateId: "account_deletion_cancelled",
      }),
    );
  });
});

describe("accountDeletionService - Error Isolation", () => {
  describe("processDueDeletions", () => {
    it("should continue processing after one user deletion fails", async () => {
      const mockUsers = [
        { id: "user1", email: "user1@test.com", full_name: "User One" },
        { id: "user2", email: "user2@test.com", full_name: "User Two" },
        { id: "user3", email: "user3@test.com", full_name: "User Three" },
      ];

      // Mock the query to return users
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockUsers });

      // Mock eraseUser to fail for user2 but succeed for others
      const originalEraseUser = accountDeletionService.eraseUser;
      jest
        .spyOn(accountDeletionService, "eraseUser")
        .mockImplementation(async (row) => {
          if (row.id === "user2") {
            throw new Error("Database connection failed");
          }
          return Promise.resolve();
        });

      // Mock markDeletionFailed
      jest
        .spyOn(accountDeletionService, "markDeletionFailed")
        .mockResolvedValue();

      const result = await accountDeletionService.processDueDeletions();

      expect(result.total).toBe(3);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.results).toHaveLength(3);

      const failedResult = result.results.find((r) => r.userId === "user2");
      expect(failedResult?.success).toBe(false);
      expect(failedResult?.error).toContain("Database connection failed");
    });
  });

  describe("retryFailedDeletions", () => {
    it("should only retry deletions under max retry count", async () => {
      const mockUsers = [
        {
          id: "user1",
          email: "user1@test.com",
          deletion_retry_count: 1,
          deletion_failed_at: new Date(),
        },
        {
          id: "user2",
          email: "user2@test.com",
          deletion_retry_count: 3,
          deletion_failed_at: new Date(),
        },
      ];

      // Mock query to return only user1 (under max retries)
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockUsers[0]],
      });

      jest.spyOn(accountDeletionService, "eraseUser").mockResolvedValue();

      const result = await accountDeletionService.retryFailedDeletions(3);

      expect(result.total).toBe(1);
      expect(result.successful).toBe(1);
    });
  });

  describe("markDeletionFailed", () => {
    it("should truncate long error messages", async () => {
      const longError = "x".repeat(2000);
      (pool.query as jest.Mock).mockResolvedValue({});

      await accountDeletionService.markDeletionFailed("user1", longError);

      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["user1", expect.stringMatching(/^x{1000}$/)]),
      );
    });
  });
});
