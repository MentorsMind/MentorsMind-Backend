/**
 * Unit Tests for Payments Controller
 * Tests HTTP request handling and response formatting
 */

import { Request, Response } from "express";
import { PaymentsController } from "../../controllers/payments.controller";
import { PaymentsService } from "../../services/payments.service";

jest.mock("../../services/payments.service");

const mockPaymentsService = PaymentsService as jest.Mocked<
  typeof PaymentsService
>;

describe("PaymentsController", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      user: { id: "user-123", role: "mentee" },
      body: {},
      params: {},
      query: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe("initiatePayment", () => {
    it("should initiate payment successfully", async () => {
      mockReq.body = {
        bookingId: "booking-123",
        amount: "100.0000000",
        currency: "XLM",
      };

      const mockPayment = {
        id: "payment-123",
        user_id: "user-123",
        booking_id: "booking-123",
        amount: "100.0000000",
        status: "pending",
        type: "payment",
      };

      mockPaymentsService.initiatePayment.mockResolvedValue(mockPayment as any);

      await PaymentsController.initiatePayment(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockPaymentsService.initiatePayment).toHaveBeenCalledWith({
        userId: "user-123",
        bookingId: "booking-123",
        amount: "100.0000000",
        currency: "XLM",
      });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockPayment,
      });
    });

    it("should handle validation errors", async () => {
      mockReq.body = {
        bookingId: "booking-123",
        // Missing amount
      };

      await PaymentsController.initiatePayment(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it("should handle service errors", async () => {
      mockReq.body = {
        bookingId: "booking-123",
        amount: "100.0000000",
      };

      const error = new Error("Booking not found");
      mockPaymentsService.initiatePayment.mockRejectedValue(error);

      await PaymentsController.initiatePayment(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("getPaymentById", () => {
    it("should retrieve payment by ID", async () => {
      mockReq.params = { id: "payment-123" };

      const mockPayment = {
        id: "payment-123",
        user_id: "user-123",
        status: "completed",
      };

      mockPaymentsService.getPaymentById.mockResolvedValue(mockPayment as any);

      await PaymentsController.getPaymentById(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockPaymentsService.getPaymentById).toHaveBeenCalledWith(
        "payment-123",
        "user-123"
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockPayment,
      });
    });

    it("should handle payment not found", async () => {
      mockReq.params = { id: "nonexistent" };

      const error = new Error("Payment not found");
      mockPaymentsService.getPaymentById.mockRejectedValue(error);

      await PaymentsController.getPaymentById(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("confirmPayment", () => {
    it("should confirm payment with Stellar transaction", async () => {
      mockReq.params = { id: "payment-123" };
      mockReq.body = { stellarTxHash: "tx-hash-123" };

      const mockConfirmedPayment = {
        id: "payment-123",
        status: "completed",
        stellar_tx_hash: "tx-hash-123",
      };

      mockPaymentsService.confirmPayment.mockResolvedValue(
        mockConfirmedPayment as any
      );

      await PaymentsController.confirmPayment(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockPaymentsService.confirmPayment).toHaveBeenCalledWith(
        "payment-123",
        "user-123",
        "tx-hash-123"
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockConfirmedPayment,
      });
    });

    it("should reject invalid Stellar transaction", async () => {
      mockReq.params = { id: "payment-123" };
      mockReq.body = { stellarTxHash: "invalid-tx" };

      const error = new Error("Invalid Stellar transaction");
      mockPaymentsService.confirmPayment.mockRejectedValue(error);

      await PaymentsController.confirmPayment(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("listPayments", () => {
    it("should list user payments with pagination", async () => {
      mockReq.query = { page: "1", limit: "10" };

      const mockResult = {
        payments: [
          { id: "payment-1", status: "completed" },
          { id: "payment-2", status: "pending" },
        ],
        total: 2,
      };

      mockPaymentsService.listUserPayments.mockResolvedValue(mockResult as any);

      await PaymentsController.listPayments(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockPaymentsService.listUserPayments).toHaveBeenCalledWith(
        "user-123",
        { page: 1, limit: 10 }
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult.payments,
        pagination: {
          total: 2,
          page: 1,
          limit: 10,
        },
      });
    });

    it("should filter payments by status", async () => {
      mockReq.query = { page: "1", limit: "10", status: "completed" };

      const mockResult = {
        payments: [{ id: "payment-1", status: "completed" }],
        total: 1,
      };

      mockPaymentsService.listUserPayments.mockResolvedValue(mockResult as any);

      await PaymentsController.listPayments(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockPaymentsService.listUserPayments).toHaveBeenCalledWith(
        "user-123",
        { page: 1, limit: 10, status: "completed" }
      );
    });
  });

  describe("refundPayment", () => {
    it("should refund payment successfully", async () => {
      mockReq.params = { id: "payment-123" };
      mockReq.body = { reason: "Customer request" };

      const mockRefundedPayment = {
        id: "payment-123",
        status: "refunded",
      };

      mockPaymentsService.refundPayment.mockResolvedValue(
        mockRefundedPayment as any
      );

      await PaymentsController.refundPayment(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockPaymentsService.refundPayment).toHaveBeenCalledWith(
        "payment-123",
        "user-123",
        "Customer request"
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockRefundedPayment,
      });
    });

    it("should prevent refund of already refunded payment", async () => {
      mockReq.params = { id: "payment-123" };
      mockReq.body = { reason: "Duplicate refund" };

      const error = new Error("Payment already refunded");
      mockPaymentsService.refundPayment.mockRejectedValue(error);

      await PaymentsController.refundPayment(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("getPaymentHistory", () => {
    it("should retrieve payment history with total volume", async () => {
      mockReq.query = { page: "1", limit: "10" };

      const mockResult = {
        payments: [{ id: "payment-1" }],
        total: 1,
        totalVolume: "500.0000000",
      };

      mockPaymentsService.getPaymentHistory.mockResolvedValue(
        mockResult as any
      );

      await PaymentsController.getPaymentHistory(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: {
          payments: mockResult.payments,
          totalVolume: "500.0000000",
        },
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
        },
      });
    });
  });

  describe("handleWebhook", () => {
    it("should process payment webhook", async () => {
      mockReq.body = {
        type: "payment_received",
        transaction_hash: "tx-hash-123",
        amount: "100.0000000",
      };

      const mockResult = {
        processed: true,
        message: "Payment confirmed",
      };

      mockPaymentsService.handleWebhook.mockResolvedValue(mockResult);

      await PaymentsController.handleWebhook(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockPaymentsService.handleWebhook).toHaveBeenCalledWith(
        mockReq.body
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    it("should handle webhook processing errors", async () => {
      mockReq.body = {
        type: "payment_received",
        transaction_hash: "invalid",
      };

      const error = new Error("Webhook processing failed");
      mockPaymentsService.handleWebhook.mockRejectedValue(error);

      await PaymentsController.handleWebhook(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });
});
