/**
 * Booking test factory.
 *
 * Schema reference: database/migrations/004_create_bookings.sql
 *
 * Creates a row in the `bookings` table.  Mentor and mentee users are created
 * automatically when not provided, so a single `createBooking()` call is
 * self-contained.
 */
import { faker } from "@faker-js/faker";
import { testPool } from "../setup/testDb";
import { createUser, createMentorUser, UserRecord } from "./user.factory";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type PaymentStatus =
  | "unpaid"
  | "paid"
  | "held_in_escrow"
  | "released"
  | "refunded"
  | "disputed";

export interface BookingRecord {
  id: string;
  mentee_id: string;
  mentor_id: string;
  title: string;
  description: string | null;
  session_type: string;
  scheduled_start: Date;
  scheduled_end: Date;
  duration_minutes: number;
  timezone: string | null;
  actual_start: Date | null;
  actual_end: Date | null;
  status: BookingStatus;
  payment_status: PaymentStatus;
  amount: string;
  currency: string;
  platform_fee: string;
  mentor_payout: string;
  payment_transaction_id: string | null;
  payout_transaction_id: string | null;
  escrow_transaction_id: string | null;
  meeting_url: string | null;
  meeting_id: string | null;
  meeting_password: string | null;
  cancelled_by: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  completed_at: Date | null;
  completion_notes: string | null;
  reminder_sent_mentee: boolean;
  reminder_sent_mentor: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface BookingOverrides {
  menteeId?: string;
  mentorId?: string;
  title?: string;
  description?: string | null;
  sessionType?: string;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  timezone?: string | null;
  status?: BookingStatus;
  paymentStatus?: PaymentStatus;
  amount?: number;
  currency?: string;
  platformFee?: number;
  mentorPayout?: number;
  meetingUrl?: string | null;
}

export interface BookingWithUsers {
  booking: BookingRecord;
  mentor: UserRecord;
  mentee: UserRecord;
}

export async function createBooking(
  overrides: BookingOverrides = {},
): Promise<BookingWithUsers> {
  // Auto-create mentor and mentee if IDs not supplied
  const mentor = overrides.mentorId
    ? await fetchUser(overrides.mentorId)
    : await createMentorUser();

  const mentee = overrides.menteeId
    ? await fetchUser(overrides.menteeId)
    : await createUser();

  const scheduledStart =
    overrides.scheduledStart ??
    faker.date.soon({ days: 7, refDate: new Date() });
  const scheduledEnd =
    overrides.scheduledEnd ??
    new Date(scheduledStart.getTime() + 60 * 60 * 1000); // +1 h

  const amount =
    overrides.amount ?? parseFloat(faker.finance.amount({ min: 20, max: 500 }));
  const platformFee =
    overrides.platformFee ?? parseFloat((amount * 0.05).toFixed(2));
  const mentorPayout =
    overrides.mentorPayout ?? parseFloat((amount - platformFee).toFixed(2));

  const { rows } = await testPool.query<BookingRecord>(
    `INSERT INTO bookings
       (mentee_id, mentor_id, title, description, session_type,
        scheduled_start, scheduled_end, timezone,
        status, payment_status,
        amount, currency, platform_fee, mentor_payout,
        meeting_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      mentee.id,
      mentor.id,
      overrides.title ?? faker.lorem.words({ min: 3, max: 7 }),
      overrides.description !== undefined
        ? overrides.description
        : faker.lorem.sentence(),
      overrides.sessionType ?? "video_call",
      scheduledStart,
      scheduledEnd,
      overrides.timezone !== undefined ? overrides.timezone : "UTC",
      overrides.status ?? "pending",
      overrides.paymentStatus ?? "unpaid",
      amount.toFixed(2),
      overrides.currency ?? "XLM",
      platformFee.toFixed(2),
      mentorPayout.toFixed(2),
      overrides.meetingUrl !== undefined
        ? overrides.meetingUrl
        : `https://meet.example.com/${faker.string.uuid()}`,
    ],
  );

  return { booking: rows[0], mentor, mentee };
}

/** Bulk-create bookings.  Each booking gets independent auto-created users. */
export async function createBookings(
  count: number,
  overrides: BookingOverrides = {},
): Promise<BookingWithUsers[]> {
  return Promise.all(
    Array.from({ length: count }, () => createBooking(overrides)),
  );
}

async function fetchUser(id: string): Promise<UserRecord> {
  const { rows } = await testPool.query<UserRecord>(
    "SELECT * FROM users WHERE id = $1",
    [id],
  );
  if (!rows[0]) throw new Error(`User not found: ${id}`);
  return rows[0];
}
