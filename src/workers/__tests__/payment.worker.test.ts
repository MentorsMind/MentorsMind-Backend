import { Job } from "bullmq";
import pool from "../../config/database";
import { stellarService } from "../../services/stellar.service";
import { AuditLoggerService } from "../../services/audit-logger.service";
import { logger } from "../../utils/logger.utils";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock("../../services/stellar.service", () => ({
  stellarService: {
    getTransaction: jest.fn(),
  },
}));

jest.mock("../../services/audit-logger.service", () => ({
  AuditLoggerService: {
    logEvent: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// We need to import the function to test it
import { pollPaymentStatus } from "../payment.worker";

describe("Payment Worker Unit Tests", () => {
  const mockJob = (data: any) =>
    ({
      id: "test-job-id",
      data,
      attemptsMade: 0,
      opts: { attempts: 20 },
    }) as Job;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("marks payment completed when Stellar tx is successful", async () => {
    const paymentId = "tx-123";
    const userId = "user-456";
    const transactionHash = "hash-789";

    // Mock initial query to fetch transaction
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ status: "pending", stellar_tx_hash: transactionHash }],
    });

    // Mock StellarService to return a successful transaction
    (stellarService.getTransaction as jest.Mock).mockResolvedValue({
      successful: true,
      hash: transactionHash,
    });

    // Mock update query
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const job = mockJob({ paymentId, userId, transactionHash });
    await pollPaymentStatus(job);

    // Verify correct table and column names in SELECT
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "SELECT status, stellar_tx_hash FROM transactions WHERE id = $1",
      ),
      [paymentId],
    );

    // Verify correct table name in UPDATE
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE transactions SET status = 'completed'"),
      [paymentId],
    );

    expect(stellarService.getTransaction).toHaveBeenCalledWith(transactionHash);
  });

  it("retries when Stellar tx is not yet successful", async () => {
    const paymentId = "tx-123";
    const userId = "user-456";
    const transactionHash = "hash-789";

    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ status: "pending", stellar_tx_hash: transactionHash }],
    });

    (stellarService.getTransaction as jest.Mock).mockResolvedValue({
      successful: false,
      hash: transactionHash,
    });

    const job = mockJob({ paymentId, userId, transactionHash });
    await expect(pollPaymentStatus(job)).rejects.toThrow(/still pending/);

    expect(pool.query).toHaveBeenCalledTimes(1); // Only SELECT
  });

  it("retries when Stellar lookup throws", async () => {
    const paymentId = "tx-123";
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ status: "pending", stellar_tx_hash: "hash" }],
    });
    (stellarService.getTransaction as jest.Mock).mockRejectedValue(
      new Error("Horizon timeout"),
    );

    const job = mockJob({ paymentId, userId: "user", transactionHash: "hash" });
    await expect(pollPaymentStatus(job)).rejects.toThrow(/still pending/);
  });

  it("skips Stellar check and returns early when payment already resolved", async () => {
    const paymentId = "tx-123";
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ status: "completed", stellar_tx_hash: "hash" }],
    });

    const job = mockJob({ paymentId, userId: "user", transactionHash: "hash" });
    await pollPaymentStatus(job);

    expect(stellarService.getTransaction).not.toHaveBeenCalled();
  });
});
