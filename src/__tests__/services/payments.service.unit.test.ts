import { PaymentsService } from "../../services/payments.service";
import pool from "../../config/database";
import { BookingModel } from "../../models/booking.model";
import { stellarService } from "../../services/stellar.service";
import { SocketService } from "../../services/socket.service";
// Mock external dependencies
jest.mock("../../config/database");
jest.mock("../../models/booking.model");
jest.mock("../../services/stellar.service");
jest.mock("../../services/socket.service");

const mockPool = pool as jest.Mocked<typeof pool>;
const mockBookingModel = BookingModel as jest.Mocked<typeof BookingModel>;
const mockStellarService = stellarService as jest.Mocked<typeof stellarService>;
const mockSocketService = SocketService as jest.Mocked<typeof SocketService>;

describe("PaymentsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("initiatePayment", () => {
    it("should initiate payment successfully", async () => {
      const data = {
        userId: "user-123",
        bookingId: "booking-123",
        amount: "50.0000000",
        currency: "XLM",
        description: "Mentoring session payment",
      };

      const mockBooking = {
        id: data.bookingId,
        mentee_id: data.userId,
        payment_status: "pending",
      };

      const mockPayment = {
        id: "payment-123",
        user_id: data.userId,
        booking_id: data.bookingId,
        type: "payment",
        status: "pending",
        amount: data.amount,
        currency: data.currency,
      };

      mockBookingModel.findById.mockResolvedValue(mockBooking as any);
      mockPool.query.mockResolvedValue({ rows: [mockPayment] });

      const result = await PaymentsService.initiatePayment(data);

      expect(result).toEqual(mockPayment);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO transactions"),
        expect.any(Array),
      );
    });

    it("should throw error if booking not found", async () => {
      const data = {
        userId: "user-123",
        bookingId: "nonexistent",
        amount: "50.0000000",
      };

      mockBookingModel.findById.mockResolvedValue(null);

      await expect(PaymentsService.initiatePayment(data)).rejects.toThrow(
        "Booking not found",
      );
    });

    it("should throw error if user does not own booking", async () => {
      const data = {
        userId: "user-123",
        bookingId: "booking-123",
        amount: "50.0000000",
      };

      const mockBooking = {
        id: data.bookingId,
        mentee_id: "other-user",
        payment_status: "pending",
      };

      mockBookingModel.findById.mockResolvedValue(mockBooking as any);

      await expect(PaymentsService.initiatePayment(data)).rejects.toThrow(
        "Access denied",
      );
    });

    it("should throw error if booking already paid", async () => {
      const data = {
        userId: "user-123",
        bookingId: "booking-123",
        amount: "50.0000000",
      };

      const mockBooking = {
        id: data.bookingId,
        mentee_id: data.userId,
        payment_status: "paid",
      };

      mockBookingModel.findById.mockResolvedValue(mockBooking as any);

      await expect(PaymentsService.initiatePayment(data)).rejects.toThrow(
        "Booking is already paid",
      );
    });
  });

  describe("getPaymentById", () => {
    it("should return payment if found", async () => {
      const paymentId = "payment-123";
      const userId = "user-123";

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: "pending",
      };

      mockPool.query.mockResolvedValue({ rows: [mockPayment] });

      const result = await PaymentsService.getPaymentById(paymentId, userId);

      expect(result).toEqual(mockPayment);
    });

    it("should throw error if payment not found", async () => {
      const paymentId = "nonexistent";
      const userId = "user-123";

      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(
        PaymentsService.getPaymentById(paymentId, userId),
      ).rejects.toThrow("Payment not found");
    });
  });

  describe("getPaymentStatus", () => {
    it("should return payment status", async () => {
      const paymentId = "payment-123";
      const userId = "user-123";

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: "completed",
        stellar_tx_hash: "hash123",
        updated_at: new Date(),
      };

      jest
        .spyOn(PaymentsService, "getPaymentById")
        .mockResolvedValue(mockPayment as any);

      const result = await PaymentsService.getPaymentStatus(paymentId, userId);

      expect(result).toEqual({
        id: paymentId,
        status: "completed",
        stellarTxHash: "hash123",
        updatedAt: mockPayment.updated_at,
      });
    });
  });

  describe("confirmPayment", () => {
    it("should confirm payment successfully", async () => {
      const paymentId = "payment-123";
      const userId = "user-123";
      const stellarTxHash = "hash123";

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: "pending",
        booking_id: "booking-123",
        from_address: "GABC...",
        amount: "50.0000000",
      };

      const mockUpdatedPayment = {
        ...mockPayment,
        status: "completed",
        stellar_tx_hash: stellarTxHash,
      };

      jest
        .spyOn(PaymentsService, "getPaymentById")
        .mockResolvedValue(mockPayment as any);
      mockStellarService.getTransaction.mockResolvedValue({
        successful: true,
        hash: stellarTxHash,
        source_account: "GABC...",
      } as any);
      mockStellarService.getTransactionOperations.mockResolvedValue([
        { type: "payment", amount: "50.0000000" },
      ] as any);
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockUpdatedPayment] })
        .mockResolvedValueOnce({}) // booking update
        .mockResolvedValueOnce({}); // socket emit
      mockSocketService.emitToUser.mockResolvedValue();

      const result = await PaymentsService.confirmPayment(
        paymentId,
        userId,
        stellarTxHash,
      );

      expect(result).toEqual(mockUpdatedPayment);
      expect(mockStellarService.getTransaction).toHaveBeenCalledWith(
        stellarTxHash,
      );
      expect(mockStellarService.getTransactionOperations).toHaveBeenCalledWith(
        stellarTxHash,
      );
      expect(mockSocketService.emitToUser).toHaveBeenCalled();
    });

    it("should throw error if payment already confirmed", async () => {
      const paymentId = "payment-123";
      const userId = "user-123";
      const stellarTxHash = "hash123";

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: "completed",
      };

      jest
        .spyOn(PaymentsService, "getPaymentById")
        .mockResolvedValue(mockPayment as any);

      await expect(
        PaymentsService.confirmPayment(paymentId, userId, stellarTxHash),
      ).rejects.toThrow("Payment already confirmed");
    });

    it("should throw error if Stellar transaction was not successful", async () => {
      const paymentId = "payment-123";
      const userId = "user-123";
      const stellarTxHash = "hash123";

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: "pending",
        from_address: "GABC...",
        amount: "50.0000000",
      };

      jest
        .spyOn(PaymentsService, "getPaymentById")
        .mockResolvedValue(mockPayment as any);
      mockStellarService.getTransaction.mockResolvedValue({
        successful: false,
        hash: stellarTxHash,
        source_account: "GABC...",
      } as any);

      await expect(
        PaymentsService.confirmPayment(paymentId, userId, stellarTxHash),
      ).rejects.toThrow("Stellar transaction was not successful");
    });

    it("should throw error if transaction source account does not match sender", async () => {
      const paymentId = "payment-123";
      const userId = "user-123";
      const stellarTxHash = "hash123";

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: "pending",
        from_address: "GABC...",
        amount: "50.0000000",
      };

      jest
        .spyOn(PaymentsService, "getPaymentById")
        .mockResolvedValue(mockPayment as any);
      mockStellarService.getTransaction.mockResolvedValue({
        successful: true,
        hash: stellarTxHash,
        source_account: "GOTHER...",
      } as any);

      await expect(
        PaymentsService.confirmPayment(paymentId, userId, stellarTxHash),
      ).rejects.toThrow(
        "Transaction source account does not match payment sender",
      );
    });

    it("should throw error if transaction does not contain matching payment amount", async () => {
      const paymentId = "payment-123";
      const userId = "user-123";
      const stellarTxHash = "hash123";

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: "pending",
        from_address: "GABC...",
        amount: "50.0000000",
      };

      jest
        .spyOn(PaymentsService, "getPaymentById")
        .mockResolvedValue(mockPayment as any);
      mockStellarService.getTransaction.mockResolvedValue({
        successful: true,
        hash: stellarTxHash,
        source_account: "GABC...",
      } as any);
      mockStellarService.getTransactionOperations.mockResolvedValue([
        { type: "payment", amount: "1.0000000" },
      ] as any);

      await expect(
        PaymentsService.confirmPayment(paymentId, userId, stellarTxHash),
      ).rejects.toThrow(
        "Transaction does not contain a matching payment amount",
      );
    });
  });

  describe("listUserPayments", () => {
    it("should return paginated payments", async () => {
      const userId = "user-123";
      const filters = { page: 1, limit: 10, status: "completed" as const };

      const mockPayments = [
        { id: "payment-1", user_id: userId, status: "completed" },
        { id: "payment-2", user_id: userId, status: "completed" },
      ];

      mockPool.query.mockReset();

      const sqlText = (sql: unknown): string => {
        if (typeof sql === "string") return sql;
        if (
          sql &&
          typeof sql === "object" &&
          "text" in sql &&
          typeof (sql as { text: string }).text === "string"
        ) {
          return (sql as { text: string }).text;
        }
        return "";
      };
      mockPool.query.mockImplementation((sql: unknown) => {
        const q = sqlText(sql);
        if (q.includes("COUNT(*)")) {
          return Promise.resolve({ rows: [{ count: "2" }] });
        }
        return Promise.resolve({ rows: mockPayments });
      });

      const result = await PaymentsService.listUserPayments(userId, filters);

      expect(result.payments).toEqual(mockPayments);
      expect(result.total).toBe(2);
    });
  });

  describe("getPaymentHistory", () => {
    it("should return payment history with total volume", async () => {
      const userId = "user-123";
      const filters = { page: 1, limit: 10 };

      const mockPayments = [{ id: "payment-1", status: "completed" }];
      const mockVolume = { total_volume: "150.0000000" };

      jest.spyOn(PaymentsService, "listUserPayments").mockResolvedValue({
        payments: mockPayments,
        total: 1,
      });
      const sqlTextSum = (sql: unknown): string => {
        if (typeof sql === "string") return sql;
        if (
          sql &&
          typeof sql === "object" &&
          "text" in sql &&
          typeof (sql as { text: string }).text === "string"
        ) {
          return (sql as { text: string }).text;
        }
        return "";
      };
      mockPool.query.mockImplementation((sql: unknown) => {
        const q = sqlTextSum(sql);
        if (q.includes("COALESCE(SUM")) {
          return Promise.resolve({ rows: [mockVolume] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await PaymentsService.getPaymentHistory(userId, filters);

      expect(result.payments).toEqual(mockPayments);
      expect(result.total).toBe(1);
      expect(result.totalVolume).toBe("150.0000000");
    });
  });

  describe("refundPayment", () => {
    it("should refund payment successfully", async () => {
      const paymentId = "payment-123";
      const userId = "user-123";
      const reason = "Customer request";

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: "completed",
        booking_id: "booking-123",
        amount: "50.0000000",
        currency: "XLM",
      };

      const mockRefundedPayment = { ...mockPayment, status: "refunded" };

      jest
        .spyOn(PaymentsService, "getPaymentById")
        .mockResolvedValue(mockPayment as any);

      const mockClient = {
        query: jest.fn(),
        connect: jest.fn(),
        release: jest.fn(),
      };
      mockPool.connect.mockResolvedValue(mockClient as any);
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [mockRefundedPayment] }) // UPDATE original
        .mockResolvedValueOnce(undefined) // INSERT refund
        .mockResolvedValueOnce(undefined) // UPDATE booking
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await PaymentsService.refundPayment(
        paymentId,
        userId,
        reason,
      );

      expect(result).toEqual(mockRefundedPayment);
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    });

    it("should throw error if payment already refunded", async () => {
      const paymentId = "payment-123";
      const userId = "user-123";

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: "refunded",
      };

      jest
        .spyOn(PaymentsService, "getPaymentById")
        .mockResolvedValue(mockPayment as any);

      await expect(
        PaymentsService.refundPayment(paymentId, userId),
      ).rejects.toThrow("Payment already refunded");
    });
  });

  describe("handleWebhook", () => {
    it("should process webhook successfully", async () => {
      const payload = {
        type: "payment_received",
        transaction_hash: "hash123",
        from: "GABC...",
        to: "GXYZ...",
        amount: "50.0000000",
      };

      const mockPayment = {
        id: "payment-123",
        status: "pending",
        booking_id: "booking-123",
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [mockPayment] }) // find payment
        .mockResolvedValueOnce({}) // update payment
        .mockResolvedValueOnce({}); // update booking

      const result = await PaymentsService.handleWebhook(payload);

      expect(result).toEqual({
        processed: true,
        message: "Payment confirmed via webhook",
      });
    });

    it("should return not processed if no transaction hash", async () => {
      const payload = {
        type: "payment_received",
        amount: "50.0000000",
      };

      const result = await PaymentsService.handleWebhook(payload);

      expect(result).toEqual({
        processed: false,
        message: "No transaction hash provided",
      });
    });

    it("should return not processed if no matching payment", async () => {
      const payload = {
        type: "payment_received",
        transaction_hash: "hash123",
        amount: "50.0000000",
      };

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await PaymentsService.handleWebhook(payload);

      expect(result).toEqual({
        processed: false,
        message: "No matching payment found",
      });
    });
  });
});
