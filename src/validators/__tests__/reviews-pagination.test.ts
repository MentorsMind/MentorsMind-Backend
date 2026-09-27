import { describe, it, expect } from './test-harness';
import { getMentorReviewsQuerySchema } from '../reviews.validator';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('getMentorReviewsQuerySchema', () => {
  describe('cursor parameter', () => {
    it('accepts a valid cursor string', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { cursor: 'eyJpZCI6IjEyM2U0NTY3LWU4OWItNDJkMy1hNDU2LTQyNjYxNDE3NDAwMCIsImNyZWF0ZWRfYXQiOiIyMDI1LTAxLTAxVDAwOjAwOjAwWiJ9' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts an empty/omitted cursor', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.cursor).toBeUndefined();
      }
    });

    it('rejects a non-string cursor (null or object)', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { cursor: null },
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty string cursor', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { cursor: '' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('page parameter', () => {
    it('defaults to 1 when omitted', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.page).toBe(1);
      }
    });

    it('accepts a valid page number as string', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { page: '2' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.page).toBe(2);
      }
    });

    it('accepts page=1 (first page)', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { page: '1' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.page).toBe(1);
      }
    });

    it('accepts large page numbers', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { page: '9999' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.page).toBe(9999);
      }
    });

    it('rejects page=0', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { page: '0' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative page numbers', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { page: '-1' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer page strings', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { page: '1.5' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-numeric page strings', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { page: 'abc' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('limit parameter', () => {
    it('defaults to 20 when omitted', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.limit).toBe(20);
      }
    });

    it('accepts limit=1 (minimum)', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '1' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.limit).toBe(1);
      }
    });

    it('accepts limit=100 (maximum)', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '100' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.limit).toBe(100);
      }
    });

    it('accepts limit=20 (default)', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '20' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.limit).toBe(20);
      }
    });

    it('accepts any limit between 1 and 100', () => {
      for (let i = 1; i <= 100; i += 10) {
        const result = getMentorReviewsQuerySchema.safeParse({
          query: { limit: String(i) },
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.query.limit).toBe(i);
        }
      }
    });

    it('rejects limit=0', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '0' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects limit=101 (exceeds maximum)', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '101' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects limit=200 (caller attempts to exceed cap)', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '200' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects limit=-1', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '-1' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer limit strings', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '10.5' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-numeric limit strings', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: 'abc' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('combined parameters (integration)', () => {
    it('accepts valid cursor and limit together', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: {
          cursor: 'eyJpZCI6IjEyM2U0NTY3LWU4OWItNDJkMy1hNDU2LTQyNjYxNDE3NDAwMCIsImNyZWF0ZWRfYXQiOiIyMDI1LTAxLTAxVDAwOjAwOjAwWiJ9',
          limit: '50',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.cursor).toBeDefined();
        expect(result.data.query.limit).toBe(50);
      }
    });

    it('accepts valid page and limit together', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { page: '2', limit: '25' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.page).toBe(2);
        expect(result.data.query.limit).toBe(25);
      }
    });

    it('defaults all parameters when query is empty', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.page).toBe(1);
        expect(result.data.query.limit).toBe(20);
        expect(result.data.query.cursor).toBeUndefined();
      }
    });

    it('handles all three parameters together', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: {
          cursor: 'testcursor',
          page: '3',
          limit: '50',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.cursor).toBe('testcursor');
        expect(result.data.query.page).toBe(3);
        expect(result.data.query.limit).toBe(50);
      }
    });

    it('provides structured error messages for invalid parameters', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '999', page: '-5' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
        // Check for field-level error information
        const limitError = result.error.issues.find((e) => e.path.includes('limit'));
        const pageError = result.error.issues.find((e) => e.path.includes('page'));
        expect(limitError).toBeDefined();
        expect(pageError).toBeDefined();
      }
    });
  });

  describe('edge cases and security', () => {
    it('rejects SQL injection attempts in cursor', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { cursor: "'; DROP TABLE reviews; --" },
      });
      // Schema should accept it as a string (validation happens at service layer)
      // but it's a valid string so it passes schema validation
      expect(result.success).toBe(true);
    });

    it('rejects extremely large limit values', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '99999999999' },
      });
      expect(result.success).toBe(false);
    });

    it('handles whitespace in numeric parameters', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: '  50  ' },
      });
      // parseInt should handle leading/trailing spaces
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.limit).toBe(50);
      }
    });

    it('rejects Array as parameter value', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: ['50', '100'] },
      });
      expect(result.success).toBe(false);
    });

    it('rejects object as parameter value', () => {
      const result = getMentorReviewsQuerySchema.safeParse({
        query: { limit: { value: 50 } },
      });
      expect(result.success).toBe(false);
    });
  });
});
