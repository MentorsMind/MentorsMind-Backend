import { AdvancedSearchService } from "../advanced-search.service";
import pool from "../../config/database";
import { CacheService } from "../cache.service";
import elasticsearchService from "../elasticsearch.service";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
  pool: {
    query: jest.fn(),
  },
}));

jest.mock("../cache.service", () => ({
  CacheService: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock("../elasticsearch.service", () => ({
  __esModule: true,
  default: {
    checkConnection: jest.fn().mockResolvedValue(false),
    getClient: jest.fn(),
  },
}));

describe("AdvancedSearchService (#920)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("searchMentors", () => {
    it("searches mentors with PostgreSQL fallback and builds facets", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ total: "2" }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "m-1",
              first_name: "Bob",
              last_name: "Smith",
              title: "Senior Soroban Architect",
              bio: "Smart contracts expert",
              hourly_rate: "80",
              rating: "4.9",
              total_reviews: "45",
              skills: ["soroban", "rust", "stellar"],
              languages: ["English"],
              is_verified: true,
            },
            {
              id: "m-2",
              first_name: "Carol",
              last_name: "Danvers",
              title: "Fullstack Web3 Developer",
              bio: "React and Node",
              hourly_rate: "40",
              rating: "4.7",
              total_reviews: "20",
              skills: ["react", "typescript"],
              languages: ["English", "Spanish"],
              is_verified: false,
            },
          ],
        });

      const result = await AdvancedSearchService.searchMentors({
        query: "Soroban",
        minPrice: 30,
        maxPrice: 100,
        sortBy: "rating",
      });

      expect(result.mentors).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.facets.skills.length).toBeGreaterThan(0);
      expect(result.facets.priceRanges).toBeDefined();
      expect(result.facets.verificationStatus.verifiedCount).toBe(1);
      expect(result.facets.verificationStatus.unverifiedCount).toBe(1);
    });
  });

  describe("Saved Searches", () => {
    it("allows saving, retrieving, and deleting searches", async () => {
      const saved = await AdvancedSearchService.saveSearch(
        "user-1",
        "Soroban Mentors under $100",
        { skills: ["soroban"], maxPrice: 100 }
      );

      expect(saved.id).toBeDefined();
      expect(saved.name).toBe("Soroban Mentors under $100");

      const list = await AdvancedSearchService.getSavedSearches("user-1");
      expect(list).toContainEqual(saved);

      const fetched = await AdvancedSearchService.getSavedSearchById(saved.id, "user-1");
      expect(fetched).toEqual(saved);

      const deleted = await AdvancedSearchService.deleteSavedSearch(saved.id, "user-1");
      expect(deleted).toBe(true);
    });
  });

  describe("Recommendation Engine", () => {
    it("returns recommended mentors matching user profile", async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ skills: ["rust", "soroban"], interests: ["defi"], timezone: "UTC" }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "m-1",
              first_name: "Alice",
              last_name: "Smart",
              title: "Stellar Lead",
              hourly_rate: "120",
              rating: "5.0",
              total_reviews: "50",
              skills: ["rust", "soroban"],
              languages: ["English"],
              is_verified: true,
            },
          ],
        });

      const recommendations = await AdvancedSearchService.getRecommendedMentors("user-1", 5);
      expect(recommendations).toHaveLength(1);
      expect(recommendations[0].firstName).toBe("Alice");
      expect(recommendations[0].relevanceScore).toBeDefined();
    });
  });
});
