import { DisputeService, NotificationService } from "../disputes.service";
import { DisputeStateMachine } from "../dispute-state-machine.service";
import { DisputeModel, DisputeRecord } from "../../models/dispute.model";
import { SorobanEscrowService } from "../sorobanEscrow.service";
import { DatabaseService } from "../database.service";
import pool from "../../config/database";

jest.mock("../../models/dispute.model", () => ({
  DisputeModel: {
    create: jest.fn(),
    findById: jest.fn(),
    updateStatus: jest.fn(),
    findUnresolvedOlderThanDays: jest.fn(),
    addEvidence: jest.fn(),
  },
}));

jest.mock("../../models/audit-log.model", () => ({
  AuditLogModel: { create: jest.fn() },
}));

jest.mock("../sorobanEscrow.service", () => ({
  SorobanEscrowService: {
    refund: jest.fn(),
    releaseFunds: jest.fn(),
  },
}));

jest.mock("../database.service", () => ({
  DatabaseService: {
    withTransaction: jest.fn((cb: (client: any) => Promise<any>) =>
      cb({
        query: jest
          .fn()
          .mockResolvedValue({
            rows: [
              {
                id: "disp-1",
                status: "resolved",
                resolution_notes: "User is right",
                reporter_id: "user-1",
                transaction_id: "tx-123",
                reason: "Test",
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          }),
      }),
    ),
  },
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

describe("Dispute Resolution Workflow", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("DisputeStateMachine", () => {
    it("should allow open -> under_review transition", () => {
      expect(() =>
        DisputeStateMachine.assertTransition("open", "under_review"),
      ).not.toThrow();
    });

    it("should allow under_review -> resolved transition", () => {
      expect(() =>
        DisputeStateMachine.assertTransition("under_review", "resolved"),
      ).not.toThrow();
    });

    it("should throw on invalid resolved -> open transition", () => {
      expect(() =>
        DisputeStateMachine.assertTransition("resolved", "open"),
      ).toThrow("Invalid state transition");
    });
  });

  describe("DisputesService", () => {
    it("should escalate old disputes and notify users", async () => {
      const oldDispute: DisputeRecord = {
        id: "disp-1",
        transaction_id: "tx-123",
        reporter_id: "user-1",
        reason: "Test",
        status: "open",
        resolution_notes: null,
        created_at: new Date(Date.now() - 8 * 86400000),
        updated_at: new Date(),
      };

      (DisputeModel.findUnresolvedOlderThanDays as jest.Mock).mockResolvedValue(
        [oldDispute],
      );
      (DisputeModel.updateStatus as jest.Mock).mockResolvedValue({
        ...oldDispute,
        status: "under_review",
      });

      const notifySpy = jest
        .spyOn(NotificationService, "notifyDisputeUpdate")
        .mockResolvedValue();

      const count = await DisputeService.escalateOldDisputes();

      expect(count).toBe(1);
      expect(DisputeModel.updateStatus).toHaveBeenCalledWith(
        "disp-1",
        "under_review",
        expect.any(String),
      );
      expect(notifySpy).toHaveBeenCalledWith(
        "user-1",
        "disp-1",
        expect.stringContaining("auto-escalated"),
      );
    });

    it("should upload evidence and record audit log", async () => {
      (DisputeModel.addEvidence as jest.Mock).mockResolvedValue({ id: "ev-1" });

      await DisputeService.uploadEvidence(
        "disp-1",
        "user-1",
        "Got cheated.",
        "http://example.com/img.png",
      );
      expect(DisputeModel.addEvidence).toHaveBeenCalledWith({
        dispute_id: "disp-1",
        submitter_id: "user-1",
        text_content: "Got cheated.",
        file_url: "http://example.com/img.png",
      });
    });

    describe("resolveDispute — real escrow integration", () => {
      const dispute: DisputeRecord = {
        id: "disp-1",
        transaction_id: "tx-123",
        reporter_id: "user-1",
        reason: "Test",
        status: "under_review",
        resolution_notes: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      beforeEach(() => {
        (DisputeModel.findById as jest.Mock).mockResolvedValue(dispute);
        (pool.query as jest.Mock).mockResolvedValue({
          rows: [
            {
              escrow_id: "escrow-abc",
              escrow_contract_address: "CCONTRACT123",
            },
          ],
        });
      });

      it("calls SorobanEscrowService.refund for full_refund and updates status atomically", async () => {
        await DisputeService.resolveDispute(
          "disp-1",
          "admin-1",
          "full_refund",
          "User is right",
        );

        expect(pool.query).toHaveBeenCalledWith(
          expect.stringContaining("SELECT escrow_id"),
          ["tx-123"],
        );
        expect(SorobanEscrowService.refund).toHaveBeenCalledWith({
          escrowId: "escrow-abc",
          refundedBy: "admin-1",
          contractAddress: "CCONTRACT123",
        });
        expect(DatabaseService.withTransaction).toHaveBeenCalled();
      });

      it("calls SorobanEscrowService.refund for partial_refund", async () => {
        await DisputeService.resolveDispute(
          "disp-1",
          "admin-1",
          "partial_refund",
          "Partial refund",
        );

        expect(SorobanEscrowService.refund).toHaveBeenCalledWith(
          expect.objectContaining({ escrowId: "escrow-abc" }),
        );
        expect(SorobanEscrowService.releaseFunds).not.toHaveBeenCalled();
      });

      it("calls SorobanEscrowService.releaseFunds for release", async () => {
        await DisputeService.resolveDispute(
          "disp-1",
          "admin-1",
          "release",
          "Mentor is right",
        );

        expect(SorobanEscrowService.releaseFunds).toHaveBeenCalledWith({
          escrowId: "escrow-abc",
          releasedBy: "admin-1",
          contractAddress: "CCONTRACT123",
        });
        expect(SorobanEscrowService.refund).not.toHaveBeenCalled();
      });

      it("throws if no escrow_id found for the booking", async () => {
        (pool.query as jest.Mock).mockResolvedValue({
          rows: [{ escrow_id: null, escrow_contract_address: null }],
        });

        await expect(
          DisputeService.resolveDispute(
            "disp-1",
            "admin-1",
            "release",
            "notes",
          ),
        ).rejects.toThrow("No escrow_id found for booking tx-123");
      });

      it("throws if dispute is not found", async () => {
        (DisputeModel.findById as jest.Mock).mockResolvedValue(null);

        await expect(
          DisputeService.resolveDispute(
            "disp-1",
            "admin-1",
            "release",
            "notes",
          ),
        ).rejects.toThrow("Dispute not found");
      });

      it("rolls back if escrow call fails (withTransaction propagates error)", async () => {
        (DatabaseService.withTransaction as jest.Mock).mockRejectedValue(
          new Error("Soroban RPC error"),
        );

        await expect(
          DisputeService.resolveDispute(
            "disp-1",
            "admin-1",
            "full_refund",
            "notes",
          ),
        ).rejects.toThrow("Soroban RPC error");
      });
    });
  });
});
