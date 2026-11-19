import express from "express";
import request from "supertest";
import { errorHandler } from "../../../src/middleware/errorHandler";
import { BookingModel } from "../../../src/models/booking.model";
import { ErrorCode } from "../../../src/errors/error-codes";
import paymentsRoutes from "../../../src/routes/payments.routes";
import pool from "../../../src/config/database";
import {
  AssetExchangeService,
  SUPPORTED_ASSETS,
} from "../../../src/services/assetExchange.service";
import { LoyaltyService } from "../../../src/services/loyalty.service";
import { AuditLogService } from "../../../src/services/auditLog.service";

jest.mock("../../../src/config/database", () => {
  const query = jest.fn();
  const mockedPool = {
    query,
    connect: jest.fn(),
    on: jest.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  };

  return {
    __esModule: true,
    default: mockedPool,
    pool: mockedPool,
    db: { query },
    testConnection: jest.fn(),
  };
});

jest.mock("../../../src/models/booking.model", () => ({
  BookingModel: { findById: jest.fn() },
}));

jest.mock("../../../src/config/redis", () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
  },
}));

jest.mock("uuid", () => ({
  v4: jest.fn().mockReturnValue("750e8400-e29b-41d4-a716-446655440000"),
}));

jest.mock("../../../src/utils/logger.utils", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  Logger: jest.fn(),
}));

jest.mock("../../../src/middleware/auth.middleware", () => ({
  authenticate: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as express.Request & { user: { id: string; role: string } }).user = {
      id: "mentee-1",
      role: "mentee",
    };
    next();
  },
}));

jest.mock("../../../src/config/stellar", () => ({
  server: {
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
  },
  backupServer: {
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
  },
  networkPassphrase: "Test SDF Network ; September 2015",
  getPlatformKeypair: jest.fn(),
}));

jest.mock("../../../src/services/stellar.service", () => ({
  stellarService: {
    getTransaction: jest.fn(),
    getTransactionOperations: jest.fn(),
  },
}));

jest.mock("../../../src/services/sorobanEscrow.service", () => ({
  SorobanEscrowService: {
    isConfigured: jest.fn().mockReturnValue(false),
    createEscrow: jest.fn(),
    releaseFunds: jest.fn(),
    refund: jest.fn(),
    openDispute: jest.fn(),
    resolveDispute: jest.fn(),
    getEscrowState: jest.fn(),
  },
}));

jest.mock("../../../src/services/auditLog.service", () => ({
  AuditLogService: { log: jest.fn() },
  extractIpAddress: jest.fn().mockReturnValue("127.0.0.1"),
}));

const BOOKING_ID = "550e8400-e29b-41d4-a716-446655440000";
const MISSING_BOOKING_ID = "550e8400-e29b-41d4-a716-446655440001";
const QUOTE_ID = "550e8400-e29b-41d4-a716-446655440002";
const PAYMENT_ID = "550e8400-e29b-41d4-a716-446655440003";

const makeQuote = (createdAt: number) =>
  ({
    quoteId: QUOTE_ID,
    from: "XLM",
    to: "USDC",
    sendAmount: "100",
    receiveAmount: "50",
    rate: "0.5",
    maxSlippagePct: 1,
    minReceiveAmount: "49.5",
    expiresAt: new Date(createdAt + 30_000).toISOString(),
    createdAt,
    pathPaymentRequired: true,
  }) as Awaited<ReturnType<typeof AssetExchangeService.validateQuote>>;

const app = express();
app.use(express.json());
app.use("/api/v1/payments", paymentsRoutes);
app.use(errorHandler);

const poolQuery = pool.query as jest.Mock;
const findBooking = BookingModel.findById as jest.Mock;
const bookings = new Map<
  string,
  { mentee_id: string; payment_status: string }
>();

describe("POST /api/v1/payments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bookings.clear();
    bookings.set(BOOKING_ID, {
      mentee_id: "mentee-1",
      payment_status: "pending",
    });
    findBooking.mockImplementation(async (bookingId: string) => {
      const booking = bookings.get(bookingId);
      return booking ? { id: bookingId, ...booking } : null;
    });
    poolQuery.mockImplementation(
      async (queryText: string, values: unknown[] = []) => {
        if (queryText.includes("INSERT INTO transactions")) {
          return {
            rows: [
              {
                id: PAYMENT_ID,
                user_id: values[0],
                booking_id: values[1],
                amount: values[2],
                currency: values[3],
                status: "pending",
                quote_id: values[13],
                quoted_rate: values[14],
                path_payment: values[15],
              },
            ],
          };
        }
        return { rows: [] };
      },
    );
    jest.spyOn(LoyaltyService, "getDiscountBps").mockResolvedValue(0);
    jest.spyOn(AuditLogService, "log").mockResolvedValue(undefined as never);
    jest
      .spyOn(AssetExchangeService, "validateQuote")
      .mockResolvedValue(makeQuote(Date.now()));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const postPayment = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/payments")
      .set("Idempotency-Key", "650e8400-e29b-41d4-a716-446655440000")
      .send(body);

  it("initiates a valid XLM payment", async () => {
    const response = await postPayment({
      bookingId: BOOKING_ID,
      amount: "100",
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("success");
    expect(response.body.data).toEqual(
      expect.objectContaining({
        id: PAYMENT_ID,
        booking_id: BOOKING_ID,
        currency: "XLM",
        status: "pending",
      }),
    );
    expect(AssetExchangeService.validateQuote).not.toHaveBeenCalled();
  });

  it.each(["USDC", "PYUSD"])(
    "initiates a valid %s payment",
    async (currency) => {
      const response = await postPayment({
        bookingId: BOOKING_ID,
        amount: "25",
        currency,
      });

      expect(response.status).toBe(201);
      expect(response.body.data.currency).toBe(currency);
    },
  );

  it("returns PAYMENT_UNSUPPORTED_CURRENCY when a currency is no longer supported", async () => {
    // The request schema currently accepts PYUSD; remove it from the asset
    // catalog to exercise the service's unsupported-asset error path.
    const removedAsset = SUPPORTED_ASSETS.PYUSD;
    delete SUPPORTED_ASSETS.PYUSD;

    try {
      const response = await postPayment({
        bookingId: BOOKING_ID,
        amount: "25",
        currency: "PYUSD",
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.PAYMENT_UNSUPPORTED_CURRENCY);
    } finally {
      SUPPORTED_ASSETS.PYUSD = removedAsset;
    }
  });

  it("rejects a currency outside the request schema's supported set", async () => {
    const response = await postPayment({
      bookingId: BOOKING_ID,
      amount: "25",
      currency: "EUR",
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "body.currency" }),
      ]),
    );
  });

  it("returns 400 when a required field is missing", async () => {
    const response = await postPayment({ bookingId: BOOKING_ID });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "body.amount" }),
      ]),
    );
  });

  it("returns PAYMENT_BOOKING_NOT_FOUND when the booking does not exist", async () => {
    const response = await postPayment({
      bookingId: MISSING_BOOKING_ID,
      amount: "100",
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(ErrorCode.PAYMENT_BOOKING_NOT_FOUND);
  });

  it("returns PAYMENT_ALREADY_COMPLETED when the booking is already paid", async () => {
    bookings.set(BOOKING_ID, { mentee_id: "mentee-1", payment_status: "paid" });

    const response = await postPayment({
      bookingId: BOOKING_ID,
      amount: "100",
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(ErrorCode.PAYMENT_ALREADY_COMPLETED);
  });

  it("validates a quote and includes the quoted rate on the initiated payment", async () => {
    const response = await postPayment({
      bookingId: BOOKING_ID,
      amount: "100",
      currency: "USDC",
      quoteId: QUOTE_ID,
    });

    expect(response.status).toBe(201);
    expect(AssetExchangeService.validateQuote).toHaveBeenCalledWith(QUOTE_ID);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        quote_id: QUOTE_ID,
        quoted_rate: "0.5",
        path_payment: true,
      }),
    );
  });

  it("returns PAYMENT_QUOTE_EXPIRED when a validated quote is older than 30 seconds", async () => {
    jest
      .spyOn(AssetExchangeService, "validateQuote")
      .mockResolvedValueOnce(makeQuote(Date.now() - 31_000));

    const response = await postPayment({
      bookingId: BOOKING_ID,
      amount: "100",
      currency: "USDC",
      quoteId: QUOTE_ID,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCode.PAYMENT_QUOTE_EXPIRED);
  });
});
