import { PoolClient } from "pg";
import pool from "../config/database";
import { createError } from "../middleware/errorHandler";
import { env } from "../config/env";
import { UsersService } from "./users.service";
import { InAppNotificationService } from "./inAppNotification.service";
import { emailService } from "./email.service";
import { ModerationService } from "./moderation.service";

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
  mentor_response?: MentorResponseRecord | null;
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
  mentor_response: {
    response_count: number;
    latest_response_at: Date | null;
  };
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

export interface MentorResponseRecord {
  id: string;
  review_id: string;
  mentor_id: string;
  response_text: string;
  is_published: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ReviewRowWithMentorResponse extends ReviewRecord {
  reviewer_display_name: string;
  response_id?: string | null;
  response_mentor_id?: string | null;
  response_text?: string | null;
  response_is_published?: boolean | null;
  response_created_at?: Date | string | null;
  response_updated_at?: Date | string | null;
}

function toDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return new Date(value ?? Date.now());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mapMentorResponse(
  row: Pick<
    ReviewRowWithMentorResponse,
    | "id"
    | "response_id"
    | "response_mentor_id"
    | "response_text"
    | "response_is_published"
    | "response_created_at"
    | "response_updated_at"
  >,
): MentorResponseRecord | null {
  if (!row.response_id || !row.response_text || !row.response_mentor_id) {
    return null;
  }

  return {
    id: row.response_id,
    review_id: row.id,
    mentor_id: row.response_mentor_id,
    response_text: row.response_text,
    is_published: row.response_is_published ?? true,
    created_at: toDate(row.response_created_at),
    updated_at: toDate(row.response_updated_at),
  };
}

function mapReviewRow(row: ReviewRowWithMentorResponse): ReviewWithReviewer {
  return {
    id: row.id,
    booking_id: row.booking_id,
    reviewer_id: row.reviewer_id,
    reviewee_id: row.reviewee_id,
    rating: row.rating,
    comment: row.comment,
    is_published: row.is_published,
    is_flagged: row.is_flagged,
    helpful_count: row.helpful_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewer_display_name: row.reviewer_display_name,
    mentor_response: mapMentorResponse(row),
  };
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

async function notifyReviewerAboutMentorResponse(
  review: Pick<ReviewRecord, "id" | "reviewer_id" | "reviewee_id">,
  response: MentorResponseRecord,
): Promise<void> {
  const [reviewer, mentor] = await Promise.all([
    UsersService.findById(review.reviewer_id),
    UsersService.findById(review.reviewee_id),
  ]);

  if (!reviewer?.email) {
    return;
  }

  const mentorName = mentor
    ? `${mentor.first_name} ${mentor.last_name}`.trim()
    : "your mentor";
  const subject = `${mentorName} responded to your review`;
  const actionUrl = `${env.APP_CLIENT_URL}/mentors/${review.reviewee_id}`;
  const reviewUrl = `${actionUrl}#review-${review.id}`;
  const safeMentorName = escapeHtml(mentorName);
  const safeSubject = escapeHtml(subject);
  const safeResponseText = escapeHtml(response.response_text);

  const notificationPayload = {
    userId: review.reviewer_id,
    type: "review_response" as const,
    title: subject,
    message: `${mentorName} replied to your review.`,
    data: {
      review_id: review.id,
      mentor_id: review.reviewee_id,
      response_id: response.id,
      response_text: response.response_text,
    },
    actionUrl,
  };

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2 style="margin: 0 0 16px;">${safeSubject}</h2>
      <p>${safeMentorName} replied to your review:</p>
      <blockquote style="border-left: 4px solid #d1d5db; margin: 16px 0; padding: 12px 16px; background: #f9fafb;">
        ${safeResponseText}
      </blockquote>
      <p><a href="${reviewUrl}">View the review discussion</a></p>
    </div>
  `;

  const textContent = [
    subject,
    "",
    `${mentorName} replied to your review:`,
    response.response_text,
    "",
    `View the review discussion: ${reviewUrl}`,
  ].join("\n");

  await Promise.allSettled([
    InAppNotificationService.create(notificationPayload),
    emailService.sendEmail({
      to: [reviewer.email],
      subject,
      htmlContent,
      textContent,
    }),
  ]);
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
    params: {
      page?: number;
      limit?: number;
      cursor?: string;
    },
  ): Promise<
    PaginatedReviews & { next_cursor?: string | null; has_more?: boolean }
  > {
    // Verify mentor exists
    const mentorCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [
      mentorId,
    ]);

    if (mentorCheck.rows.length === 0) {
      throw createError("Mentor not found", 404);
    }

    const limit = params.limit ?? 10;
    const page = params.page ?? 1;

    // Count total reviews for this mentor (optional for cursor perf, but kept for backward compatibility)
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM reviews WHERE reviewee_id = $1`,
      [mentorId],
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Cursor-based (seek) pagination
    if (params.cursor) {
      const decoded =
        require("../utils/pagination.utils").PaginationUtil.decodeCursor(
          params.cursor,
        );
      // decoded: { id, created_at }
      if (!decoded) {
        throw createError("Invalid cursor", 400);
      }

      const { rows } = await pool.query<ReviewRowWithMentorResponse>(
        `SELECT r.id, r.booking_id, r.reviewer_id, r.reviewee_id, r.rating, r.comment,
                r.is_published, r.is_flagged, r.helpful_count, r.created_at, r.updated_at,
                (u.first_name || ' ' || u.last_name) AS reviewer_display_name,
                rr.id AS response_id,
                rr.mentor_id AS response_mentor_id,
                rr.response_text AS response_text,
                rr.is_published AS response_is_published,
                rr.created_at AS response_created_at,
                rr.updated_at AS response_updated_at
         FROM reviews r
         JOIN users u ON r.reviewer_id = u.id
         LEFT JOIN review_responses rr
           ON rr.review_id = r.id
          AND rr.is_published = TRUE
         WHERE r.reviewee_id = $1
           AND (r.created_at, r.id) < ($2, $3)
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT $4`,
        [mentorId, decoded.created_at, decoded.id, limit + 1],
      );

      const has_more = rows.length > limit;
      const data = (has_more ? rows.slice(0, limit) : rows).map(mapReviewRow);

      const lastItem = data[data.length - 1];
      const next_cursor =
        has_more && lastItem
          ? require("../utils/pagination.utils").PaginationUtil.encodeCursor({
              id: lastItem.id,
              created_at: lastItem.created_at.toISOString(),
            })
          : null;

      return {
        reviews: data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: has_more,
          hasPrev: false,
        },
        next_cursor,
        has_more,
      };
    }

    // Offset-based fallback when cursor is absent
    const offset = (page - 1) * limit;

    const reviewsResult = await pool.query<ReviewRowWithMentorResponse>(
      `SELECT r.id, r.booking_id, r.reviewer_id, r.reviewee_id, r.rating, r.comment,
              r.is_published, r.is_flagged, r.helpful_count, r.created_at, r.updated_at,
              (u.first_name || ' ' || u.last_name) AS reviewer_display_name,
              rr.id AS response_id,
              rr.mentor_id AS response_mentor_id,
              rr.response_text AS response_text,
              rr.is_published AS response_is_published,
              rr.created_at AS response_created_at,
              rr.updated_at AS response_updated_at
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       LEFT JOIN review_responses rr
         ON rr.review_id = r.id
        AND rr.is_published = TRUE
       WHERE r.reviewee_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [mentorId, limit, offset],
    );

    const totalPages = Math.ceil(total / limit);

    return {
      reviews: reviewsResult.rows.map(mapReviewRow),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      next_cursor: null,
      has_more: page < totalPages,
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
  // Mentor response
  // -------------------------------------------------------------------------
  async createMentorResponse(
    reviewId: string,
    mentorId: string,
    responseText: string,
  ): Promise<MentorResponseRecord> {
    const trimmedResponse = responseText.trim();
    if (!trimmedResponse) {
      throw createError("Response text is required", 400);
    }
    if (trimmedResponse.length > 1000) {
      throw createError("Response text must not exceed 1000 characters", 400);
    }

    const client = await pool.connect();
    let response: MentorResponseRecord | null = null;
    let review: Pick<ReviewRecord, "id" | "reviewer_id" | "reviewee_id"> | null =
      null;

    try {
      await client.query("BEGIN");

      const reviewResult = await client.query<Pick<
        ReviewRecord,
        "id" | "reviewer_id" | "reviewee_id"
      >>(
        `SELECT id, reviewer_id, reviewee_id
         FROM reviews
         WHERE id = $1`,
        [reviewId],
      );

      if (reviewResult.rows.length === 0) {
        throw createError("Review not found", 404);
      }

      review = reviewResult.rows[0];

      if (review.reviewee_id !== mentorId) {
        throw createError("You are not authorized to respond to this review", 403);
      }

      const moderationResult = await ModerationService.screenContent(
        reviewId,
        "review",
        trimmedResponse,
      );

      const upsertResult = await client.query<MentorResponseRecord>(
        `INSERT INTO review_responses (
           review_id,
           mentor_id,
           response_text,
           is_published
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (review_id)
         DO UPDATE SET
           mentor_id = EXCLUDED.mentor_id,
           response_text = EXCLUDED.response_text,
           is_published = EXCLUDED.is_published,
           updated_at = NOW()
         RETURNING id, review_id, mentor_id, response_text, is_published, created_at, updated_at`,
        [reviewId, mentorId, trimmedResponse, moderationResult.action !== "block"],
      );

      response = upsertResult.rows[0];

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    if (response && review && response.is_published) {
      await notifyReviewerAboutMentorResponse(review, response);
    }

    if (!response) {
      throw createError("Failed to create review response", 500);
    }

    return response;
  },

  async deleteMentorResponse(
    reviewId: string,
    mentorId: string,
  ): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const reviewResult = await client.query<Pick<
        ReviewRecord,
        "id" | "reviewee_id"
      >>(
        `SELECT id, reviewee_id
         FROM reviews
         WHERE id = $1`,
        [reviewId],
      );

      if (reviewResult.rows.length === 0) {
        throw createError("Review not found", 404);
      }

      if (reviewResult.rows[0].reviewee_id !== mentorId) {
        throw createError("You are not authorized to delete this response", 403);
      }

      const deleteResult = await client.query(
        `DELETE FROM review_responses
         WHERE review_id = $1 AND mentor_id = $2`,
        [reviewId, mentorId],
      );

      if ((deleteResult.rowCount ?? 0) === 0) {
        throw createError("Review response not found", 404);
      }

      await client.query("COMMIT");
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

    const responseSummary = await pool.query<{
      response_count: string;
      latest_response_at: Date | string | null;
    }>(
      `SELECT
         COUNT(*)::text AS response_count,
         MAX(created_at) AS latest_response_at
       FROM review_responses
       WHERE mentor_id = $1
         AND is_published = TRUE`,
      [mentorId],
    );

    const responseRow = responseSummary.rows[0];

    return {
      average_rating: avgRating,
      total_reviews: total,
      mentor_response: {
        response_count: parseInt(responseRow.response_count, 10),
        latest_response_at: responseRow.latest_response_at
          ? toDate(responseRow.latest_response_at)
          : null,
      },
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
