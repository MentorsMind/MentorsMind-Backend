/**
 * Review test factory.
 *
 * Schema reference: database/migrations/005_create_reviews.sql
 *
 * Creates a row in the `reviews` table.  The constraint
 *   UNIQUE(booking_id, reviewer_id)
 * means each booking can have at most one review per reviewer.
 *
 * A full dependency chain (mentee → mentor → booking → review) is created
 * automatically when not supplied, so a bare `createReview()` is self-contained.
 */
import { faker } from "@faker-js/faker";
import { testPool } from "../setup/testDb";
import { UserRecord } from "./user.factory";
import { createBooking, BookingRecord } from "./booking.factory";

export interface ReviewRecord {
  id: string;
  booking_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  communication_rating: number | null;
  professionalism_rating: number | null;
  knowledge_rating: number | null;
  punctuality_rating: number | null;
  is_published: boolean;
  is_flagged: boolean;
  flagged_reason: string | null;
  moderated_by: string | null;
  moderated_at: Date | null;
  response: string | null;
  response_at: Date | null;
  helpful_count: number;
  not_helpful_count: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ReviewOverrides {
  bookingId?: string;
  reviewerId?: string;
  revieweeId?: string;
  rating?: number; // 1–5
  title?: string | null;
  comment?: string | null;
  communicationRating?: number | null;
  professionalismRating?: number | null;
  knowledgeRating?: number | null;
  punctualityRating?: number | null;
  isPublished?: boolean;
  isFlagged?: boolean;
}

export interface ReviewWithContext {
  review: ReviewRecord;
  booking: BookingRecord;
  reviewer: UserRecord;
  reviewee: UserRecord;
}

function randomRating(): number {
  return faker.number.int({ min: 1, max: 5 });
}

function maybeRating(): number | null {
  return faker.datatype.boolean() ? randomRating() : null;
}

export async function createReview(
  overrides: ReviewOverrides = {},
): Promise<ReviewWithContext> {
  // Build a complete booking + users if not supplied
  let booking: BookingRecord;
  let reviewer: UserRecord;
  let reviewee: UserRecord;

  if (overrides.bookingId && overrides.reviewerId && overrides.revieweeId) {
    booking = await fetchBooking(overrides.bookingId);
    reviewer = await fetchUser(overrides.reviewerId);
    reviewee = await fetchUser(overrides.revieweeId);
  } else {
    // Auto-create a completed booking so the review FK constraint is satisfied
    const ctx = await createBooking({
      status: "completed",
      paymentStatus: "released",
    });
    booking = ctx.booking;
    reviewer = ctx.mentee; // mentee reviews mentor by default
    reviewee = ctx.mentor;
  }

  const { rows } = await testPool.query<ReviewRecord>(
    `INSERT INTO reviews
       (booking_id, reviewer_id, reviewee_id,
        rating, title, comment,
        communication_rating, professionalism_rating, knowledge_rating, punctuality_rating,
        is_published, is_flagged)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      overrides.bookingId ?? booking.id,
      overrides.reviewerId ?? reviewer.id,
      overrides.revieweeId ?? reviewee.id,
      overrides.rating ?? randomRating(),
      overrides.title !== undefined
        ? overrides.title
        : faker.lorem.sentence({ min: 4, max: 10 }),
      overrides.comment !== undefined
        ? overrides.comment
        : faker.lorem.paragraph({ min: 1, max: 3 }),
      overrides.communicationRating !== undefined
        ? overrides.communicationRating
        : maybeRating(),
      overrides.professionalismRating !== undefined
        ? overrides.professionalismRating
        : maybeRating(),
      overrides.knowledgeRating !== undefined
        ? overrides.knowledgeRating
        : maybeRating(),
      overrides.punctualityRating !== undefined
        ? overrides.punctualityRating
        : maybeRating(),
      overrides.isPublished ?? true,
      overrides.isFlagged ?? false,
    ],
  );

  return { review: rows[0], booking, reviewer, reviewee };
}

/** Bulk-create reviews, each with independently auto-created contexts. */
export async function createReviews(
  count: number,
  overrides: ReviewOverrides = {},
): Promise<ReviewWithContext[]> {
  return Promise.all(
    Array.from({ length: count }, () => createReview(overrides)),
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

async function fetchBooking(id: string): Promise<BookingRecord> {
  const { rows } = await testPool.query<BookingRecord>(
    "SELECT * FROM bookings WHERE id = $1",
    [id],
  );
  if (!rows[0]) throw new Error(`Booking not found: ${id}`);
  return rows[0];
}
