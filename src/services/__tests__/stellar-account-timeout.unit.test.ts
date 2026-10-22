import { StellarAccountService } from "../stellarAccount.service";
import * as stellar from "../../config/stellar";
import { ErrorCode } from "../../errors/error-codes";
import type { AppError } from "../../middleware/errorHandler";

jest.mock("../../config/stellar", () => ({
  server: { loadAccount: jest.fn(), submitTransaction: jest.fn() },
  networkPassphrase: "Test SDF Network ; September 2015",
  getPlatformKeypair: jest.fn(),
}));

jest.mock("../../models/wallet.model", () => ({
  WalletModel: { create: jest.fn(), findByUserId: jest.fn() },
}));

jest.mock("../../utils/encryption.utils", () => ({
  EncryptionUtil: { encrypt: jest.fn().mockResolvedValue("encrypted") },
}));

jest.mock("../../utils/stellar.utils", () => ({
  withRetry: jest.fn().mockImplementation((fn: () => unknown) => fn()),
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../config/database", () => ({
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

jest.mock("../../config/env", () => ({
  env: {
    STELLAR_REQUEST_TIMEOUT_MS: "20",
    STELLAR_STARTING_BALANCE: "1.5",
  },
}));

const getPlatformKeypair = stellar.getPlatformKeypair as jest.Mock;
const loadAccountMock = stellar.server.loadAccount as jest.Mock;
const platformKeypair = { publicKey: () => "GPLATFORM", sign: jest.fn() };

describe("Stellar account Horizon timeout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPlatformKeypair.mockReturnValue(platformKeypair);
    loadAccountMock.mockReturnValue(new Promise(() => {}));
  });

  it("throws SERVICE_UNAVAILABLE after a loadAccount call times out", async () => {
    let caught: unknown;
    try {
      await StellarAccountService.fundAccount("user-timeout", "GDEST");
    } catch (error) {
      caught = error;
    }

    expect((caught as AppError).code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect((caught as AppError).statusCode).toBe(503);
    expect((caught as AppError).details).toMatchObject({
      service: "stellar-horizon",
      reason: expect.stringContaining("timed out"),
    });
  }, 2000);
});
