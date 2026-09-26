import { processStellarTx } from "../stellarTx.worker";
import { stellarService } from "../../services/stellar.service";
import { logger } from "../../utils/logger.utils";

jest.mock("uuid", () => ({ v4: () => "mock-uuid" }));
jest.mock("../../middleware/tracing.middleware", () => ({}));
jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    TransactionBuilder: {
      ...actual.TransactionBuilder,
      fromXDR: jest.fn().mockReturnValue({
        hash: () => ({ toString: () => "fake_tx_hash_123" }),
        timeBounds: undefined,
        operations: [],
      }),
    },
  };
});
jest.mock("../../services/stellar.service");
jest.mock("../../utils/logger.utils", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock("../../config/redis", () => ({
  redis: {
    exists: jest.fn().mockResolvedValue(false),
    set: jest.fn().mockResolvedValue("OK"),
  },
}));
jest.mock("../../config/database", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));
jest.mock("../../services/audit-logger.service", () => ({
  AuditLoggerService: {
    logEvent: jest.fn().mockResolvedValue(undefined),
  },
}));

describe("stellarTx.worker unit tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs structured error fields on Stellar transaction failure", async () => {
    const fakeError: any = new Error("Op failed");
    fakeError.response = {
      data: {
        extras: {
          result_codes: { transaction: "tx_failed", operations: ["op_underfunded"] },
          ledger: 123456,
        },
      },
    };

    (stellarService.submitTransaction as jest.Mock).mockRejectedValueOnce(fakeError);

    // Dummy XDR envelope
    const fakeJob: any = {
      id: "job-123",
      attemptsMade: 1,
      data: {
        txEnvelopeXdr: "AAAAAG...",
        userId: "user-1",
        paymentId: "pay-1",
        txHash: "fake_tx_hash_123",
      },
    };

    await expect(processStellarTx(fakeJob)).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      "Stellar transaction rejected",
      expect.objectContaining({
        stellar_tx_hash: "fake_tx_hash_123",
        stellar_result_code: { transaction: "tx_failed", operations: ["op_underfunded"] },
        ledger_sequence: 123456,
        job_id: "job-123",
        attempt_number: 2,
        error_message: "Op failed",
      })
    );
  });

  it("logs structured info fields on Stellar transaction success", async () => {
    (stellarService.submitTransaction as jest.Mock).mockResolvedValueOnce({
      successful: true,
      hash: "success_hash_456",
      ledger: 654321,
    });

    const fakeJob: any = {
      id: "job-456",
      attemptsMade: 0,
      data: {
        txEnvelopeXdr: "AAAAAG...",
        userId: "user-2",
        paymentId: "pay-2",
      },
    };

    await processStellarTx(fakeJob);

    expect(logger.info).toHaveBeenCalledWith(
      "Stellar transaction confirmed",
      expect.objectContaining({
        jobId: "job-456",
        stellar_tx_hash: "success_hash_456",
        ledger_sequence: 654321,
      })
    );
  });
});
