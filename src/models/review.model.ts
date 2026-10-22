import { db } from "../config/database";

export interface Review {
  id: string;
  session_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
}

export interface CreateReviewData {
  bookingId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  title?: string;
  comment?: string | null;
}

export const ReviewModel = {
  async findByUserId(userId: string): Promise<Review[]> {
    const query =
      "SELECT * FROM reviews WHERE reviewer_id = $1 OR reviewee_id = $1 ORDER BY created_at DESC;";
    const { rows } = await db.query(query, [userId]);
    return rows;
  },

  /**
   * Bulk fetch reviews for multiple users.
   * A review can match as either reviewer_id or reviewee_id.
   */
  async findByUserIds(userIds: string[]): Promise<Review[]> {
    if (userIds.length === 0) return [];
    const query =
      "SELECT * FROM reviews WHERE reviewer_id = ANY($1) OR reviewee_id = ANY($1) ORDER BY created_at DESC;";
    const { rows } = await db.query(query, [userIds]);
    return rows;
  },

  /**
   * Reviews received by a mentor (reviewee side). Used for mentor rating
   * aggregation (issue #1286).
   */
  async findByMentorId(mentorId: string): Promise<Review[]> {
    const query =
      "SELECT * FROM reviews WHERE reviewee_id = $1 ORDER BY created_at DESC;";
    const { rows } = await db.query(query, [mentorId]);
    return rows;
  },

  async create(data: CreateReviewData): Promise<Review> {
    const query = `INSERT INTO reviews
      (booking_id, reviewer_id, reviewee_id, rating, title, comment, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *;`;
    const { rows } = await db.query(query, [
      data.bookingId,
      data.reviewerId,
      data.revieweeId,
      data.rating,
      data.title ?? null,
      data.comment ?? null,
    ]);
    return rows[0];
  },

  /**
   * Average rating for a mentor. PostgreSQL `AVG()` returns `numeric` as a
   * string via node-pg, so parse to float; `null` when no reviews exist.
   */
  async calculateAverageRating(mentorId: string): Promise<number | null> {
    const query = `SELECT AVG(rating) AS average FROM reviews WHERE reviewee_id = $1;`;
    const { rows } = await db.query(query, [mentorId]);
    const raw = rows[0]?.average;
    if (raw === null || raw === undefined) return null;
    const parsed = typeof raw === "string" ? parseFloat(raw) : Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  },
};
