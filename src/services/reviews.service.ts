import { PoolClient } from "pg";
import pool from "../config/database";
import { createError } from "../middleware/errorHandler";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewRecord {
  id: string;
  booking_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  is_published: boolean;
  is_flagged: boolean;
  helpful_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface ReviewWithReviewer extends ReviewRecord {
  reviewer_display_name: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedReviews {
  reviews: ReviewWithReviewer[];
  pagination: PaginationMeta;
}

export interface CreateReviewPayload {
  session_id: string;
  rating: number;
  comment?: string;
}

export interface UpdateReviewPayload {
  rating?: number;
  comment?: string;
}

export interface RatingSummary {
  average_rating: number | null;
  total_reviews: number;
  rating_distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

export interface FlagRecord {
  id: string;
  review_id: string;
  reporter_id: string;
  reason: string;
  status: string;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Private helper
// ---------------------------------------------------------------------------

async function recalculateMentorRating(
  mentorId: string,
  client: PoolClient,
): Promise<void> {
  const { rows } = await client.query<{
    avg_rating: string | null;
    count: string;
  }>(
    `SELECT AVG(rating)::text AS avg_rating, COUNT(*)::text AS count
     FROM reviews
     WHERE reviewee_id = $1`,
    [mentorId],
  );

  const count = parseInt(rows[0].count, 10);
  const avgRating =
    count === 0
      ? null
      : Math.round(parseFloat(rows[0].avg_rating!) * 100) / 100;

  await client.query(
    `UPDATE users SET average_rating = $1, total_reviews = $2, updated_at = NOW() WHERE id = $3`,
    [avgRating, count, mentorId],
  );
}

// ---------------------------------------------------------------------------
// ReviewsService
// ---------------------------------------------------------------------------

export const ReviewsService = {
  // -------------------------------------------------------------------------
  // 2.1 createReview
  // -------------------------------------------------------------------------
  async createReview(
    reviewerId: string,
    payload: CreateReviewPayload,
  ): Promise<ReviewRecord> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Verify a completed booking exists where id = session_id and mentee_id = reviewerId
      const bookingResult = await client.query<{
        id: string;
        mentor_id: string;
      }>(
        `SELECT id, mentor_id FROM bookings
         WHERE id = $1 AND mentee_id = $2 AND status = 'completed'`,
        [payload.session_id, reviewerId],
      );

      if (bookingResult.rows.length === 0) {
        throw createError(
          "No completed booking found for this session and reviewer",
          403,
        );
      }

      const booking = bookingResult.rows[0];
      const mentorId = booking.mentor_id;

      // Check for existing review on same booking_id + reviewer_id
      const existingReview = await client.query(
        `SELECT id FROM reviews WHERE booking_id = $1 AND reviewer_id = $2`,
        [payload.session_id, reviewerId],
      );

      if (existingReview.rows.length > 0) {
        throw createError("A review already exists for this session", 409);
      }

      // Insert the review
      const insertResult = await client.query<ReviewRecord>(
        `INSERT INTO reviews (booking_id, reviewer_id, reviewee_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, booking_id, reviewer_id, reviewee_id, rating, comment,
                   is_published, is_flagged, helpful_count, created_at, updated_at`,
        [
          payload.session_id,
          reviewerId,
          mentorId,
          payload.rating,
          payload.comment ?? null,
        ],
      );

      const review = insertResult.rows[0];

      // Recalculate mentor rating within the same transaction
      await recalculateMentorRating(mentorId, client);

      await client.query("COMMIT");
      return review;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  // -------------------------------------------------------------------------
  // 2.4 getMentorReviews
  // -------------------------------------------------------------------------
  async getMentorReviews(
    mentorId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedReviews> {
    // Verify mentor exists
    const mentorCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [
      mentorId,
    ]);

    if (mentorCheck.rows.length === 0) {
      throw createError("Mentor not found", 404);
    }

    const offset = (page - 1) * limit;

    // Count total reviews for this mentor
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM reviews WHERE reviewee_id = $1`,
      [mentorId],
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Fetch paginated reviews joined with users for reviewer display name
    const reviewsResult = await pool.query<ReviewWithReviewer>(
      `SELECT r.id, r.booking_id, r.reviewer_id, r.reviewee_id, r.rating, r.comment,
              r.is_published, r.is_flagged, r.helpful_count, r.created_at, r.updated_at,
              (u.first_name || ' ' || u.last_name) AS reviewer_display_name
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.reviewee_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [mentorId, limit, offset],
    );

    const totalPages = Math.ceil(total / limit);

    return {
      reviews: reviewsResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  },

  // -------------------------------------------------------------------------
  // 2.6 updateReview
  // -------------------------------------------------------------------------
  async updateReview(
    reviewId: string,
    reviewerId: string,
    payload: UpdateReviewPayload,
  ): Promise<ReviewRecord> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Fetch review by ID
      const reviewResult = await client.query<ReviewRecord>(
        `SELECT id, booking_id, reviewer_id, reviewee_id, rating, comment,
                is_published, is_flagged, helpful_count, created_at, updated_at
         FROM reviews WHERE id = $1`,
        [reviewId],
      );

      if (reviewResult.rows.length === 0) {
        throw createError("Review not found", 404);
      }

      const review = reviewResult.rows[0];

      // Verify ownership
      if (review.reviewer_id !== reviewerId) {
        throw createError("You are not authorized to edit this review", 403);
      }

      // Check 48-hour edit window
      const createdAt = new Date(review.created_at);
      const now = new Date();
      const diffMs = now.getTime() - createdAt.getTime();
      const fortyEightHoursMs = 48 * 60 * 60 * 1000;

      if (diffMs > fortyEightHoursMs) {
        throw createError(
          "The edit window for this review has expired (48 hours)",
          403,
        );
      }

      // Build update fields
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (payload.rating !== undefined) {
        fields.push(`rating = $${idx++}`);
        values.push(payload.rating);
      }
      if (payload.comment !== undefined) {
        fields.push(`comment = $${idx++}`);
        values.push(payload.comment);
      }

      fields.push(`updated_at = NOW()`);
      values.push(reviewId);

      const updateResult = await client.query<ReviewRecord>(
        `UPDATE reviews SET ${fields.join(", ")} WHERE id = $${idx}
         RETURNING id, booking_id, reviewer_id, reviewee_id, rating, comment,
                   is_published, is_flagged, helpful_count, created_at, updated_at`,
        values,
      );

      const updatedReview = updateResult.rows[0];

      // Recalculate mentor rating if rating was updated
      if (payload.rating !== undefined) {
        await recalculateMentorRating(review.reviewee_id, client);
      }

      await client.query("COMMIT");
      return updatedReview;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  // -------------------------------------------------------------------------
  // 2.9 deleteReview
  // -------------------------------------------------------------------------
  async deleteReview(reviewId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Fetch review by ID
      const reviewResult = await client.query<{
        id: string;
        reviewee_id: string;
      }>(`SELECT id, reviewee_id FROM reviews WHERE id = $1`, [reviewId]);

      if (reviewResult.rows.length === 0) {
        throw createError("Review not found", 404);
      }

      const mentorId = reviewResult.rows[0].reviewee_id;

      // Delete the review
      await client.query(`DELETE FROM reviews WHERE id = $1`, [reviewId]);

      // Recalculate mentor rating within the same transaction
      await recalculateMentorRating(mentorId, client);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  // -------------------------------------------------------------------------
  // markHelpful (task 4.1 - included for completeness of the service shape)
  // -------------------------------------------------------------------------
  async markHelpful(
    reviewId: string,
    userId: string,
  ): Promise<{ helpful_count: number }> {
    const reviewResult = await pool.query<ReviewRecord>(
      `SELECT id, reviewer_id, helpful_count FROM reviews WHERE id = $1`,
      [reviewId],
    );

    if (reviewResult.rows.length === 0) {
      throw createError("Review not found", 404);
    }

    const review = reviewResult.rows[0];

    if (review.reviewer_id === userId) {
      throw createError("You cannot vote on your own review", 403);
    }

    try {
      await pool.query(
        `INSERT INTO review_votes (review_id, user_id, is_helpful) VALUES ($1, $2, true)`,
        [reviewId, userId],
      );
    } catch (err: any) {
      if (err.code === "23505") {
        throw createError("You have already voted on this review", 409);
      }
      throw err;
    }

    const updated = await pool.query<{ helpful_count: number }>(
      `UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = $1
       RETURNING helpful_count`,
      [reviewId],
    );

    return { helpful_count: updated.rows[0].helpful_count };
  },

  // -------------------------------------------------------------------------
  // flagReview (task 4.4)
  // -------------------------------------------------------------------------
  async flagReview(
    reviewId: string,
    userId: string,
    reason: string,
  ): Promise<FlagRecord> {
    const reviewResult = await pool.query(
      `SELECT id FROM reviews WHERE id = $1`,
      [reviewId],
    );

    if (reviewResult.rows.length === 0) {
      throw createError("Review not found", 404);
    }

    try {
      await pool.query(
        `INSERT INTO review_reports (review_id, reporter_id, reason) VALUES ($1, $2, $3)`,
        [reviewId, userId, reason],
      );
    } catch (err: any) {
      if (err.code === "23505") {
        throw createError("You have already flagged this review", 409);
      }
      throw err;
    }

    // Count total flags; auto-escalate at 5+
    const flagCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM review_reports WHERE review_id = $1`,
      [reviewId],
    );

    if (parseInt(flagCount.rows[0].count, 10) >= 5) {
      await pool.query(`UPDATE reviews SET is_flagged = true WHERE id = $1`, [
        reviewId,
      ]);
    }

    const flagResult = await pool.query<FlagRecord>(
      `SELECT id, review_id, reporter_id, reason, status, created_at
       FROM review_reports
       WHERE review_id = $1 AND reporter_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [reviewId, userId],
    );

    return flagResult.rows[0];
  },

  // -------------------------------------------------------------------------
  // getRatingSummary (task 4.7)
  // -------------------------------------------------------------------------
  async getRatingSummary(mentorId: string): Promise<RatingSummary> {
    const mentorCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [
      mentorId,
    ]);

    if (mentorCheck.rows.length === 0) {
      throw createError("Mentor not found", 404);
    }

    const result = await pool.query<{
      total: string;
      avg_rating: string | null;
      count_1: string;
      count_2: string;
      count_3: string;
      count_4: string;
      count_5: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         AVG(rating)::text AS avg_rating,
         COUNT(*) FILTER (WHERE rating = 1)::text AS count_1,
         COUNT(*) FILTER (WHERE rating = 2)::text AS count_2,
         COUNT(*) FILTER (WHERE rating = 3)::text AS count_3,
         COUNT(*) FILTER (WHERE rating = 4)::text AS count_4,
         COUNT(*) FILTER (WHERE rating = 5)::text AS count_5
       FROM reviews
       WHERE reviewee_id = $1`,
      [mentorId],
    );

    const row = result.rows[0];
    const total = parseInt(row.total, 10);
    const avgRating =
      total === 0 ? null : Math.round(parseFloat(row.avg_rating!) * 100) / 100;

    return {
      average_rating: avgRating,
      total_reviews: total,
      rating_distribution: {
        1: parseInt(row.count_1, 10),
        2: parseInt(row.count_2, 10),
        3: parseInt(row.count_3, 10),
        4: parseInt(row.count_4, 10),
        5: parseInt(row.count_5, 10),
      },
    };
  },

  // Expose recalculateMentorRating for use in tests
  recalculateMentorRating,
};
