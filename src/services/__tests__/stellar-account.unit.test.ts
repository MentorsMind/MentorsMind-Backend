import { StellarAccountService } from "../stellarAccount.service";
import * as stellar from "../../config/stellar";
import { ErrorCode } from "../../errors/error-codes";
import type { AppError } from "../../middleware/errorHandler";
import { Operation } from "@stellar/stellar-sdk";

jest.mock("../../config/stellar", () => ({
  server: { loadAccount: jest.fn(), submitTransaction: jest.fn() },
  networkPassphrase: "Test SDF Network ; September 2015",
  getPlatformKeypair: jest.fn(),
}));

jest.mock("../../models/wallet.model", () => ({
  WalletModel: { create: jest.fn(), findByUserId: jest.fn() },
}));

jest.mock("../../utils/encryption.utils", () => ({
  EncryptionUtil: { encrypt: jest.fn().mockResolvedValue("enc_secret") },
}));

jest.mock("../../utils/stellar.utils", () => ({
  withRetry: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  withTimeout: jest.fn().mockImplementation((promise: Promise<unknown>) => promise),
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

jest.mock("../../config/env", () => ({
  env: {
    STELLAR_REQUEST_TIMEOUT_MS: "50",
    STELLAR_LOAD_ACCOUNT_TIMEOUT_MS: "50",
    STELLAR_STARTING_BALANCE: "2.75",
  },
}));

const getPlatformKeypair = stellar.getPlatformKeypair as jest.Mock;
const loadAccountMock = stellar.server.loadAccount as jest.Mock;
const { logger } = jest.requireMock("../../utils/logger.utils") as {
  logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
};

const mockPlatformKeypair = {
  publicKey: () => "GPUBLICKEY",
  sign: jest.fn(),
};

describe("StellarAccountService (issues #1190/#1191)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 503 SERVICE_UNAVAILABLE when getPlatformKeypair() returns null", async () => {
    getPlatformKeypair.mockReturnValue(null);

    let caught: unknown;
    try {
      await StellarAccountService.fundAccount("user-123", "GDEST");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const appErr = caught as AppError;
    expect(appErr.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(appErr.statusCode).toBe(503);
    expect(appErr.details).toMatchObject({ service: "stellar-funding" });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("not configured"),
      expect.objectContaining({ userId: "user-123" }),
    );
  });

  it("fails before creating a wallet when the platform keypair is unavailable", async () => {
    getPlatformKeypair.mockReturnValue(null);
    const { WalletModel } = jest.requireMock("../../models/wallet.model") as {
      WalletModel: { create: jest.Mock };
    };
    const { EncryptionUtil } = jest.requireMock("../../utils/encryption.utils") as {
      EncryptionUtil: { encrypt: jest.Mock };
    };
    const pool = jest.requireMock("../../config/database").default;

    let caught: unknown;
    try {
      await StellarAccountService.createAndFundWallet("user-early-failure");
    } catch (err) {
      caught = err;
    }

    expect((caught as AppError).code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect((caught as AppError).statusCode).toBe(503);
    expect((caught as Error).message).not.toContain("keypair");
    expect(WalletModel.create).not.toHaveBeenCalled();
    expect(EncryptionUtil.encrypt).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("uses the configured starting balance when creating a wallet account", async () => {
    getPlatformKeypair.mockReturnValue(mockPlatformKeypair);
    loadAccountMock.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "10000.0000000" }],
    });
    (stellar.server.submitTransaction as jest.Mock).mockResolvedValue({
      hash: "hash",
      ledger: 1,
    });
    jest.requireMock("../../config/database").default.query.mockResolvedValue({});

    await StellarAccountService.fundAccount("user-configured-balance", "GDEST");

    expect(Operation.createAccount).toHaveBeenCalledWith({
      destination: "GDEST",
      startingBalance: "2.75",
    });
  });

  it("warns when platform balance is below 10 XLM", async () => {
    getPlatformKeypair.mockReturnValue(mockPlatformKeypair);
    loadAccountMock.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "5.0000000" }],
    });
    (stellar.server.submitTransaction as jest.Mock).mockResolvedValue({
      hash: "hash",
      ledger: 1,
    });
    const pool = jest.requireMock("../../config/database").default;
    pool.query.mockResolvedValue({});

    await StellarAccountService.fundAccount("user-low", "GDEST");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("low balance"),
      expect.objectContaining({ threshold: 10 }),
    );
  });

  it("throws 503 when loadAccount hangs beyond the timeout", async () => {
    getPlatformKeypair.mockReturnValue(mockPlatformKeypair);
    loadAccountMock.mockReturnValue(new Promise(() => {}));

    let caught: unknown;
    try {
      await StellarAccountService.fundAccount("user-789", "GDEST");
    } catch (err) {
      caught = err;
    }

    const appErr = caught as AppError;
    expect(appErr.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(appErr.statusCode).toBe(503);
    expect(appErr.details).toMatchObject({
      reason: expect.stringContaining("timed out"),
    });
    expect(logger.error).toHaveBeenCalled();
  }, 5000);
});
