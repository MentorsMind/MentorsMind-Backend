// jest.mock calls must be hoisted before imports
jest.mock("ioredis");

jest.mock("../../utils/logger.utils", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../config/redis.config", () => ({
  redisConfig: { url: "", defaultTtl: 3600, logMetrics: false, options: {} },
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import { RecommendationService } from "../../services/recommendations.service";
import { CacheService } from "../../services/cache.service";
import pool from "../../config/database";

// ── Typed mock references ──────────────────────────────────────────────────────

const mockPool = pool as unknown as { query: jest.Mock };

// ── Helpers ────────────────────────────────────────────────────────────────────

const LEARNER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const MENTOR_A = "bbbbbbbb-0000-0000-0000-000000000001";
const MENTOR_B = "bbbbbbbb-0000-0000-0000-000000000002";

function makeMentor(
  overrides: Partial<{
    id: string;
    expertise: string[];
    average_rating: number;
    is_available: boolean;
    hourly_rate: number | null;
  }> = {},
) {
  return {
    id: MENTOR_A,
    first_name: "Alice",
    last_name: "Smith",
    bio: null,
    avatar_url: null,
    hourly_rate: 50,
    expertise: ["TypeScript", "React"],
    average_rating: 4.5,
    total_sessions_completed: 10,
    is_available: true,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("RecommendationService", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Clear in-memory cache between tests
    await CacheService.del(`mm:recommendations:${LEARNER_ID}`);
  });

  describe("getRecommendedMentors", () => {
    it("returns scored mentors sorted by score descending", async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ interests: ["TypeScript", "React"], max_hourly_rate: 100 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            makeMentor({
              id: MENTOR_A,
              expertise: ["TypeScript", "React"],
              average_rating: 5,
              is_available: true,
            }),
            makeMentor({
              id: MENTOR_B,
              expertise: ["Python"],
              average_rating: 3,
              is_available: false,
            }),
          ],
        });

      const results =
        await RecommendationService.getRecommendedMentors(LEARNER_ID);

      expect(results).toHaveLength(2);
      // MENTOR_A has full skill overlap + high rating + available → higher score
      expect(results[0].id).toBe(MENTOR_A);
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it("respects the limit parameter", async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ interests: ["JS"], max_hourly_rate: null }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: Array.from({ length: 20 }, (_, i) =>
            makeMentor({ id: `mentor-${i}`, expertise: ["JS"] }),
          ),
        });

      const results = await RecommendationService.getRecommendedMentors(
        LEARNER_ID,
        5,
      );

      expect(results).toHaveLength(5);
    });

    it("returns cached results on second call without hitting DB again", async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ interests: ["Go"], max_hourly_rate: null }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeMentor({ expertise: ["Go"] })] });

      await RecommendationService.getRecommendedMentors(LEARNER_ID);
      await RecommendationService.getRecommendedMentors(LEARNER_ID);

      // DB should only be queried once (3 queries for the first call, 0 for the second)
      expect(mockPool.query).toHaveBeenCalledTimes(3);
    });

    it("handles learner with no interests gracefully", async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ interests: null, max_hourly_rate: null }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const results =
        await RecommendationService.getRecommendedMentors(LEARNER_ID);

      expect(results).toEqual([]);
    });

    it("handles learner row not found gracefully", async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // no learner row
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        RecommendationService.getRecommendedMentors(LEARNER_ID),
      ).resolves.toEqual([]);
    });

    it("includes collaborative signal mentors in candidates query", async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ interests: [], max_hourly_rate: null }],
        })
        .mockResolvedValueOnce({ rows: [{ mentor_id: MENTOR_B }] })
        .mockResolvedValueOnce({ rows: [makeMentor({ id: MENTOR_B })] });

      const results =
        await RecommendationService.getRecommendedMentors(LEARNER_ID);

      // The candidates query should have been called with MENTOR_B in the array
      const candidatesCall = mockPool.query.mock.calls[2];
      expect(candidatesCall[1][0]).toContain(MENTOR_B);
      expect(results[0].id).toBe(MENTOR_B);
    });
  });

  describe("trackEvent", () => {
    it("inserts an impression event", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await RecommendationService.trackEvent(
        LEARNER_ID,
        MENTOR_A,
        "impression",
        0.85,
      );

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO recommendation_events"),
        [LEARNER_ID, MENTOR_A, "impression", "collaborative_filtering", 0.85],
      );
    });

    it("inserts a click event", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await RecommendationService.trackEvent(LEARNER_ID, MENTOR_A, "click");

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO recommendation_events"),
        [LEARNER_ID, MENTOR_A, "click", "collaborative_filtering", null],
      );
    });

    it("does not throw when DB insert fails", async () => {
      mockPool.query.mockRejectedValueOnce(new Error("DB error"));

      await expect(
        RecommendationService.trackEvent(LEARNER_ID, MENTOR_A, "click"),
      ).resolves.toBeUndefined();
    });
  });

  describe("invalidateCache", () => {
    it("removes cached recommendations for a learner", async () => {
      // Seed the cache
      await CacheService.set(`mm:recommendations:${LEARNER_ID}`, [
        makeMentor(),
      ]);

      await RecommendationService.invalidateCache(LEARNER_ID);

      const cached = await CacheService.get(`mm:recommendations:${LEARNER_ID}`);
      expect(cached).toBeNull();
    });
  });

  describe("scoring", () => {
    it("gives higher score to available mentor vs unavailable", async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ interests: ["JS"], max_hourly_rate: null }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            makeMentor({
              id: MENTOR_A,
              expertise: ["JS"],
              average_rating: 4,
              is_available: true,
            }),
            makeMentor({
              id: MENTOR_B,
              expertise: ["JS"],
              average_rating: 4,
              is_available: false,
            }),
          ],
        });

      const results =
        await RecommendationService.getRecommendedMentors(LEARNER_ID);

      const available = results.find((m) => m.id === MENTOR_A)!;
      const unavailable = results.find((m) => m.id === MENTOR_B)!;
      expect(available.score).toBeGreaterThan(unavailable.score);
    });

    it("score is between 0 and 1", async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ interests: ["TypeScript"], max_hourly_rate: 100 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            makeMentor({
              expertise: ["TypeScript"],
              average_rating: 5,
              is_available: true,
              hourly_rate: 50,
            }),
          ],
        });

      const results =
        await RecommendationService.getRecommendedMentors(LEARNER_ID);

      expect(results[0].score).toBeGreaterThanOrEqual(0);
      expect(results[0].score).toBeLessThanOrEqual(1);
    });
  });
});
