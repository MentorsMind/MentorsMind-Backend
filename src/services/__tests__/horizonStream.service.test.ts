import { HorizonStreamService } from "../horizonStream.service";
import { stellarService } from "../stellar.service";
import { SocketService } from "../socket.service";
import { WalletModel } from "../../models/wallet.model";

jest.mock("../stellar.service", () => ({
  stellarService: {
    streamPayments: jest.fn(),
  },
}));

jest.mock("../socket.service", () => ({
  SocketService: {
    emitToUser: jest.fn(),
  },
}));

jest.mock("../../models/wallet.model", () => ({
  WalletModel: {
    findByStellarPublicKey: jest.fn(),
  },
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

const pool = jest.requireMock("../../config/database").default;

describe("HorizonStreamService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("matches a pending payment and emits payment:confirmed", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "txn-1",
            user_id: "user-1",
            status: "pending",
            amount: "50.0000000",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "txn-1",
            user_id: "user-1",
          },
        ],
      });

    (WalletModel.findByStellarPublicKey as jest.Mock).mockResolvedValue(null);

    const service = new HorizonStreamService();
    await service.processPaymentOperation(
      {
        id: "op-1",
        type: "payment",
        createdAt: new Date().toISOString(),
        transactionHash: "hash-1",
        from: "GA123",
        to: "GB456",
        assetType: "native",
        assetCode: "XLM",
        assetIssuer: undefined,
        amount: "50.0000000",
      },
      "GB456",
    );

    expect(SocketService.emitToUser).toHaveBeenCalledWith(
      "user-1",
      "payment:confirmed",
      expect.objectContaining({
        transactionId: "txn-1",
        transactionHash: "hash-1",
      }),
    );
  });

  it("schedules a reconnect when the stream disconnects", async () => {
    jest.useFakeTimers();
    let onError: ((error: unknown) => void) | undefined;

    (stellarService.streamPayments as jest.Mock).mockImplementation(
      (_account, _onPayment, _cursor, streamErrorHandler) => {
        onError = streamErrorHandler;
        return jest.fn();
      },
    );

    const service = new HorizonStreamService();
    await service.startForAccount("GB456");

    onError?.(new Error("disconnect"));
    expect(setTimeout).toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });
});
