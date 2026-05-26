/**
 * Integration Tests for Payment Flow
 * Tests the complete payment lifecycle including initiation, confirmation, and refunds
 */

import { testPool, testRedis } from "../setup/integrationSetup";
import { PaymentsService } from "../../services/payments.service";
import { BookingModel } from "../../models/booking.model";
import { stellarService } from "../../services/stellar.service";

jest.mock("../../services/stellar.service");
jest.mock("../../services/socket.service");

const mockStellarService = stellarService as jest.Mocked<typeof stellarService>;

describe("Payment Flow Integration Tests", () => {
  let mentorId: string;
  let menteeId: string;
  let bookingId: string;

  beforeEach(async () => {
    // Create test users
    const mentorResult = await testPool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        `mentor-${Date.now()}@test.com`,
        "hashed_password",
        "Test",
        "Mentor",
        "mentor",
        "active",
      ]
    );
    mentorId = mentorResult.rows[0].id;

    const menteeResult = await testPool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        `mentee-${Date.now()}@test.com`,
        "hashed_password",
        "Test",
        "Mentee",
        "mentee",
        "active",
      ]
    );
    menteeId = menteeResult.rows[0].id;

    // Create test booking
    const bookingResult = await testPool.query(
      `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, amount, payment_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        menteeId,
        mentorId,
        new Date(Date.now() + 86400000), // Tomorrow
        60,
        "Test Session",
        "pending",
        "100.0000000",
        "pending",
      ]
    );
    bookingId = bookingResult.rows[0].id;
  });

  describe("Payment Initiation", () => {
    it("should initiate payment successfully", async () => {
      const payment = await PaymentsService.initiatePayment({
        userId: menteeId,
        bookingId,
        amount: "100.0000000",
        currency: "XLM",
        description: "Test payment",
      });

      expect(payment).toBeDefined();
      expect(payment.user_id).toBe(menteeId);
      expect(payment.booking_id).toBe(bookingId);
      expect(payment.amount).toBe("100.0000000");
      expect(payment.status).toBe("pending");
      expect(payment.type).toBe("payment");

      // Verify payment was stored in database
      const dbResult = await testPool.query(
        "SELECT * FROM transactions WHERE id = $1",
        [payment.id]
      );
      expect(dbResult.rows).toHaveLength(1);
      expect(dbResult.rows[0].user_id).toBe(menteeId);
    });

    it("should throw error if booking does not exist", async () => {
      await expect(
        PaymentsService.initiatePayment({
          userId: menteeId,
          bookingId: "00000000-0000-0000-0000-000000000000",
          amount: "100.0000000",
        })
      ).rejects.toThrow("Booking not found");
    });

    it("should throw error if user does not own booking", async () => {
      await expect(
        PaymentsService.initiatePayment({
          userId: mentorId, // Mentor trying to pay for their own session
          bookingId,
          amount: "100.0000000",
        })
      ).rejects.toThrow();
    });

    it("should calculate platform fee correctly", async () => {
      const payment = await PaymentsService.initiatePayment({
        userId: menteeId,
        bookingId,
        amount: "100.0000000",
        currency: "XLM",
      });

      expect(payment.platform_fee).toBeDefined();
      const fee = parseFloat(payment.platform_fee);
      expect(fee).toBeGreaterThan(0);
      expect(fee).toBeLessThan(parseFloat(payment.amount));
    });
  });

  describe("Payment Confirmation", () => {
    let paymentId: string;

    beforeEach(async () => {
      const payment = await PaymentsService.initiatePayment({
        userId: menteeId,
        bookingId,
        amount: "100.0000000",
        currency: "XLM",
        fromAddress: "GABC123",
      });
      paymentId = payment.id;
    });

    it("should confirm payment with valid Stellar transaction", async () => {
      const txHash = "stellar-tx-hash-123";

      mockStellarService.getTransaction.mockResolvedValue({
        successful: true,
        hash: txHash,
        source_account: "GABC123",
      } as any);

      mockStellarService.getTransactionOperations.mockResolvedValue([
        {
          type: "payment",
          amount: "100.0000000",
        },
      ] as any);

      const confirmedPayment = await PaymentsService.confirmPayment(
        paymentId,
        menteeId,
        txHash
      );

      expect(confirmedPayment.status).toBe("completed");
      expect(confirmedPayment.stellar_tx_hash).toBe(txHash);

      // Verify booking payment status updated
      const bookingResult = await testPool.query(
        "SELECT payment_status FROM bookings WHERE id = $1",
        [bookingId]
      );
      expect(bookingResult.rows[0].payment_status).toBe("paid");
    });

    it("should reject confirmation if transaction was not successful", async () => {
      const txHash = "failed-tx-hash";

      mockStellarService.getTransaction.mockResolvedValue({
        successful: false,
        hash: txHash,
        source_account: "GABC123",
      } as any);

      await expect(
        PaymentsService.confirmPayment(paymentId, menteeId, txHash)
      ).rejects.toThrow("Stellar transaction was not successful");
    });

    it("should reject confirmation if source account does not match", async () => {
      const txHash = "tx-hash-123";

      mockStellarService.getTransaction.mockResolvedValue({
        successful: true,
        hash: txHash,
        source_account: "GXYZ789", // Different account
      } as any);

      await expect(
        PaymentsService.confirmPayment(paymentId, menteeId, txHash)
      ).rejects.toThrow("source account does not match");
    });

    it("should reject confirmation if payment amount does not match", async () => {
      const txHash = "tx-hash-123";

      mockStellarService.getTransaction.mockResolvedValue({
        successful: true,
        hash: txHash,
        source_account: "GABC123",
      } as any);

      mockStellarService.getTransactionOperations.mockResolvedValue([
        {
          type: "payment",
          amount: "50.0000000", // Wrong amount
        },
      ] as any);

      await expect(
        PaymentsService.confirmPayment(paymentId, menteeId, txHash)
      ).rejects.toThrow("matching payment amount");
    });

    it("should prevent double confirmation", async () => {
      const txHash = "tx-hash-123";

      mockStellarService.getTransaction.mockResolvedValue({
        successful: true,
        hash: txHash,
        source_account: "GABC123",
      } as any);

      mockStellarService.getTransactionOperations.mockResolvedValue([
        {
          type: "payment",
          amount: "100.0000000",
        },
      ] as any);

      await PaymentsService.confirmPayment(paymentId, menteeId, txHash);

      // Try to confirm again
      await expect(
        PaymentsService.confirmPayment(paymentId, menteeId, txHash)
      ).rejects.toThrow("already confirmed");
    });
  });

  describe("Payment Refund", () => {
    let paymentId: string;

    beforeEach(async () => {
      const payment = await PaymentsService.initiatePayment({
        userId: menteeId,
        bookingId,
        amount: "100.0000000",
        currency: "XLM",
        fromAddress: "GABC123",
      });
      paymentId = payment.id;

      // Confirm the payment first
      mockStellarService.getTransaction.mockResolvedValue({
        successful: true,
        hash: "tx-hash",
        source_account: "GABC123",
      } as any);

      mockStellarService.getTransactionOperations.mockResolvedValue([
        {
          type: "payment",
          amount: "100.0000000",
        },
      ] as any);

      await PaymentsService.confirmPayment(paymentId, menteeId, "tx-hash");
    });

    it("should refund payment successfully", async () => {
      const refundedPayment = await PaymentsService.refundPayment(
        paymentId,
        menteeId,
        "Customer request"
      );

      expect(refundedPayment.status).toBe("refunded");

      // Verify refund transaction was created
      const refundResult = await testPool.query(
        "SELECT * FROM transactions WHERE type = 'refund' AND related_transaction_id = $1",
        [paymentId]
      );
      expect(refundResult.rows).toHaveLength(1);
      expect(refundResult.rows[0].amount).toBe("100.0000000");
      expect(refundResult.rows[0].user_id).toBe(menteeId);

      // Verify booking status updated
      const bookingResult = await testPool.query(
        "SELECT payment_status FROM bookings WHERE id = $1",
        [bookingId]
      );
      expect(bookingResult.rows[0].payment_status).toBe("refunded");
    });

    it("should prevent double refund", async () => {
      await PaymentsService.refundPayment(paymentId, menteeId, "First refund");

      await expect(
        PaymentsService.refundPayment(paymentId, menteeId, "Second refund")
      ).rejects.toThrow("already refunded");
    });

    it("should not refund pending payment", async () => {
      // Create a new pending payment
      const pendingPayment = await PaymentsService.initiatePayment({
        userId: menteeId,
        bookingId,
        amount: "50.0000000",
      });

      await expect(
        PaymentsService.refundPayment(pendingPayment.id, menteeId)
      ).rejects.toThrow();
    });
  });

  describe("Payment History", () => {
    beforeEach(async () => {
      // Create multiple payments
      for (let i = 0; i < 5; i++) {
        const booking = await testPool.query(
          `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, amount, payment_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            menteeId,
            mentorId,
            new Date(Date.now() + 86400000 * (i + 1)),
            60,
            `Session ${i + 1}`,
            "pending",
            `${(i + 1) * 50}.0000000`,
            "pending",
          ]
        );

        await PaymentsService.initiatePayment({
          userId: menteeId,
          bookingId: booking.rows[0].id,
          amount: `${(i + 1) * 50}.0000000`,
        });
      }
    });

    it("should retrieve paginated payment history", async () => {
      const result = await PaymentsService.listUserPayments(menteeId, {
        page: 1,
        limit: 3,
      });

      expect(result.payments).toHaveLength(3);
      expect(result.total).toBeGreaterThanOrEqual(5);
      expect(result.payments[0].user_id).toBe(menteeId);
    });

    it("should filter payments by status", async () => {
      const result = await PaymentsService.listUserPayments(menteeId, {
        page: 1,
        limit: 10,
        status: "pending",
      });

      expect(result.payments.length).toBeGreaterThan(0);
      result.payments.forEach((payment) => {
        expect(payment.status).toBe("pending");
      });
    });

    it("should calculate total payment volume", async () => {
      const result = await PaymentsService.getPaymentHistory(menteeId, {
        page: 1,
        limit: 10,
      });

      expect(result.totalVolume).toBeDefined();
      const volume = parseFloat(result.totalVolume);
      expect(volume).toBeGreaterThan(0);
    });
  });

  describe("Payment Webhook Handling", () => {
    let paymentId: string;

    beforeEach(async () => {
      const payment = await PaymentsService.initiatePayment({
        userId: menteeId,
        bookingId,
        amount: "100.0000000",
        fromAddress: "GABC123",
        toAddress: "GXYZ789",
      });
      paymentId = payment.id;

      // Store transaction hash for webhook lookup
      await testPool.query(
        "UPDATE transactions SET stellar_tx_hash = $1 WHERE id = $2",
        ["webhook-tx-hash", paymentId]
      );
    });

    it("should process payment webhook successfully", async () => {
      const payload = {
        type: "payment_received",
        transaction_hash: "webhook-tx-hash",
        from: "GABC123",
        to: "GXYZ789",
        amount: "100.0000000",
      };

      const result = await PaymentsService.handleWebhook(payload);

      expect(result.processed).toBe(true);
      expect(result.message).toContain("confirmed");

      // Verify payment status updated
      const paymentResult = await testPool.query(
        "SELECT status FROM transactions WHERE id = $1",
        [paymentId]
      );
      expect(paymentResult.rows[0].status).toBe("completed");
    });

    it("should ignore webhook without transaction hash", async () => {
      const payload = {
        type: "payment_received",
        amount: "100.0000000",
      };

      const result = await PaymentsService.handleWebhook(payload);

      expect(result.processed).toBe(false);
      expect(result.message).toContain("No transaction hash");
    });

    it("should ignore webhook for non-existent payment", async () => {
      const payload = {
        type: "payment_received",
        transaction_hash: "non-existent-hash",
        amount: "100.0000000",
      };

      const result = await PaymentsService.handleWebhook(payload);

      expect(result.processed).toBe(false);
      expect(result.message).toContain("No matching payment");
    });
  });
});
