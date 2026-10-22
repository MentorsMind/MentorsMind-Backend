jest.mock("../../config/env", () => ({
  env: { STELLAR_API_TIMEOUT_MS: "10" },
}));

jest.mock("../../config/stellar", () => ({
  server: {
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
  },
  networkPassphrase: "test-network",
  getPlatformKeypair: jest.fn(() => ({
    publicKey: jest.fn(() => "G_PLATFORM"),
  })),
}));

jest.mock("../../models/wallet.model", () => ({
  WalletModel: { create: jest.fn() },
}));

jest.mock("../../utils/encryption.utils", () => ({
  EncryptionUtil: { encrypt: jest.fn() },
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../socket.service", () => ({
  SocketService: { emitToUser: jest.fn() },
}));

import { ErrorCode } from "../../errors/error-codes";
import { server } from "../../config/stellar";
import { StellarAccountService } from "../stellarAccount.service";

describe("StellarAccountService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a 503 when loading the funding account exceeds the timeout", async () => {
    (server.loadAccount as jest.Mock).mockImplementation(
      () => new Promise(() => {}),
    );

    await expect(
      StellarAccountService.fundAccount("user-1", "G_DESTINATION"),
    ).rejects.toMatchObject({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      statusCode: 503,
      message: "Stellar Horizon API request timed out",
    });

    expect(server.loadAccount).toHaveBeenCalledTimes(1);
    expect(server.submitTransaction).not.toHaveBeenCalled();
  });
});
