import { RecommendationService } from "../recommendation.service";
import type {
  RecommendationContext,
  MentorRecommendation,
} from "../recommendation.service";
import pool from "../../config/database";
import { CacheService } from "../cache.service";
import { CacheKeys, CacheTTL } from "../../utils/cache-key.utils";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock("../cache.service", () => ({
  CacheService: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    wrap: jest.fn(),
  },
}));

type ScoringInternals = {
  calculateSkillMatchScore(
    mentorExpertise: string[] | null,
    context: RecommendationContext,
  ): number;
  calculateBayesianRatingScore(
    averageRating: number,
    totalReviews: number,
  ): number;
  calculateAvailabilityScore(
    isAvailable: boolean,
    timezone: string | null,
  ): number;
  calculatePriceFitScore(
    mentorRate: number | null,
    learnerPreferred: { min: number; max: number } | null,
  ): number;
  calculateCollaborativeScore(
    ctr: number,
    conversionRate: number,
    impressions30d: number,
  ): number;
};

const scoring = RecommendationService as unknown as ScoringInternals;

const context = (overrides: Partial<RecommendationContext> = {}): RecommendationContext => ({
  goals: [],
  session_history_count: 0,
  skill_gaps: [],
  ...overrides,
});

const mentorRow = (overrides: Record<string, unknown> = {}) => ({
  id: "m-1",
  email: "alice@example.com",
  first_name: "Alice",
  last_name: "Smart",
  bio: "Rust expert",
  avatar_url: null,
  expertise: ["rust"],
  hourly_rate: 90,
  average_rating: "4.9",
  total_reviews: 20,
  total_sessions_completed: 12,
  is_available: true,
  timezone: "UTC",
  ctr: "0.05",
  conversion_rate: "0.2",
  impressions_30d: 100,
  ...overrides,
});

describe("RecommendationService.getRecommendedMentors scoring algorithm (#1111)", () => {
  const learnerId = "learner-1";
  const cacheKey = CacheKeys.recommendations(learnerId);

  beforeEach(() => {
    jest.clearAllMocks();
    (pool.query as jest.Mock).mockReset();
    (CacheService.get as jest.Mock).mockReset();
    (CacheService.set as jest.Mock).mockReset();
    (CacheService.del as jest.Mock).mockReset();
  });

  function queueQueries(mentorRows: Record<string, unknown>[]): void {
    (CacheService.get as jest.Mock).mockResolvedValue(null);
    (pool.query as jest.Mock)
      // learner goals
      .mockResolvedValueOnce({ rows: [{ title: "Learn Rust" }] })
      // completed session count
      .mockResolvedValueOnce({ rows: [{ count: "5" }] })
      // identifySkillGaps — completed booking topics
      .mockResolvedValueOnce({
        rows: [{ title: "Rust fundamentals", description: null }],
      })
      // dismissed mentors
      .mockResolvedValueOnce({ rows: [] })
      // heavily booked mentors (excluded)
      .mockResolvedValueOnce({ rows: [] })
      // learner price preference (AVG of past bookings)
      .mockResolvedValueOnce({ rows: [{ avg_rate: "100" }] })
      // mentor candidate rows
      .mockResolvedValueOnce({ rows: mentorRows })
      // impression logging insert
      .mockResolvedValue({ rows: [] });
  }

  it("scores, sorts, and returns mentor recommendations", async () => {
    queueQueries([mentorRow()]);

    const recommendations = await RecommendationService.getRecommendedMentors(learnerId, 5);

    expect(recommendations).toHaveLength(1);
    const [rec] = recommendations;
    expect(rec.mentor_id).toBe("m-1");
    expect(rec.first_name).toBe("Alice");
    expect(rec.score_breakdown).toBeDefined();
    expect(typeof rec.score_breakdown.total_score).toBe("number");
    // All sub-scores must be in [0, 1]
    for (const score of Object.values(rec.score_breakdown)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("computes the documented score_breakdown for a mentor", async () => {
    queueQueries([mentorRow()]);

    const recommendations = await RecommendationService.getRecommendedMentors(learnerId, 5);
    const { score_breakdown } = recommendations[0];

    // skill match: expertise ["rust"] matches the "Learn Rust" skill gap → 1.0
    expect(score_breakdown.skill_match_score).toBeCloseTo(1.0, 2);

    // Bayesian-smoothed rating: (5 * 3.5 + 20 * 4.9) / 25 = 4.62 → /5 = 0.924
    expect(score_breakdown.rating_score).toBeCloseTo(0.924, 2);

    // available with a timezone → 0.9
    expect(score_breakdown.availability_score).toBeCloseTo(0.9, 2);

    // hourly_rate 90 sits inside the preferred [70, 130] band → 1.0
    expect(score_breakdown.price_fit_score).toBeCloseTo(1.0, 2);

    // 60% CTR (0.05) + 40% conversion (0.2) = 0.03 + 0.08 = 0.11
    expect(score_breakdown.collaborative_score).toBeCloseTo(0.11, 2);

    // total = 0.35*1.0 + 0.25*0.924 + 0.15*0.9 + 0.10*1.0 + 0.15*0.11 = 0.8325
    expect(score_breakdown.total_score).toBeCloseTo(0.83, 1);
  });

  it("combines sub-scores using the fixed weights", async () => {
    queueQueries([mentorRow()]);

    const recommendations = await RecommendationService.getRecommendedMentors(learnerId, 5);
    const b = recommendations[0].score_breakdown;

    const weighted =
      b.skill_match_score * 0.35 +
      b.rating_score * 0.25 +
      b.availability_score * 0.15 +
      b.price_fit_score * 0.10 +
      b.collaborative_score * 0.15;

    expect(b.total_score).toBeCloseTo(weighted, 2);
  });

  it("sorts mentors by descending total score", async () => {
    queueQueries([
      mentorRow({ id: "weak", expertise: ["ui"], average_rating: "3.0", total_reviews: 1 }),
      mentorRow({ id: "strong", expertise: ["rust"], average_rating: "4.9", total_reviews: 20 }),
    ]);

    const recommendations = await RecommendationService.getRecommendedMentors(learnerId, 5);

    expect(recommendations[0].mentor_id).toBe("strong");
    expect(recommendations[1].mentor_id).toBe("weak");
    expect(recommendations[0].score_breakdown.total_score).toBeGreaterThanOrEqual(
      recommendations[1].score_breakdown.total_score,
    );
  });

  it("applies the requested limit", async () => {
    queueQueries([
      mentorRow({ id: "m-1" }),
      mentorRow({ id: "m-2" }),
      mentorRow({ id: "m-3" }),
    ]);

    const recommendations = await RecommendationService.getRecommendedMentors(learnerId, 2);

    expect(recommendations).toHaveLength(2);
  });

  it("returns cached recommendations without touching the database", async () => {
    const cached: MentorRecommendation[] = [
      {
        mentor_id: "m-cached",
        first_name: "Bob",
        last_name: "Cached",
        email: "bob@example.com",
        bio: null,
        avatar_url: null,
        expertise: null,
        hourly_rate: 50,
        average_rating: 4.5,
        total_reviews: 10,
        total_sessions_completed: 3,
        is_available: true,
        timezone: null,
        score_breakdown: {
          skill_match_score: 0.8,
          rating_score: 0.9,
          availability_score: 0.7,
          price_fit_score: 0.5,
          collaborative_score: 0.1,
          total_score: 0.72,
        },
      },
    ];
    (CacheService.get as jest.Mock).mockResolvedValue(cached);

    const recommendations = await RecommendationService.getRecommendedMentors(learnerId, 5);

    expect(recommendations).toEqual(cached);
    expect(CacheService.get).toHaveBeenCalledWith(cacheKey);
    expect(pool.query).not.toHaveBeenCalled();
    expect(CacheService.set).not.toHaveBeenCalled();
  });

  it("caches freshly scored recommendations for the TTL", async () => {
    queueQueries([mentorRow()]);

    const recommendations = await RecommendationService.getRecommendedMentors(learnerId, 5);

    expect(CacheService.set).toHaveBeenCalledWith(
      cacheKey,
      recommendations,
      CacheTTL.long,
    );
  });
});

describe("RecommendationService scoring components (#1111)", () => {
  describe("skill match", () => {
    it("prefers skill gaps over goals", () => {
      const score = scoring.calculateSkillMatchScore(
        ["react"],
        context({ goals: ["rust"], skill_gaps: ["react"] }),
      );
      expect(score).toBe(1.0);
    });

    it("falls back to goals when there are no skill gaps", () => {
      const score = scoring.calculateSkillMatchScore(
        ["react"],
        context({ goals: ["react"], skill_gaps: [] }),
      );
      expect(score).toBe(1.0);
    });

    it("scores partially matched expertise proportionally", () => {
      const score = scoring.calculateSkillMatchScore(
        ["rust"],
        context({ goals: ["rust", "solidity"] }),
      );
      expect(score).toBeCloseTo(0.5, 2);
    });

    it("returns the neutral baseline when expertise or targets are empty", () => {
      expect(scoring.calculateSkillMatchScore(null, context({ goals: ["rust"] }))).toBe(0.3);
      expect(scoring.calculateSkillMatchScore([], context({ goals: ["rust"] }))).toBe(0.3);
      expect(scoring.calculateSkillMatchScore(["rust"], context())).toBe(0.3);
    });

    it("returns 0 when nothing matches", () => {
      const score = scoring.calculateSkillMatchScore(
        ["painting"],
        context({ goals: ["rust"] }),
      );
      expect(score).toBe(0);
    });
  });

  describe("Bayesian-smoothed rating", () => {
    it("places new mentors (0 reviews) at the neutral prior of 0.7", () => {
      expect(scoring.calculateBayesianRatingScore(0, 0)).toBeCloseTo(0.7, 3);
      expect(scoring.calculateBayesianRatingScore(5, 0)).toBeCloseTo(0.7, 3);
    });

    it("pulls a well-reviewed mentor toward their average", () => {
      const score = scoring.calculateBayesianRatingScore(5.0, 20);
      const smoothed = (5 * 3.5 + 20 * 5.0) / 25;
      expect(score).toBeCloseTo(smoothed / 5, 3);
      expect(score).toBeLessThan(1.0);
    });

    it("dampens a low rating that only has one review", () => {
      const score = scoring.calculateBayesianRatingScore(1.0, 1);
      const smoothed = (5 * 3.5 + 1 * 1.0) / 6;
      expect(score).toBeCloseTo(smoothed / 5, 3);
      expect(score).toBeGreaterThan(0.3);
    });

    it("clamps to [0, 1] for non-finite or out-of-range input", () => {
      expect(scoring.calculateBayesianRatingScore(Number.NaN, 0)).toBeCloseTo(0.7, 3);
      expect(scoring.calculateBayesianRatingScore(5, 5)).toBeLessThanOrEqual(1);
      expect(scoring.calculateBayesianRatingScore(-3, 5)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("availability", () => {
    it("rewards available mentors with a timezone", () => {
      expect(scoring.calculateAvailabilityScore(true, "UTC")).toBe(0.9);
    });

    it("scores an available mentor without a timezone slightly lower", () => {
      expect(scoring.calculateAvailabilityScore(true, null)).toBe(0.7);
    });

    it("scores an unavailable mentor as 0", () => {
      expect(scoring.calculateAvailabilityScore(false, "UTC")).toBe(0);
      expect(scoring.calculateAvailabilityScore(false, null)).toBe(0);
    });
  });

  describe("price fit", () => {
    it("scores a rate inside the preferred band as 1.0", () => {
      expect(scoring.calculatePriceFitScore(90, { min: 70, max: 130 })).toBe(1.0);
      expect(scoring.calculatePriceFitScore(70, { min: 70, max: 130 })).toBe(1.0);
    });

    it("returns the neutral 0.5 when either value is missing", () => {
      expect(scoring.calculatePriceFitScore(null, { min: 70, max: 130 })).toBe(0.5);
      expect(scoring.calculatePriceFitScore(90, null)).toBe(0.5);
    });

    it("decays as the rate moves outside the band, reaching 0 at 50+ away", () => {
      // 30 above the max → 1 - 30/50 = 0.4
      expect(scoring.calculatePriceFitScore(160, { min: 70, max: 130 })).toBeCloseTo(0.4, 3);
      // 120 above the max → clamped at 0
      expect(scoring.calculatePriceFitScore(250, { min: 70, max: 130 })).toBe(0);
    });
  });

  describe("collaborative signal", () => {
    it("returns the neutral baseline when the mentor has no impressions", () => {
      expect(scoring.calculateCollaborativeScore(0, 0, 0)).toBe(0.1);
      expect(scoring.calculateCollaborativeScore(1, 1, 0)).toBe(0.1);
    });

    it("weights CTR at 60% and booking conversion at 40%", () => {
      expect(scoring.calculateCollaborativeScore(0.5, 0.5, 100)).toBeCloseTo(0.5, 3);
      expect(scoring.calculateCollaborativeScore(0.05, 0.2, 100)).toBeCloseTo(0.11, 3);
    });

    it("clamps out-of-range CTR and conversion to [0, 1]", () => {
      expect(scoring.calculateCollaborativeScore(5, 5, 10)).toBeCloseTo(1.0, 3);
      expect(scoring.calculateCollaborativeScore(-1, -1, 10)).toBeCloseTo(0, 3);
    });
  });
});
