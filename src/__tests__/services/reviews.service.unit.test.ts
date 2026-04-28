import { ReviewsService } from "../../services/reviews.service";
import pool from "../../config/database";
import { PoolClient } from "pg";

// Mock the database module
jest.mock("../../config/database");

describe("ReviewsService", () => {
  let mockClient: jest.Mocked<PoolClient>;
  let mockPool: jest.Mocked<typeof pool>;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create mock client
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    } as unknown as jest.Mocked<PoolClient>;

    // Setup pool mock
    mockPool = pool as jest.Mocked<typeof pool>;
    mockPool.connect = jest.fn().mockResolvedValue(mockClient);
  });

  describe("updateReview", () => {
    it("should recalculate mentor rating when rating is updated", async () => {
      const reviewId = "review-123";
      const reviewerId = "reviewer-456";
      const mentorId = "mentor-789";
      const payload = { rating: 1 }; // Changed from 5 to 1

      // Mock the review fetch
      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: "", oid: 0, fields: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: reviewId,
              booking_id: "booking-123",
              reviewer_id: reviewerId,
              reviewee_id: mentorId,
              rating: 5, // Original rating
              comment: "Great mentor!",
              is_published: true,
              is_flagged: false,
              helpful_count: 0,
              created_at: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
              updated_at: new Date(),
            },
          ],
          command: "",
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // SELECT review
        .mockResolvedValueOnce({
          rows: [
            {
              id: reviewId,
              booking_id: "booking-123",
              reviewer_id: reviewerId,
              reviewee_id: mentorId,
              rating: 1, // Updated rating
              comment: "Great mentor!",
              is_published: true,
              is_flagged: false,
              helpful_count: 0,
              created_at: new Date(Date.now() - 1000 * 60 * 60),
              updated_at: new Date(),
            },
          ],
          command: "",
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // UPDATE review
        .mockResolvedValueOnce({
          rows: [{ avg_rating: "3.5", count: "4" }],
          command: "",
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // SELECT AVG for recalculation
        .mockResolvedValueOnce({ rows: [], command: "", oid: 0, fields: [], rowCount: 1 }) // UPDATE users
        .mockResolvedValueOnce({ rows: [], command: "", oid: 0, fields: [], rowCount: 0 }); // COMMIT

      await ReviewsService.updateReview(reviewId, reviewerId, payload);

      // Verify that BEGIN was called
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");

      // Verify that the review was fetched
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT id, booking_id, reviewer_id"),
        [reviewId]
      );

      // Verify that the review was updated
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE reviews SET"),
        expect.arrayContaining([1, reviewId])
      );

      // Verify that recalculateMentorRating was called (AVG query)
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT AVG(rating)"),
        [mentorId]
      );

      // Verify that the mentor's rating was updated
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE users SET average_rating"),
        expect.arrayContaining([3.5, 4, mentorId])
      );

      // Verify that COMMIT was called
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");

      // Verify that the client was released
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("should not recalculate mentor rating when only comment is updated", async () => {
      const reviewId = "review-123";
      const reviewerId = "reviewer-456";
      const mentorId = "mentor-789";
      const payload = { comment: "Updated comment" }; // Only comment changed

      // Mock the review fetch
      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: "", oid: 0, fields: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: reviewId,
              booking_id: "booking-123",
              reviewer_id: reviewerId,
              reviewee_id: mentorId,
              rating: 5,
              comment: "Great mentor!",
              is_published: true,
              is_flagged: false,
              helpful_count: 0,
              created_at: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
              updated_at: new Date(),
            },
          ],
          command: "",
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // SELECT review
        .mockResolvedValueOnce({
          rows: [
            {
              id: reviewId,
              booking_id: "booking-123",
              reviewer_id: reviewerId,
              reviewee_id: mentorId,
              rating: 5,
              comment: "Updated comment",
              is_published: true,
              is_flagged: false,
              helpful_count: 0,
              created_at: new Date(Date.now() - 1000 * 60 * 60),
              updated_at: new Date(),
            },
          ],
          command: "",
          oid: 0,
          fields: [],
          rowCount: 1,
        }) // UPDATE review
        .mockResolvedValueOnce({ rows: [], command: "", oid: 0, fields: [], rowCount: 0 }); // COMMIT

      await ReviewsService.updateReview(reviewId, reviewerId, payload);

      // Verify that BEGIN was called
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");

      // Verify that the review was updated
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE reviews SET"),
        expect.arrayContaining(["Updated comment", reviewId])
      );

      // Verify that recalculateMentorRating was NOT called (no AVG query)
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining("SELECT AVG(rating)"),
        expect.anything()
      );

      // Verify that COMMIT was called
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");

      // Verify that the client was released
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("should rollback transaction on error", async () => {
      const reviewId = "review-123";
      const reviewerId = "reviewer-456";
      const payload = { rating: 1 };

      // Mock the review fetch to throw an error
      mockClient.query
        .mockResolvedValueOnce({ rows: [], command: "", oid: 0, fields: [], rowCount: 0 }) // BEGIN
        .mockRejectedValueOnce(new Error("Database error")); // SELECT review fails

      await expect(
        ReviewsService.updateReview(reviewId, reviewerId, payload)
      ).rejects.toThrow("Database error");

      // Verify that ROLLBACK was called
      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");

      // Verify that the client was released
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
