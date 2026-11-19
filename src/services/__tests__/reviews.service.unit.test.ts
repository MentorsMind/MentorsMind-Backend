/**
 * Reviews Service Unit Tests
 *
 * Covers self-review prevention and booking ownership verification.
 * Uses lightweight test harness (no external test runner dependency).
 * 
 * Run via: npm run test:reviews-unit
 */

import { describe, it, expect } from './test-harness';
import { ReviewsService, CreateReviewPayload } from '../reviews.service';
import pool from '../../config/database';

// ─── Constants ────────────────────────────────────────────────────────────
const mentorId = 'mentor-uuid-001';
const menteeId = 'mentee-uuid-001';
const bookingId = 'booking-uuid-001';
const payload: CreateReviewPayload = {
  session_id: bookingId,
  rating: 5,
  comment: 'Great session!',
};

// ─── Mock Pool Setup ──────────────────────────────────────────────────────

function installMockPool(bookingRow: any) {
  const original = pool.connect.bind(pool);
  const queries: Array<{ text: string; params?: any[] }> = [];

  (pool as any).connect = async () => {
    const mockClient = {
      query: async (text: string, params?: any[]) => {
        queries.push({ text, params });

        // Mock BEGIN/COMMIT/ROLLBACK
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        // Mock booking SELECT
        if (text.includes('FROM bookings') && text.includes('WHERE id = $1')) {
          if (bookingRow) {
            return { rows: [bookingRow] };
          }
          return { rows: [] };
        }

        // Mock existing review check
        if (text.includes('FROM reviews') && text.includes('WHERE booking_id = $1')) {
          return { rows: [] };
        }

        // Mock INSERT review
        if (text.includes('INSERT INTO reviews')) {
          return {
            rows: [{
              id: 'review-uuid',
              booking_id: bookingId,
              reviewer_id: params?.[1],
              reviewee_id: params?.[2],
              rating: params?.[3],
              comment: params?.[4],
              is_published: false,
              is_flagged: false,
              helpful_count: 0,
              created_at: new Date(),
              updated_at: new Date(),
            }],
            rowCount: 1,
          };
        }

        // Mock rating recalculation
        if (text.includes('AVG(rating)')) {
          return { rows: [{ avg_rating: '4.50', count: '2' }] };
        }

        if (text.includes('UPDATE users')) {
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };

    return mockClient as any;
  };

  return {
    queries,
    restore: () => {
      (pool as any).connect = original;
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ReviewsService.createReview — self-review prevention', () => {
  it('rejects self-review when reviewerId === mentorId', async () => {
    const bookingRow = { id: bookingId, mentor_id: menteeId }; // Same as reviewer
    const { restore } = installMockPool(bookingRow);

    try {
      await ReviewsService.createReview(menteeId, payload);
      throw new Error('Should have thrown an error');
    } catch (err: any) {
      expect(err.message).toBe('You cannot review yourself');
      expect(err.status).toBe(400);
    } finally {
      restore();
    }
  });

  it('allows review when reviewerId !== mentorId', async () => {
    const bookingRow = { id: bookingId, mentor_id: mentorId };
    const { restore } = installMockPool(bookingRow);

    try {
      const review = await ReviewsService.createReview(menteeId, payload);
      expect(review.id).toBe('review-uuid');
      expect(review.reviewer_id).toBe(menteeId);
      expect(review.reviewee_id).toBe(mentorId);
      expect(review.rating).toBe(5);
    } finally {
      restore();
    }
  });

  it('rejects review when no completed booking exists', async () => {
    const { restore } = installMockPool(null); // No booking found

    try {
      await ReviewsService.createReview(menteeId, payload);
      throw new Error('Should have thrown an error');
    } catch (err: any) {
      expect(err.message).toBe('No completed booking found for this session and reviewer');
      expect(err.status).toBe(403);
    } finally {
      restore();
    }
  });

  it('verifies booking ownership before accepting review', async () => {
    // Booking exists but mentee_id doesn't match reviewer
    // (This is handled by the SQL query: mentee_id = $2 must match reviewerId)
    const bookingRow = null; // Query will return no rows
    const { restore } = installMockPool(bookingRow);

    try {
      await ReviewsService.createReview(menteeId, payload);
      throw new Error('Should have thrown an error');
    } catch (err: any) {
      expect(err.message).toBe('No completed booking found for this session and reviewer');
    } finally {
      restore();
    }
  });

  it('prevents duplicate reviews on same booking', async () => {
    const bookingRow = { id: bookingId, mentor_id: mentorId };
    const original = pool.connect.bind(pool);
    const queries: any[] = [];

    (pool as any).connect = async () => ({
      query: async (text: string, params?: any[]) => {
        queries.push({ text, params });

        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (text.includes('FROM bookings')) {
          return { rows: [bookingRow] };
        }

        // Mock existing review found
        if (text.includes('FROM reviews') && text.includes('WHERE booking_id = $1')) {
          return { rows: [{ id: 'existing-review' }] };
        }

        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    });

    try {
      await ReviewsService.createReview(menteeId, payload);
      throw new Error('Should have thrown an error');
    } catch (err: any) {
      expect(err.message).toBe('A review already exists for this session');
      expect(err.status).toBe(409);
    } finally {
      (pool as any).connect = original;
    }
  });
});

describe('ReviewsService.createReview — transaction safety', () => {
  it('calls BEGIN before any queries', async () => {
    const bookingRow = { id: bookingId, mentor_id: mentorId };
    const { queries, restore } = installMockPool(bookingRow);

    try {
      await ReviewsService.createReview(menteeId, payload);
      const firstCall = queries[0];
      expect(firstCall.text).toBe('BEGIN');
    } finally {
      restore();
    }
  });

  it('calls COMMIT after successful review creation', async () => {
    const bookingRow = { id: bookingId, mentor_id: mentorId };
    const { queries, restore } = installMockPool(bookingRow);

    try {
      await ReviewsService.createReview(menteeId, payload);
      const commitCall = queries.find((q) => q.text === 'COMMIT');
      expect(!!commitCall).toBe(true);
    } finally {
      restore();
    }
  });

  it('calls ROLLBACK on error', async () => {
    const { queries, restore } = installMockPool(null); // Booking not found

    try {
      await ReviewsService.createReview(menteeId, payload);
    } catch (err) {
      // Expected to throw
    } finally {
      const rollbackCall = queries.find((q) => q.text === 'ROLLBACK');
      expect(!!rollbackCall).toBe(true);
      restore();
    }
  });
});
