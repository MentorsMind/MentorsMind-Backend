/**
 * Unit Tests for Escrow Controller
 * Tests HTTP request handling for escrow operations
 */

import { Request, Response } from "express";
import { EscrowController } from "../../controllers/escrow.controller";
import { SorobanEscrowService } from "../../services/sorobanEscrow.service";

jest.mock("../../services/sorobanEscrow.service");

const mockEscrowService = SorobanEscrowService as jest.Mocked<
  typeof SorobanEscrowService
>;

describe("EscrowController", () => {
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

  describe("createEscrow", () => {
    it("should create escrow successfully", async () => {
      mockReq.body = {
        bookingId: "booking-123",
        learnerId: "learner-123",
        mentorId: "mentor-123",
        amount: "100.0000000",
        currency: "XLM",
      };

      const mockEscrow = {
        contractAddress: "CABC123",
        escrowId: "escrow-123",
        txHash: "tx-hash-123",
      };

      mockEscrowService.createEscrow.mockResolvedValue(mockEscrow);

      await EscrowController.createEscrow(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockEscrowService.createEscrow).toHaveBeenCalledWith({
        bookingId: "booking-123",
        learnerId: "learner-123",
        mentorId: "mentor-123",
        amount: "100.0000000",
        currency: "XLM",
      });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockEscrow,
      });
    });

    it("should handle validation errors", async () => {
      mockReq.body = {
        bookingId: "booking-123",
        // Missing required fields
      };

      await EscrowController.createEscrow(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it("should handle Soroban contract errors", async () => {
      mockReq.body = {
        bookingId: "booking-123",
        learnerId: "learner-123",
        mentorId: "mentor-123",
        amount: "100.0000000",
        currency: "XLM",
      };

      const error = new Error("Soroban contract invocation failed");
      mockEscrowService.createEscrow.mockRejectedValue(error);

      await EscrowController.createEscrow(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("releaseFunds", () => {
    it("should release escrow funds successfully", async () => {
      mockReq.params = { escrowId: "escrow-123" };
      mockReq.body = { releasedBy: "learner-123" };

      const mockResult = {
        txHash: "release-tx-hash",
        escrowId: "escrow-123",
      };

      mockEscrowService.releaseFunds.mockResolvedValue(mockResult);

      await EscrowController.releaseFunds(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockEscrowService.releaseFunds).toHaveBeenCalledWith({
        escrowId: "escrow-123",
        releasedBy: "learner-123",
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    it("should prevent unauthorized release", async () => {
      mockReq.params = { escrowId: "escrow-123" };
      mockReq.body = { releasedBy: "unauthorized-user" };

      const error = new Error("Unauthorized to release funds");
      mockEscrowService.releaseFunds.mockRejectedValue(error);

      await EscrowController.releaseFunds(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("refundEscrow", () => {
    it("should refund escrow successfully", async () => {
      mockReq.params = { escrowId: "escrow-123" };
      mockReq.body = { refundedBy: "mentor-123" };

      const mockResult = {
        txHash: "refund-tx-hash",
        escrowId: "escrow-123",
      };

      mockEscrowService.refund.mockResolvedValue(mockResult);

      await EscrowController.refundEscrow(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockEscrowService.refund).toHaveBeenCalledWith({
        escrowId: "escrow-123",
        refundedBy: "mentor-123",
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    it("should handle refund errors", async () => {
      mockReq.params = { escrowId: "escrow-123" };
      mockReq.body = { refundedBy: "mentor-123" };

      const error = new Error("Escrow cannot be refunded");
      mockEscrowService.refund.mockRejectedValue(error);

      await EscrowController.refundEscrow(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe("openDispute", () => {
    it("should open escrow dispute successfully", async () => {
      mockReq.params = { escrowId: "escrow-123" };
      mockReq.body = {
        raisedBy: "learner-123",
        reason: "Service not delivered",
      };

      const mockResult = {
        txHash: "dispute-tx-hash",
        escrowId: "escrow-123",
      };

      mockEscrowService.openDispute.mockResolvedValue(mockResult);

      await EscrowController.openDispute(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockEscrowService.openDispute).toHaveBeenCalledWith({
        escrowId: "escrow-123",
        raisedBy: "learner-123",
        reason: "Service not delivered",
      });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    it("should require dispute reason", async () => {
      mockReq.params = { escrowId: "escrow-123" };
      mockReq.body = {
        raisedBy: "learner-123",
        // Missing reason
      };

      await EscrowController.openDispute(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("resolveDispute", () => {
    it("should resolve dispute with split percentage", async () => {
      mockReq.params = { escrowId: "escrow-123" };
      mockReq.body = {
        splitPercentage: 60,
        resolvedBy: "admin-123",
      };

      const mockResult = {
        txHash: "resolve-tx-hash",
        escrowId: "escrow-123",
      };

      mockEscrowService.resolveDispute.mockResolvedValue(mockResult);

      await EscrowController.resolveDispute(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockEscrowService.resolveDispute).toHaveBeenCalledWith({
        escrowId: "escrow-123",
        splitPercentage: 60,
        resolvedBy: "admin-123",
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    it("should validate split percentage range", async () => {
      mockReq.params = { escrowId: "escrow-123" };
      mockReq.body = {
        splitPercentage: 150, // Invalid: > 100
        resolvedBy: "admin-123",
      };

      const error = new Error("Split percentage must be between 0 and 100");
      mockEscrowService.resolveDispute.mockRejectedValue(error);

      await EscrowController.resolveDispute(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it("should require admin role for resolution", async () => {
      mockReq.user = { id: "user-123", role: "mentee" }; // Not admin
      mockReq.params = { escrowId: "escrow-123" };
      mockReq.body = {
        splitPercentage: 50,
        resolvedBy: "user-123",
      };

      await EscrowController.resolveDispute(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Unauthorized"),
        })
      );
    });
  });

  describe("getEscrowState", () => {
    it("should retrieve escrow state", async () => {
      mockReq.params = { escrowId: "escrow-123" };

      const mockState = {
        escrowId: "escrow-123",
        status: "held",
        amount: "100.0000000",
        learnerId: "learner-123",
        mentorId: "mentor-123",
      };

      mockEscrowService.getEscrowState.mockResolvedValue(mockState as any);

      await EscrowController.getEscrowState(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockEscrowService.getEscrowState).toHaveBeenCalledWith(
        expect.any(String),
        "escrow-123"
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: mockState,
      });
    });

    it("should handle non-existent escrow", async () => {
      mockReq.params = { escrowId: "nonexistent" };

      const error = new Error("Escrow not found");
      mockEscrowService.getEscrowState.mockRejectedValue(error);

      await EscrowController.getEscrowState(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });
});
