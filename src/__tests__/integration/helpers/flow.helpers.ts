/**
 * Shared helpers for end-to-end integration tests.
 */
import { AuthService } from "../../../services/auth.service";
import { MentorsService } from "../../../services/mentors.service";
import { SearchService } from "../../../services/search.service";
import { BookingsService } from "../../../services/bookings.service";
import { PaymentsService } from "../../../services/payments.service";
import { EscrowApiService } from "../../../services/escrow-api.service";
import { testPool } from "../../setup/testDb";

export interface RegisteredUser {
  userId: string;
  token: string;
  email: string;
}

export async function registerUser(input: {
  role: "mentor" | "mentee";
  email?: string;
}): Promise<RegisteredUser> {
  const email =
    input.email ??
    `${input.role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;

  const result = await AuthService.register({
    email,
    password: "TestPassword123!",
    firstName: "Test",
    lastName: input.role === "mentor" ? "Mentor" : "Mentee",
    role: input.role,
  });

  return {
    userId: result.userId,
    token: result.accessToken,
    email,
  };
}

export async function createMentorProfile(userId: string): Promise<void> {
  const profile = await MentorsService.createProfile(userId, {
    bio: "Experienced JavaScript mentor",
    hourlyRate: 50,
    expertise: ["JavaScript", "TypeScript", "Node.js"],
    yearsOfExperience: 5,
    timezone: "UTC",
  });

  if (!profile) {
    throw new Error("Failed to create mentor profile");
  }
}

export async function searchMentors(
  _token: string,
  filters: { skill?: string } = {},
) {
  return SearchService.searchMentors({
    query: filters.skill ?? "",
    skills: filters.skill,
    page: 1,
    limit: 10,
  });
}

export async function createBooking(
  menteeId: string,
  mentorId: string,
  topic = "JavaScript mentoring session",
) {
  const scheduledAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const booking = await BookingsService.createBooking({
    menteeId,
    mentorId,
    scheduledAt,
    durationMinutes: 60,
    topic,
  });

  await testPool.query(
    `UPDATE bookings SET status = 'confirmed', payment_status = 'pending' WHERE id = $1`,
    [booking.id],
  );

  return { ...booking, status: "confirmed" as const };
}

export async function initiatePayment(
  userId: string,
  bookingId: string,
  amount: string,
) {
  return PaymentsService.initiatePayment({
    userId,
    bookingId,
    amount,
    currency: "XLM",
    description: "Mentoring session payment",
  });
}

export async function confirmPayment(
  paymentId: string,
  userId: string,
  txHash: string,
) {
  return PaymentsService.confirmPayment(paymentId, userId, txHash);
}

export async function completeSession(mentorId: string, bookingId: string) {
  await testPool.query(
    `UPDATE bookings
     SET scheduled_at = NOW() - INTERVAL '2 hours',
         duration_minutes = 60
     WHERE id = $1`,
    [bookingId],
  );

  return BookingsService.completeBooking(bookingId, mentorId);
}

export async function releaseEscrow(escrowId: string, userId: string) {
  return EscrowApiService.releaseEscrow(escrowId, userId);
}
