/**
 * E2E Tests for Dispute Resolution Flow
 * Tests the complete dispute lifecycle from creation to resolution
 */

import { testPool, testRedis } from "../setup/integrationSetup";
import { DisputeService } from "../../services/disputes.service";
import { PaymentsService } from "../../services/payments.service";
import { SorobanEscrowService } from "../../services/sorobanEscrow.service";

jest.mock("../../services/stellar.service");
jest.mock("../../services/socket.service");
jest.mock("../../services/sorobanEscrow.service");

const mockSorobanEscrow = SorobanEscrowService as jest.Mocked<
  typeof SorobanEscrowService
>;

describe("E2E: Dispute Resolution Flow", () => {
  let adminId: string;
  let mentorId: string;
  let menteeId: string;
  let bookingId: string;
  let paymentId: string;

  beforeAll(async () => {
    // Ensure required tables exist
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS disputes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL,
        reporter_id UUID NOT NULL,
        reason TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        resolution_notes TEXT,
        resolved_by UUID,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS dispute_evidence (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dispute_id UUID NOT NULL,
        submitter_id UUID NOT NULL,
        text_content TEXT,
        file_url VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  });

  beforeEach(async () => {
    // Create test users
    const adminResult = await testPool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        `admin-${Date.now()}@test.com`,
        "hashed_password",
        "Admin",
        "User",
        "admin",
        "active",
      ]
    );
    adminId = adminResult.rows[0].id;

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

    // Create booking
    const bookingResult = await testPool.query(
      `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, amount, payment_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        menteeId,
        mentorId,
        new Date(Date.now() - 86400000), // Yesterday
        60,
        "Disputed Session",
        "completed",
        "150.0000000",
        "paid",
      ]
    );
    bookingId = bookingResult.rows[0].id;

    // Create payment
    const paymentResult = await testPool.query(
      `INSERT INTO transactions (user_id, booking_id, amount, currency, status, type, stellar_tx_hash, created_at, updated_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
       RETURNING id`,
      [
        menteeId,
        bookingId,
        "150.0000000",
        "XLM",
        "completed",
        "payment",
        "stellar-tx-hash-123",
      ]
    );
    paymentId = paymentResult.rows[0].id;
  });

  describe("Dispute Creation", () => {
    it("should create dispute successfully", async () => {
      const dispute = await DisputeService.openDispute(
        paymentId,
        menteeId,
        "Session quality did not meet expectations"
      );

      expect(dispute).toBeDefined();
      expect(dispute.transaction_id).toBe(paymentId);
      expect(dispute.reporter_id).toBe(menteeId);
      expect(dispute.status).toBe("open");
      expect(dispute.reason).toContain("quality");

      // Verify dispute stored in database
      const dbResult = await testPool.query(
        "SELECT * FROM disputes WHERE id = $1",
        [dispute.id]
      );
      expect(dbResult.rows).toHaveLength(1);
    });

    it("should prevent duplicate disputes for same payment", async () => {
      await DisputeService.openDispute(
        paymentId,
        menteeId,
        "First dispute"
      );

      await expect(
        DisputeService.openDispute(paymentId, menteeId, "Second dispute")
      ).rejects.toThrow();
    });

    it("should allow mentor to create dispute", async () => {
      const dispute = await DisputeService.openDispute(
        paymentId,
        mentorId,
        "Session was cancelled by learner without notice"
      );

      expect(dispute.reporter_id).toBe(mentorId);
      expect(dispute.status).toBe("open");
    });

    it("should not allow dispute for pending payment", async () => {
      const pendingPayment = await testPool.query(
        `INSERT INTO transactions (user_id, booking_id, amount, currency, status, type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [menteeId, bookingId, "50.0000000", "XLM", "pending", "payment"]
      );

      await expect(
        DisputeService.openDispute(
          pendingPayment.rows[0].id,
          menteeId,
          "Dispute reason"
        )
      ).rejects.toThrow();
    });
  });

  describe("Evidence Submission", () => {
    let disputeId: string;

    beforeEach(async () => {
      const dispute = await DisputeService.openDispute(
        paymentId,
        menteeId,
        "Session quality issue"
      );
      disputeId = dispute.id;
    });

    it("should allow learner to submit evidence", async () => {
      await testPool.query(
        `INSERT INTO dispute_evidence (dispute_id, submitter_id, text_content)
         VALUES ($1, $2, $3)`,
        [disputeId, menteeId, "The mentor did not cover the agreed topics"]
      );

      const evidenceResult = await testPool.query(
        "SELECT * FROM dispute_evidence WHERE dispute_id = $1",
        [disputeId]
      );

      expect(evidenceResult.rows).toHaveLength(1);
      expect(evidenceResult.rows[0].submitter_id).toBe(menteeId);
    });

    it("should allow mentor to submit counter-evidence", async () => {
      await testPool.query(
        `INSERT INTO dispute_evidence (dispute_id, submitter_id, text_content)
         VALUES ($1, $2, $3)`,
        [disputeId, mentorId, "All topics were covered as per the booking"]
      );

      const evidenceResult = await testPool.query(
        "SELECT * FROM dispute_evidence WHERE dispute_id = $1 AND submitter_id = $2",
        [disputeId, mentorId]
      );

      expect(evidenceResult.rows).toHaveLength(1);
    });

    it("should support file attachments as evidence", async () => {
      await testPool.query(
        `INSERT INTO dispute_evidence (dispute_id, submitter_id, text_content, file_url)
         VALUES ($1, $2, $3, $4)`,
        [
          disputeId,
          menteeId,
          "Screenshot of session notes",
          "https://storage.example.com/evidence/screenshot.png",
        ]
      );

      const evidenceResult = await testPool.query(
        "SELECT * FROM dispute_evidence WHERE dispute_id = $1 AND file_url IS NOT NULL",
        [disputeId]
      );

      expect(evidenceResult.rows).toHaveLength(1);
      expect(evidenceResult.rows[0].file_url).toContain("screenshot.png");
    });
  });

  describe("Dispute Resolution", () => {
    let disputeId: string;

    beforeEach(async () => {
      const dispute = await DisputeService.openDispute(
        paymentId,
        menteeId,
        "Session quality issue"
      );
      disputeId = dispute.id;
    });

    it("should resolve dispute with full refund", async () => {
      const resolved = await DisputeService.resolveDispute(
        disputeId,
        adminId,
        "full_refund",
        "Evidence supports learner's claim"
      );

      expect(resolved.status).toBe("resolved");
      expect(resolved.resolved_by).toBe(adminId);
      expect(resolved.resolution_notes).toContain("Evidence supports");

      // Verify refund transaction created
      const refundResult = await testPool.query(
        "SELECT * FROM transactions WHERE type = 'refund' AND related_transaction_id = $1",
        [paymentId]
      );
      expect(refundResult.rows).toHaveLength(1);
      expect(refundResult.rows[0].amount).toBe("150.0000000");
    });

    it("should resolve dispute with partial refund (50/50 split)", async () => {
      mockSorobanEscrow.resolveDispute.mockResolvedValue({
        txHash: "soroban-tx-hash",
        escrowId: "escrow-123",
      } as any);

      const resolved = await DisputeService.resolveDispute(
        disputeId,
        adminId,
        "partial_refund",
        "Both parties share responsibility"
      );

      expect(resolved.status).toBe("resolved");

      // Verify split transactions created
      const splitResult = await testPool.query(
        `SELECT type, amount FROM transactions 
         WHERE related_transaction_id = $1 
         AND type IN ('refund', 'mentor_payout')
         ORDER BY type`,
        [paymentId]
      );

      expect(splitResult.rows).toHaveLength(2);
      
      const refund = splitResult.rows.find((r) => r.type === "refund");
      const payout = splitResult.rows.find((r) => r.type === "mentor_payout");

      expect(parseFloat(refund.amount)).toBe(75); // 50% to learner
      expect(parseFloat(payout.amount)).toBe(75); // 50% to mentor
    });

    it("should resolve dispute in favor of mentor (no refund)", async () => {
      const resolved = await DisputeService.resolveDispute(
        disputeId,
        adminId,
        "no_refund",
        "Service was delivered as agreed"
      );

      expect(resolved.status).toBe("resolved");

      // Verify no refund transaction created
      const refundResult = await testPool.query(
        "SELECT * FROM transactions WHERE type = 'refund' AND related_transaction_id = $1",
        [paymentId]
      );
      expect(refundResult.rows).toHaveLength(0);

      // Verify mentor payout processed
      const payoutResult = await testPool.query(
        "SELECT * FROM transactions WHERE type = 'mentor_payout' AND related_transaction_id = $1",
        [paymentId]
      );
      expect(payoutResult.rows).toHaveLength(1);
    });

    it("should prevent resolving already resolved dispute", async () => {
      await DisputeService.resolveDispute(
        disputeId,
        adminId,
        "full_refund",
        "First resolution"
      );

      await expect(
        DisputeService.resolveDispute(
          disputeId,
          adminId,
          "partial_refund",
          "Second resolution"
        )
      ).rejects.toThrow();
    });

    it("should record resolution timestamp", async () => {
      const beforeResolve = new Date();

      await DisputeService.resolveDispute(
        disputeId,
        adminId,
        "full_refund",
        "Resolution notes"
      );

      const disputeResult = await testPool.query(
        "SELECT resolved_at FROM disputes WHERE id = $1",
        [disputeId]
      );

      const resolvedAt = new Date(disputeResult.rows[0].resolved_at);
      expect(resolvedAt.getTime()).toBeGreaterThanOrEqual(beforeResolve.getTime());
    });
  });

  describe("Dispute with Escrow Integration", () => {
    let disputeId: string;
    let escrowId: string;

    beforeEach(async () => {
      // Create escrow record
      const escrowResult = await testPool.query(
        `INSERT INTO escrow_transactions (booking_id, learner_id, mentor_id, amount, currency, status, contract_address, escrow_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING escrow_id`,
        [
          bookingId,
          menteeId,
          mentorId,
          "150.0000000",
          "XLM",
          "held",
          "CABC123",
          "escrow-123",
        ]
      );
      escrowId = escrowResult.rows[0].escrow_id;

      const dispute = await DisputeService.openDispute(
        paymentId,
        menteeId,
        "Session quality issue with escrow"
      );
      disputeId = dispute.id;
    });

    it("should open dispute on Soroban escrow contract", async () => {
      mockSorobanEscrow.openDispute.mockResolvedValue({
        txHash: "soroban-dispute-tx",
        escrowId,
      } as any);

      await DisputeService.openEscrowDispute(disputeId, escrowId, menteeId);

      expect(mockSorobanEscrow.openDispute).toHaveBeenCalledWith({
        escrowId,
        raisedBy: menteeId,
        reason: expect.any(String),
      });
    });

    it("should resolve escrow dispute with custom split", async () => {
      mockSorobanEscrow.resolveDispute.mockResolvedValue({
        txHash: "soroban-resolve-tx",
        escrowId,
      } as any);

      await DisputeService.resolveDispute(
        disputeId,
        adminId,
        "custom_split",
        "60% to learner, 40% to mentor",
        { splitPercentage: 60 }
      );

      expect(mockSorobanEscrow.resolveDispute).toHaveBeenCalledWith({
        escrowId,
        splitPercentage: 60,
        resolvedBy: adminId,
      });
    });
  });

  describe("Dispute Notifications", () => {
    let disputeId: string;

    beforeEach(async () => {
      const dispute = await DisputeService.openDispute(
        paymentId,
        menteeId,
        "Session quality issue"
      );
      disputeId = dispute.id;
    });

    it("should notify both parties when dispute is created", async () => {
      // Verify notifications were created
      const notificationResult = await testPool.query(
        `SELECT * FROM notifications 
         WHERE user_id IN ($1, $2) 
         AND type = 'dispute_created'
         ORDER BY created_at DESC
         LIMIT 2`,
        [menteeId, mentorId]
      );

      expect(notificationResult.rows.length).toBeGreaterThanOrEqual(1);
    });

    it("should notify both parties when dispute is resolved", async () => {
      await DisputeService.resolveDispute(
        disputeId,
        adminId,
        "full_refund",
        "Resolution notes"
      );

      // Verify resolution notifications
      const notificationResult = await testPool.query(
        `SELECT * FROM notifications 
         WHERE user_id IN ($1, $2) 
         AND type = 'dispute_resolved'
         ORDER BY created_at DESC`,
        [menteeId, mentorId]
      );

      expect(notificationResult.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Complete Dispute Lifecycle", () => {
    it("should handle full dispute lifecycle from creation to resolution", async () => {
      const startTime = Date.now();

      // Step 1: Create dispute
      const dispute = await DisputeService.openDispute(
        paymentId,
        menteeId,
        "Complete lifecycle test"
      );
      expect(dispute.status).toBe("open");

      // Step 2: Submit evidence from learner
      await testPool.query(
        `INSERT INTO dispute_evidence (dispute_id, submitter_id, text_content)
         VALUES ($1, $2, $3)`,
        [dispute.id, menteeId, "Learner evidence"]
      );

      // Step 3: Submit counter-evidence from mentor
      await testPool.query(
        `INSERT INTO dispute_evidence (dispute_id, submitter_id, text_content)
         VALUES ($1, $2, $3)`,
        [dispute.id, mentorId, "Mentor counter-evidence"]
      );

      // Step 4: Admin reviews and resolves
      const resolved = await DisputeService.resolveDispute(
        dispute.id,
        adminId,
        "partial_refund",
        "Fair split based on evidence"
      );
      expect(resolved.status).toBe("resolved");

      // Step 5: Verify financial transactions
      const transactionResult = await testPool.query(
        `SELECT type, amount, status FROM transactions 
         WHERE related_transaction_id = $1`,
        [paymentId]
      );
      expect(transactionResult.rows.length).toBeGreaterThan(0);

      // Step 6: Verify all evidence is preserved
      const evidenceResult = await testPool.query(
        "SELECT COUNT(*) as count FROM dispute_evidence WHERE dispute_id = $1",
        [dispute.id]
      );
      expect(parseInt(evidenceResult.rows[0].count)).toBe(2);

      // Verify entire flow completed in reasonable time
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(10000); // Less than 10 seconds
    });
  });
});
