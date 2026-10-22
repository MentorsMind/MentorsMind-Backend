/**
 * Integration tests for StellarAccountService.createAndFundWallet (#1192).
 *
 * Covers the orchestration: keypair generation, wallet DB creation, funding,
 * and activation — with Horizon calls mocked and DB writes asserted via the
 * mocked pool/WalletModel so the suite runs without live Horizon or Postgres.
 */
import { StellarAccountService } from "../../../src/services/stellarAccount.service";
import { WalletModel } from "../../../src/models/wallet.model";
import { EncryptionUtil } from "../../../src/utils/encryption.utils";
import pool from "../../../src/config/database";
import { getPlatformKeypair } from "../../../src/config/stellar";

jest.mock("../../../src/config/stellar", () => ({
  server: { loadAccount: jest.fn(), submitTransaction: jest.fn() },
  networkPassphrase: "Test SDF Network ; September 2015",
  getPlatformKeypair: jest.fn(),
}));

jest.mock("../../../src/models/wallet.model", () => ({
  WalletModel: { create: jest.fn(), findByUserId: jest.fn() },
}));

jest.mock("../../../src/utils/encryption.utils", () => ({
  EncryptionUtil: { encrypt: jest.fn(), decrypt: jest.fn() },
}));

jest.mock("../../../src/utils/stellar.utils", () => ({
  withRetry: jest.fn().mockImplementation((fn: () => unknown) => fn()),
}));

jest.mock("../../../src/utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../../src/config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../../src/services/socket.service", () => ({
  SocketService: { emitToUser: jest.fn() },
}));

jest.mock("../../../src/middleware/tracing.middleware", () => ({
  traceStore: { getStore: jest.fn() },
}));

jest.mock("../../../src/middleware/errorHandler", () => ({
  createError: (code: string, statusCode: number, details?: object) =>
    Object.assign(new Error(code), {
      code,
      statusCode,
      isOperational: true,
      details,
    }),
}));

const poolMock = (pool as unknown as { query: jest.Mock }).query as jest.Mock;
const walletCreateMock = WalletModel.create as jest.Mock;
const encryptMock = EncryptionUtil.encrypt as jest.Mock;
const platformKeypairMock = getPlatformKeypair as jest.Mock;

describe("StellarAccountService.createAndFundWallet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    poolMock.mockResolvedValue({ rows: [] });
    platformKeypairMock.mockReturnValue({
      publicKey: () => "GPLATFORM",
      sign: jest.fn(),
    });
    encryptMock.mockResolvedValue("enc_secret_xyz");
    walletCreateMock.mockResolvedValue({
      user_id: "user-1",
      stellar_public_key: "GABC",
      status: "active",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("successful creation stores encrypted_secret_key, publicKey, status=active", async () => {
    const fundSpy = jest
      .spyOn(StellarAccountService, "fundAccount")
      .mockResolvedValue({ hash: "h", ledger: 1 } as never);
    const verifySpy = jest
      .spyOn(StellarAccountService, "verifyActivation")
      .mockResolvedValue(true as never);

    const result = await StellarAccountService.createAndFundWallet("user-1");

    expect(result.publicKey).toMatch(/^G/);
    expect(encryptMock).toHaveBeenCalled();
    expect(walletCreateMock).toHaveBeenCalledWith(
      "user-1",
      expect.stringMatching(/^G/),
    );
    // Encrypted secret persisted (awaited, not a Promise).
    const updateCall = poolMock.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("encrypted_secret_key"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1][0]).toBe("enc_secret_xyz");
    expect(fundSpy).toHaveBeenCalled();
    expect(verifySpy).toHaveBeenCalled();

    fundSpy.mockRestore();
    verifySpy.mockRestore();
  });

  it("funding failure rolls back the wallet record", async () => {
    jest
      .spyOn(StellarAccountService, "fundAccount")
      .mockRejectedValueOnce(new Error("horizon down"));
    const verifySpy = jest.spyOn(StellarAccountService, "verifyActivation");

    await expect(
      StellarAccountService.createAndFundWallet("user-2"),
    ).rejects.toThrow("horizon down");

    const deleteCall = poolMock.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("DELETE FROM wallets"),
    );
    expect(deleteCall).toBeDefined();
    expect(verifySpy).not.toHaveBeenCalled();
    verifySpy.mockRestore();
    (StellarAccountService.fundAccount as jest.Mock).mockRestore?.();
  });

  it("verifyActivation failure marks the wallet as pending", async () => {
    jest
      .spyOn(StellarAccountService, "fundAccount")
      .mockResolvedValueOnce({ hash: "h", ledger: 1 } as never);
    jest
      .spyOn(StellarAccountService, "verifyActivation")
      .mockRejectedValueOnce(new Error("not activated yet"));

    await expect(
      StellarAccountService.createAndFundWallet("user-3"),
    ).rejects.toThrow("not activated yet");

    const pendingCall = poolMock.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("wallet_activated = false"),
    );
    expect(pendingCall).toBeDefined();

    (StellarAccountService.fundAccount as jest.Mock).mockRestore?.();
    (StellarAccountService.verifyActivation as jest.Mock).mockRestore?.();
  });
});
