jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
  pool: { query: jest.fn(), connect: jest.fn() },
  db: { query: jest.fn(), connect: jest.fn() },
}));
jest.mock("../stellar.service", () => ({
  stellarService: { getTransaction: jest.fn(), getTransactionOperations: jest.fn() },
}));
jest.mock("../socket.service", () => ({
  SocketService: { emitToUser: jest.fn() },
}));
jest.mock("../outbox.service", () => ({
  emitPaymentConfirmed: jest.fn(),
}));
jest.mock("../assetExchange.service", () => ({
  AssetExchangeService: { validateQuote: jest.fn() },
  SUPPORTED_ASSETS: {},
  MAX_SLIPPAGE_PCT: 2,
}));
jest.mock("../loyalty.service", () => ({
  LoyaltyService: { getDiscountBps: jest.fn() },
}));
jest.mock("../../models/booking.model", () => ({
  BookingModel: { findById: jest.fn() },
}));
jest.mock("../../models/wallet.model", () => ({
  WalletModel: {},
}));
jest.mock("../database.service", () => ({
  DatabaseService: {
    withTransaction: jest.fn(),
  },
}));

import { PaymentsService } from "../payments.service";
import { DatabaseService } from "../database.service";
import { ErrorCode } from "../../errors/error-codes";

const mockedWithTransaction =
  DatabaseService.withTransaction as unknown as jest.Mock;

function mockClient(existing: any, updated?: any) {
  const query = jest.fn(async (text: string) => {
    if (text.includes("FOR UPDATE")) {
      return { rows: existing ? [existing] : [] };
    }
    return { rows: [updated ?? { ...existing, status: "completed" }] };
  });
  mockedWithTransaction.mockImplementation(async (cb: any) => cb({ query }));
  return query;
}

describe("PaymentsService.updatePaymentStatus idempotency (issue #1285)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns existing record when already completed with same hash (idempotent)", async () => {
    const existing = {
      id: "pay-1",
      status: "completed",
      stellar_tx_hash: "a".repeat(64),
    };
    mockClient(existing);

    const result = await PaymentsService.updatePaymentStatus(
      "pay-1",
      "a".repeat(64),
    );

    expect(result).toEqual(existing);
  });

  it("throws CONFLICT when already completed with a different hash", async () => {
    const existing = {
      id: "pay-1",
      status: "completed",
      stellar_tx_hash: "a".repeat(64),
    };
    mockClient(existing);

    await expect(
      PaymentsService.updatePaymentStatus("pay-1", "b".repeat(64)),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it("throws CONFLICT when pending row already bound to a different hash", async () => {
    const existing = {
      id: "pay-2",
      status: "pending",
      stellar_tx_hash: "a".repeat(64),
    };
    mockClient(existing);

    await expect(
      PaymentsService.updatePaymentStatus("pay-2", "b".repeat(64)),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it("updates pending payment with no hash and returns new record", async () => {
    const existing = {
      id: "pay-3",
      status: "pending",
      stellar_tx_hash: null,
    };
    const updated = {
      id: "pay-3",
      status: "completed",
      stellar_tx_hash: "c".repeat(64),
    };
    mockClient(existing, updated);

    const result = await PaymentsService.updatePaymentStatus(
      "pay-3",
      "c".repeat(64),
    );

    expect(result.status).toBe("completed");
    expect(result.stellar_tx_hash).toBe("c".repeat(64));
  });
});
