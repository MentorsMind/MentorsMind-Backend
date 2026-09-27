/**
 * Unit tests for SessionQualityService
 *
 * Tests the core scoring logic:
 * - Perfect session scores 100
 * - Session with no feedback scores lower
 * - Session that ran under time scores lower
 * - Score is bounded 0–100
 *
 * All DB calls are mocked. Pure calculation functions are tested in isolation.
 */

import {
  SessionQualityService,
  SessionQualityScore,
  MentorQualityScoreResult,
} from "../session-quality.service";
import pool from "../../config/database";

jest.mock("../../config/database");
jest.mock("../../utils/logger", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

describe("SessionQualityService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("computeSessionScore", () => {
    const sessionId = "session-123";

    describe("perfect session", () => {
      it("should score 100 for perfect feedback and completion", async () => {
        const mockSessionData = {
          rating_content: 5,
          rating_communication: 5,
          rating_preparation: 5,
          rating_value: 5,
          comment: "excellent outstanding amazing fantastic perfect",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60, // 100% completion
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result).toBeDefined();
        expect(result?.overallScore).toBe(100);
        expect(result?.qualityTier).toBe("excellent");
        expect(result?.completionRate).toBe(100);
        expect(result?.sentimentScore).toBeGreaterThanOrEqual(60); // Positive words boost sentiment
      });

      it("should have all dimensions at max for perfect session", async () => {
        const mockSessionData = {
          rating_content: 5,
          rating_communication: 5,
          rating_preparation: 5,
          rating_value: 5,
          comment: "Perfect session",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.contentScore).toBe(100);
        expect(result?.communicationScore).toBe(100);
        expect(result?.preparationScore).toBe(100);
        expect(result?.valueScore).toBe(100);
        expect(result?.engagementScore).toBe(100);
      });
    });

    describe("sessions with no feedback", () => {
      it("should return null when no feedback exists", async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result).toBeNull();
      });
    });

    describe("sessions with mixed ratings", () => {
      it("should score lower when feedback is below average", async () => {
        const mockSessionData = {
          rating_content: 2,
          rating_communication: 2,
          rating_preparation: 2,
          rating_value: 2,
          comment: "disappointing unclear waste",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.overallScore).toBeLessThan(50);
        expect(result?.qualityTier).toBe("poor");
        expect(result?.sentimentScore).toBeLessThan(50); // Negative words reduce sentiment
      });

      it("should score 0 for minimum ratings (all 1s)", async () => {
        const mockSessionData = {
          rating_content: 1,
          rating_communication: 1,
          rating_preparation: 1,
          rating_value: 1,
          comment: "terrible horrible bad",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.overallScore).toBe(0);
        expect(result?.contentScore).toBe(0);
        expect(result?.communicationScore).toBe(0);
        expect(result?.preparationScore).toBe(0);
        expect(result?.valueScore).toBe(0);
      });
    });

    describe("session completion rate impacts score", () => {
      it("should score lower when session runs under time", async () => {
        const mockSessionData = {
          rating_content: 5,
          rating_communication: 5,
          rating_preparation: 5,
          rating_value: 5,
          comment: "Good but ran short",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 30, // Only 50% of scheduled time
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.completionRate).toBe(50);
        expect(result?.overallScore).toBeLessThan(100); // Score reduced due to low completion
        expect(result?.overallScore).toBeGreaterThan(50); // But still reasonable with good ratings
      });

      it("should cap completion rate at 100%", async () => {
        const mockSessionData = {
          rating_content: 5,
          rating_communication: 5,
          rating_preparation: 5,
          rating_value: 5,
          comment: "Great session",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 90, // Went over time
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.completionRate).toBe(100); // Capped at 100
        expect(result?.overallScore).toBe(100);
      });

      it("should use default 80% completion when duration not tracked", async () => {
        const mockSessionData = {
          rating_content: 5,
          rating_communication: 5,
          rating_preparation: 5,
          rating_value: 5,
          comment: "Excellent",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: null,
          actual_duration_minutes: null,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.completionRate).toBe(80); // Default
        expect(result?.overallScore).toBe(100); // High ratings still give high score
      });
    });

    describe("score bounds", () => {
      it("should never score above 100", async () => {
        const mockSessionData = {
          rating_content: 5,
          rating_communication: 5,
          rating_preparation: 5,
          rating_value: 5,
          comment: "absolutely excellent amazing fantastic",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.overallScore).toBeLessThanOrEqual(100);
      });

      it("should never score below 0", async () => {
        const mockSessionData = {
          rating_content: 1,
          rating_communication: 1,
          rating_preparation: 1,
          rating_value: 1,
          comment: "bad terrible poor disappointing",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 1, // Extreme under-time
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.overallScore).toBeGreaterThanOrEqual(0);
      });
    });

    describe("sentiment scoring", () => {
      it("should detect positive sentiment from keywords", async () => {
        const mockSessionData = {
          rating_content: 3,
          rating_communication: 3,
          rating_preparation: 3,
          rating_value: 3,
          comment: "Very helpful, excellent communication, patient mentor",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.sentimentScore).toBeGreaterThan(50);
      });

      it("should detect negative sentiment from keywords", async () => {
        const mockSessionData = {
          rating_content: 3,
          rating_communication: 3,
          rating_preparation: 3,
          rating_value: 3,
          comment: "Confusing and unprepared, waste of time",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.sentimentScore).toBeLessThan(50);
      });

      it("should default to neutral sentiment when no comment", async () => {
        const mockSessionData = {
          rating_content: 3,
          rating_communication: 3,
          rating_preparation: 3,
          rating_value: 3,
          comment: null,
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.sentimentScore).toBe(50);
      });
    });

    describe("quality tier classification", () => {
      it("should classify excellent for score >= 85", async () => {
        const mockSessionData = {
          rating_content: 5,
          rating_communication: 5,
          rating_preparation: 5,
          rating_value: 4,
          comment: "Great session",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.qualityTier).toBe("excellent");
      });

      it("should classify good for score 70-84", async () => {
        const mockSessionData = {
          rating_content: 4,
          rating_communication: 4,
          rating_preparation: 3,
          rating_value: 4,
          comment: "Good session",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.qualityTier).toBe("good");
      });

      it("should classify average for score 50-69", async () => {
        const mockSessionData = {
          rating_content: 3,
          rating_communication: 3,
          rating_preparation: 3,
          rating_value: 3,
          comment: "Average",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.qualityTier).toBe("average");
      });

      it("should classify poor for score < 50", async () => {
        const mockSessionData = {
          rating_content: 1,
          rating_communication: 2,
          rating_preparation: 1,
          rating_value: 2,
          comment: "Poor session",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.qualityTier).toBe("poor");
      });
    });

    describe("factor analysis", () => {
      it("should compute weighted factors contributing to overall score", async () => {
        const mockSessionData = {
          rating_content: 5,
          rating_communication: 4,
          rating_preparation: 3,
          rating_value: 5,
          comment: "Excellent content",
          scheduled_at: "2024-01-01T10:00:00Z",
          duration_minutes: 60,
          actual_duration_minutes: 60,
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockSessionData] });

        const result = await SessionQualityService.computeSessionScore(sessionId);

        expect(result?.factors).toBeDefined();
        expect(result?.factors.length).toBeGreaterThan(0);

        const contentFactor = result?.factors.find((f) => f.name === "Content Quality");
        expect(contentFactor).toBeDefined();
        expect(contentFactor?.weight).toBe(0.25);
        expect(contentFactor?.score).toBe(100); // 5 rating
        expect(contentFactor?.impact).toBe("positive");
      });
    });
  });

  describe("computeMentorQualityScore", () => {
    const mentorId = "mentor-123";

    describe("quality score calculation", () => {
      it("should compute weighted mentor quality score", async () => {
        const mockStats = [
          {
            total_bookings: 100,
            completed_bookings: 90,
            cancelled_bookings: 5,
            no_show_count: 5,
            avg_response_seconds: 3600, // 1 hour
          },
        ];

        const mockRatings = [
          {
            avg_rating: 4.5, // 4.5/5 rating
          },
        ];

        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: mockStats })
          .mockResolvedValueOnce({ rows: mockRatings });

        const result = await SessionQualityService.computeMentorQualityScore(mentorId);

        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        expect(result.completionRate).toBe(90); // 90/100
        expect(result.avgRating).toBeGreaterThan(70); // 4.5 normalized to 0-100
        expect(result.responseTimeScore).toBe(100); // 1 hour is ideal
        expect(result.tier).toBeDefined();
      });

      it("should handle zero bookings gracefully", async () => {
        const mockStats = [
          {
            total_bookings: 0,
            completed_bookings: 0,
            cancelled_bookings: 0,
            no_show_count: 0,
            avg_response_seconds: null,
          },
        ];

        const mockRatings = [{ avg_rating: null }];

        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: mockStats })
          .mockResolvedValueOnce({ rows: mockRatings });

        const result = await SessionQualityService.computeMentorQualityScore(mentorId);

        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        expect(result.completionRate).toBe(100); // Default for zero bookings
        expect(result.avgRating).toBe(80); // Default rating for no reviews
      });

      it("should penalize cancellations and no-shows", async () => {
        const mockStats = [
          {
            total_bookings: 100,
            completed_bookings: 70,
            cancelled_bookings: 20,
            no_show_count: 10,
            avg_response_seconds: 3600,
          },
        ];

        const mockRatings = [{ avg_rating: 4.0 }];

        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: mockStats })
          .mockResolvedValueOnce({ rows: mockRatings });

        const result = await SessionQualityService.computeMentorQualityScore(mentorId);

        expect(result.cancellationPenalty).toBeLessThan(100);
        expect(result.score).toBeLessThan(85); // Lower due to cancellations
      });

      it("should scale response time score correctly", async () => {
        // Test various response times
        const testCases = [
          { seconds: 1800, expectedScore: 100 }, // 30 mins
          { seconds: 3600, expectedScore: 100 }, // 1 hour
          { seconds: 7200, expectedScore: 100 }, // 2 hours (still ideal range)
          { seconds: 43200, expectedScore: 0 }, // 12 hours (within 24hr window)
          { seconds: 86400, expectedScore: 0 }, // 24 hours (at floor)
        ];

        for (const testCase of testCases) {
          jest.clearAllMocks();

          const mockStats = [
            {
              total_bookings: 100,
              completed_bookings: 100,
              cancelled_bookings: 0,
              no_show_count: 0,
              avg_response_seconds: testCase.seconds,
            },
          ];

          const mockRatings = [{ avg_rating: 4.0 }];

          (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: mockStats })
            .mockResolvedValueOnce({ rows: mockRatings });

          const result = await SessionQualityService.computeMentorQualityScore(mentorId);

          expect(result.responseTimeScore).toBe(testCase.expectedScore);
        }
      });
    });

    describe("mentor tier classification", () => {
      it("should classify excellent for score >= 90", async () => {
        const mockStats = [
          {
            total_bookings: 100,
            completed_bookings: 99,
            cancelled_bookings: 1,
            no_show_count: 0,
            avg_response_seconds: 1800,
          },
        ];

        const mockRatings = [{ avg_rating: 5 }];

        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: mockStats })
          .mockResolvedValueOnce({ rows: mockRatings });

        const result = await SessionQualityService.computeMentorQualityScore(mentorId);

        expect(result.tier).toBe("excellent");
      });

      it("should classify good for score 75-89", async () => {
        const mockStats = [
          {
            total_bookings: 100,
            completed_bookings: 85,
            cancelled_bookings: 10,
            no_show_count: 5,
            avg_response_seconds: 3600,
          },
        ];

        const mockRatings = [{ avg_rating: 4.2 }];

        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: mockStats })
          .mockResolvedValueOnce({ rows: mockRatings });

        const result = await SessionQualityService.computeMentorQualityScore(mentorId);

        expect(result.tier).toBe("good");
      });

      it("should classify needs_improvement for score 60-74", async () => {
        const mockStats = [
          {
            total_bookings: 100,
            completed_bookings: 60,
            cancelled_bookings: 30,
            no_show_count: 10,
            avg_response_seconds: 43200,
          },
        ];

        const mockRatings = [{ avg_rating: 3.0 }];

        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: mockStats })
          .mockResolvedValueOnce({ rows: mockRatings });

        const result = await SessionQualityService.computeMentorQualityScore(mentorId);

        expect(result.tier).toBe("needs_improvement");
      });

      it("should classify at_risk for score < 60", async () => {
        const mockStats = [
          {
            total_bookings: 100,
            completed_bookings: 40,
            cancelled_bookings: 50,
            no_show_count: 10,
            avg_response_seconds: 86400,
          },
        ];

        const mockRatings = [{ avg_rating: 2.0 }];

        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: mockStats })
          .mockResolvedValueOnce({ rows: mockRatings });

        const result = await SessionQualityService.computeMentorQualityScore(mentorId);

        expect(result.tier).toBe("at_risk");
      });
    });

    describe("idempotency and determinism", () => {
      it("should produce same score for same input data", async () => {
        const mockStats = [
          {
            total_bookings: 100,
            completed_bookings: 85,
            cancelled_bookings: 10,
            no_show_count: 5,
            avg_response_seconds: 5400,
          },
        ];

        const mockRatings = [{ avg_rating: 4.3 }];

        // First call
        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: mockStats })
          .mockResolvedValueOnce({ rows: mockRatings });

        const result1 = await SessionQualityService.computeMentorQualityScore(mentorId);

        // Second call with same data
        jest.clearAllMocks();
        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: mockStats })
          .mockResolvedValueOnce({ rows: mockRatings });

        const result2 = await SessionQualityService.computeMentorQualityScore(mentorId);

        expect(result1.score).toBe(result2.score);
        expect(result1.tier).toBe(result2.tier);
      });
    });
  });
});
