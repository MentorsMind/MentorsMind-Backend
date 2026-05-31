/**
 * Comprehensive integration tests covering the full mentoring journey:
 * registration → mentor profile → search → booking → payment → session → escrow release.
 */
import { testPool } from "../setup/testDb";
import { stellarService } from "../../services/stellar.service";
import { SorobanEscrowService } from "../../services/sorobanEscrow.service";
import { EscrowModel } from "../../models/escrow.model";
import {
  registerUser,
  createMentorProfile,
  searchMentors,
  createBooking,
  initiatePayment,
  confirmPayment,
  completeSession,
  releaseEscrow,
} from "./helpers/flow.helpers";
import { createBooking as createBookingFactory } from "../factories/booking.factory";
import { createPayment } from "../factories/payment.factory";

jest.mock("../../services/stellar.service");
jest.mock("../../services/socket.service");
jest.mock("../../services/sorobanEscrow.service", () => ({
  SorobanEscrowService: {
    isConfigured: jest.fn().mockReturnValue(false),
    createEscrow: jest.fn(),
    releaseFunds: jest.fn(),
    startPendingEscrowMonitoring: jest.fn(),
  },
}));

const mockStellarService = stellarService as jest.Mocked<typeof stellarService>;

describe("Complete Mentoring Flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should complete full booking and payment flow", async () => {
    const mentor = await registerUser({ role: "mentor" });
    const mentee = await registerUser({ role: "mentee" });

    await createMentorProfile(mentor.userId);

    const results = await searchMentors(mentee.token, { skill: "JavaScript" });
    expect(results.mentors.length).toBeGreaterThan(0);

    const foundMentor = results.mentors.find((m) => m.id === mentor.userId);
    expect(foundMentor).toBeDefined();

    const booking = await createBooking(mentee.userId, mentor.userId);
    expect(booking.mentee_id).toBe(mentee.userId);
    expect(booking.mentor_id).toBe(mentor.userId);

    const payment = await initiatePayment(
      mentee.userId,
      booking.id,
      booking.amount,
    );
    expect(payment.status).toBe("pending");

    const txHash = "integration-tx-hash-complete-flow";
    mockStellarService.getTransaction.mockResolvedValue({
      successful: true,
      hash: txHash,
      source_account: "GABC123",
    } as any);
    mockStellarService.getTransactionOperations.mockResolvedValue([
      { type: "payment", amount: booking.amount },
    ] as any);

    const confirmed = await confirmPayment(payment.id, mentee.userId, txHash);
    expect(confirmed.status).toBe("completed");

    const escrow = await EscrowModel.create({
      learnerId: mentee.userId,
      mentorId: mentor.userId,
      amount: booking.amount,
      currency: "XLM",
      description: booking.topic,
    });
    await EscrowModel.updateStatus(escrow.id, "funded");

    const completed = await completeSession(mentor.userId, booking.id);
    expect(completed.status).toBe("completed");

    const release = await releaseEscrow(escrow.id, mentee.userId);
    expect(release.status).toBe("released");
  });
});

describe("Payment Flow Integration", () => {
  it("should initiate, confirm, and refund a payment end-to-end", async () => {
    const { booking, mentee } = await createBookingFactory({
      paymentStatus: "unpaid",
      status: "pending",
    });

    const payment = await initiatePayment(
      mentee.id,
      booking.id,
      booking.amount,
    );
    expect(payment.booking_id).toBe(booking.id);

    const txHash = "integration-refund-flow-tx";
    mockStellarService.getTransaction.mockResolvedValue({
      successful: true,
      hash: txHash,
      source_account: "GABC123",
    } as any);
    mockStellarService.getTransactionOperations.mockResolvedValue([
      { type: "payment", amount: booking.amount },
    ] as any);

    await confirmPayment(payment.id, mentee.id, txHash);

    const refunded = await (
      await import("../../services/payments.service")
    ).PaymentsService.refundPayment(payment.id, mentee.id, "Integration test refund");

    expect(refunded.status).toBe("refunded");

    const bookingRow = await testPool.query(
      "SELECT payment_status FROM bookings WHERE id = $1",
      [booking.id],
    );
    expect(bookingRow.rows[0].payment_status).toBe("refunded");
  });
});

describe("Database Integration", () => {
  it("should persist booking and payment records via factories", async () => {
    const { booking, mentor, mentee } = await createBookingFactory();
    const { payment } = await createPayment({
      userId: mentee.id,
      amount: parseFloat(booking.amount),
      status: "completed",
    });

    const bookingRow = await testPool.query(
      "SELECT * FROM bookings WHERE id = $1",
      [booking.id],
    );
    const paymentRow = await testPool.query(
      "SELECT * FROM transactions WHERE id = $1",
      [payment.id],
    );

    expect(bookingRow.rows[0].mentor_id).toBe(mentor.id);
    expect(bookingRow.rows[0].mentee_id).toBe(mentee.id);
    expect(paymentRow.rows[0].user_id).toBe(mentee.id);
  });
});

describe("Blockchain Interaction (mocked)", () => {
  it("should skip on-chain calls when Soroban is not configured", async () => {
    expect(SorobanEscrowService.isConfigured()).toBe(false);

    const mentor = await registerUser({ role: "mentor" });
    const mentee = await registerUser({ role: "mentee" });
    const booking = await createBooking(mentee.userId, mentor.userId);

    const payment = await initiatePayment(
      mentee.userId,
      booking.id,
      booking.amount,
    );

    expect(payment).toBeDefined();
    expect(SorobanEscrowService.createEscrow).not.toHaveBeenCalled();
  });
});
