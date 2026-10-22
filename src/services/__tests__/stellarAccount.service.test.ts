import { StellarAccountService } from "../stellarAccount.service";
import * as stellar from "../../config/stellar";
import { ErrorCode } from "../../errors/error-codes";
import type { AppError } from "../../middleware/errorHandler";
import { Keypair } from "@stellar/stellar-sdk";

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock("../../config/stellar", () => ({
  server: { loadAccount: jest.fn(), submitTransaction: jest.fn() },
  networkPassphrase: "Test SDF Network ; September 2015",
  getPlatformKeypair: jest.fn(),
}));

jest.mock("../../models/wallet.model", () => ({
  WalletModel: { create: jest.fn(), findByUserId: jest.fn() },
}));

jest.mock("../../utils/encryption.utils", () => ({
  EncryptionUtil: { encrypt: jest.fn().mockReturnValue("enc_secret") },
}));

jest.mock("../../utils/stellar.utils", () => ({
  // execute the callback immediately so tests don't spin on real retries
  withRetry: jest.fn().mockImplementation((fn: () => unknown) => fn()),
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../services/socket.service", () => ({
  SocketService: { emitToUser: jest.fn() },
}));

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ sign: jest.fn() }),
    })),
    Operation: { createAccount: jest.fn() },
  };
});

jest.mock("../../middleware/tracing.middleware", () => ({
  traceStore: { getStore: jest.fn() },
}));

jest.mock("../../middleware/errorHandler", () => ({
  createError: (code: string, statusCode: number, details?: object) =>
    Object.assign(new Error(code), {
      code,
      statusCode,
      isOperational: true,
      details,
    }),
}));

// Expose a controllable timeout value so we can exercise the fast-path
// without waiting real milliseconds.
jest.mock("../../config/env", () => ({
  env: {
    STELLAR_REQUEST_TIMEOUT_MS: "50", // 50 ms for tests
    STELLAR_LOAD_ACCOUNT_TIMEOUT_MS: "50",
    STELLAR_STARTING_BALANCE: "1.5",
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

const getPlatformKeypair = stellar.getPlatformKeypair as jest.Mock;
const loadAccountMock = stellar.server.loadAccount as jest.Mock;
const withRetryMock = jest.requireMock("../../utils/stellar.utils").withRetry as jest.Mock;

/** A mock Keypair-like object with a publicKey() method */
const mockPlatformKeypair = {
  publicKey: () => "GPUBLICKEY",
  sign: jest.fn(),
};

function assertAppError(
  err: unknown,
  expectedCode: ErrorCode,
  expectedStatus: number,
): void {
  expect(err).toBeInstanceOf(Error);
  const appErr = err as AppError;
  expect(appErr.code).toBe(expectedCode);
  expect(appErr.statusCode).toBe(expectedStatus);
  expect(appErr.isOperational).toBe(true);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("StellarAccountService.fundAccount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── null / undefined platform keypair ─────────────────────────────────────

  it("throws SERVICE_UNAVAILABLE (503) when getPlatformKeypair() returns null", async () => {
    getPlatformKeypair.mockReturnValue(null);

    let caught: unknown;
    try {
      await StellarAccountService.fundAccount("user-123", "GDESTINATION");
    } catch (err) {
      caught = err;
    }

    assertAppError(caught, ErrorCode.SERVICE_UNAVAILABLE, 503);
    expect((caught as AppError).details).toMatchObject({
      service: "stellar-funding",
      reason: "Stellar wallet funding is currently unavailable",
    });
  });

  it("throws SERVICE_UNAVAILABLE (503) when getPlatformKeypair() returns undefined", async () => {
    getPlatformKeypair.mockReturnValue(undefined);

    let caught: unknown;
    try {
      await StellarAccountService.fundAccount("user-456", "GDESTINATION");
    } catch (err) {
      caught = err;
    }

    assertAppError(caught, ErrorCode.SERVICE_UNAVAILABLE, 503);
  });

  // ── Horizon request timeout ────────────────────────────────────────────────

  it("throws SERVICE_UNAVAILABLE (503) when loadAccount hangs beyond the timeout", async () => {
    getPlatformKeypair.mockReturnValue(mockPlatformKeypair);

    // Simulate a Horizon call that never resolves
    loadAccountMock.mockReturnValue(new Promise(() => {}));

    let caught: unknown;
    try {
      // env mock sets STELLAR_REQUEST_TIMEOUT_MS = "50" so this should
      // resolve in ~50 ms rather than hanging forever.
      await StellarAccountService.fundAccount("user-789", "GDESTINATION");
    } catch (err) {
      caught = err;
    }

    assertAppError(caught, ErrorCode.SERVICE_UNAVAILABLE, 503);
    const appErr = caught as AppError;
    expect(appErr.details).toMatchObject({
      reason: expect.stringContaining("timed out"),
    });
  }, 2000 /* generous wall-clock budget for the race */);

  it("does NOT throw a timeout error when loadAccount resolves within the deadline", async () => {
    getPlatformKeypair.mockReturnValue(mockPlatformKeypair);

    // Simulate a fast Horizon response
    const fakeAccount = {
      balances: [{ asset_type: "native", balance: "10000.0000000" }],
      accountId: () => "GPUBLICKEY",
    };
    loadAccountMock.mockResolvedValue(fakeAccount);

    // submitTransaction needs to resolve too so fundAccount can complete
    (stellar.server.submitTransaction as jest.Mock).mockResolvedValue({
      hash: "abc123",
      ledger: 1,
    });

    // pool.query should succeed silently
    const pool = require("../../config/database").default;
    pool.query.mockResolvedValue({});

    // Should not throw — we just verify it doesn't reject with a timeout error
    await expect(
      StellarAccountService.fundAccount(
        "user-ok",
        Keypair.random().publicKey(),
      ),
    ).resolves.toBeDefined();
  });

  it("retries loadAccount after the request times out", async () => {
    getPlatformKeypair.mockReturnValue(mockPlatformKeypair);
    const actualWithRetry = jest.requireActual("../../utils/stellar.utils").withRetry;
    withRetryMock.mockImplementation((fn: () => Promise<unknown>, label: string) =>
      actualWithRetry(fn, label, 3, 0),
    );

    loadAccountMock
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce({
        balances: [{ asset_type: "native", balance: "10000.0000000" }],
        accountId: () => "GPUBLICKEY",
      });
    (stellar.server.submitTransaction as jest.Mock).mockResolvedValue({
      hash: "retry-hash",
      ledger: 2,
    });
    require("../../config/database").default.query.mockResolvedValue({});

    await expect(
      StellarAccountService.fundAccount("user-retry", "GDESTINATION"),
    ).resolves.toBeDefined();

    expect(loadAccountMock).toHaveBeenCalledTimes(2);
  }, 2000);
});
