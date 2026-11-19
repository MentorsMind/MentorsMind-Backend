import { PaymentReconciliationService } from "../payment-reconciliation.service";
import pool from "../../config/database";
import { SocketService } from "../socket.service";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));
jest.mock("../../utils/logger.utils", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock("../socket.service", () => ({
  SocketService: { emitToRoom: jest.fn() },
}));

const mockedQuery = pool.query as jest.Mock;

describe("PaymentReconciliationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("runNightlyReconciliation", () => {
    it("marks a booking reconciled (no discrepancy) when its single transaction is confirmed with a rail + reference", async () => {
      mockedQuery
        // distinct booking ids
        .mockResolvedValueOnce({ rows: [{ booking_id: "booking-1", user_id: "user-1" }] })
        // transactions for booking-1: single completed, stellar-backed, referenced tx
        .mockResolvedValueOnce({
          rows: [
            {
              id: "tx-1",
              booking_id: "booking-1",
              user_id: "user-1",
              status: "completed",
              stellar_tx_hash: "abcd1234",
              external_reference: "stellar:abcd1234",
              metadata: {},
            },
          ],
        });

      const summary = await PaymentReconciliationService.runNightlyReconciliation();

      expect(summary.discrepanciesCreated).toBe(0);
      expect(summary.totalBookingsChecked).toBe(1);
      expect(SocketService.emitToRoom).not.toHaveBeenCalled();
    });

    it("flags a discrepancy and alerts admins when a transaction is missing its rail/reference (transaction not yet confirmed on the ledger)", async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ booking_id: "booking-2", user_id: "user-2" }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "tx-2",
              booking_id: "booking-2",
              user_id: "user-2",
              status: "pending",
              stellar_tx_hash: null,
              external_reference: null,
              metadata: {},
            },
          ],
        })
        // insertDiscrepancy: existing-check
        .mockResolvedValueOnce({ rows: [] })
        // insertDiscrepancy: insert
        .mockResolvedValueOnce({ rows: [] })
        // open discrepancies for alert
        .mockResolvedValueOnce({
          rows: [
            {
              id: "disc-1",
              booking_id: "booking-2",
              payment_rail: null,
              discrepancy_type: "missing_rail_reference",
              review_status: "open",
            },
          ],
        });

      const summary = await PaymentReconciliationService.runNightlyReconciliation();

      expect(summary.discrepanciesCreated).toBe(1);
      expect(summary.alertsSent).toBe(1);
      expect(SocketService.emitToRoom).toHaveBeenCalledWith(
        "admin",
        "payment:reconciliation:alert",
        expect.objectContaining({ count: 1 }),
      );
    });

    it("flags a status_mismatch discrepancy when Stellar rejected a transaction that also has a completed record for the same booking", async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ booking_id: "booking-3", user_id: "user-3" }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "tx-3a",
              booking_id: "booking-3",
              user_id: "user-3",
              status: "completed",
              stellar_tx_hash: "hash-a",
              external_reference: "ref-a",
              metadata: {},
            },
            {
              id: "tx-3b",
              booking_id: "booking-3",
              user_id: "user-3",
              status: "failed",
              stellar_tx_hash: "hash-b",
              external_reference: "ref-b",
              metadata: {},
            },
          ],
        })
        // insertDiscrepancy (status_mismatch): existing-check + insert
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        // per-record missing_rail_reference checks (both have rail + reference, so no inserts)
        .mockResolvedValueOnce({ rows: [] });

      const summary = await PaymentReconciliationService.runNightlyReconciliation();

      expect(summary.discrepanciesCreated).toBe(1);
    });

    it("does not raise a duplicate discrepancy when an open one already exists for the booking", async () => {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ booking_id: "booking-4", user_id: "user-4" }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "tx-4",
              booking_id: "booking-4",
              user_id: "user-4",
              status: "pending",
              stellar_tx_hash: null,
              external_reference: null,
              metadata: {},
            },
          ],
        })
        // existing-check returns an already-open discrepancy → skip insert
        .mockResolvedValueOnce({ rows: [{ id: "existing-disc" }] });

      const summary = await PaymentReconciliationService.runNightlyReconciliation();

      expect(summary.discrepanciesCreated).toBe(0);
      expect(SocketService.emitToRoom).not.toHaveBeenCalled();
    });

    it("propagates errors from the database layer", async () => {
      mockedQuery.mockRejectedValueOnce(new Error("connection lost"));

      await expect(
        PaymentReconciliationService.runNightlyReconciliation(),
      ).rejects.toThrow("connection lost");
    });
  });

  describe("reviewDiscrepancy", () => {
    it("updates review status and returns the updated row", async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ id: "disc-1", review_status: "resolved" }],
      });

      const result = await PaymentReconciliationService.reviewDiscrepancy(
        "disc-1",
        "admin-1",
        "resolved",
        "confirmed on Horizon",
      );

      expect(result.review_status).toBe("resolved");
    });

    it("throws when the discrepancy does not exist", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        PaymentReconciliationService.reviewDiscrepancy(
          "missing-id",
          "admin-1",
          "resolved",
        ),
      ).rejects.toThrow("Payment reconciliation discrepancy not found");
    });
  });
});
