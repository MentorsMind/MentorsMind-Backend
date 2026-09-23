import { SearchService } from "../search.service";
import pool from "../../config/database";
import { CacheService } from "../cache.service";
import elasticsearchService from "../elasticsearch.service";

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
  },
}));

jest.mock("../elasticsearch.service", () => ({
  __esModule: true,
  default: {
    checkConnection: jest.fn().mockResolvedValue(false),
    autocomplete: jest.fn(),
  },
}));

const AUTOCOMPLETE_CACHE_TTL = 300;

describe("SearchService.autocomplete (#1095)", () => {
  const MOCK_SUGGESTIONS = ["Alice Mentor", "Bob Builder"];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns empty array when query is empty", async () => {
    const result = await SearchService.autocomplete("");

    expect(result).toEqual([]);
    expect(CacheService.get).not.toHaveBeenCalled();
    expect(CacheService.set).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns empty array when query is shorter than 2 characters", async () => {
    const result = await SearchService.autocomplete("a");

    expect(result).toEqual([]);
    expect(CacheService.get).not.toHaveBeenCalled();
    expect(CacheService.set).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns empty array when query is whitespace only", async () => {
    const result = await SearchService.autocomplete("   ");

    expect(result).toEqual([]);
    expect(CacheService.get).not.toHaveBeenCalled();
    expect(CacheService.set).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  describe("caching behaviour", () => {
    it("cache miss — queries the database (PostgreSQL fallback) and caches the result", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({
        rows: MOCK_SUGGESTIONS.map((name) => ({ name })),
      });

      const result = await SearchService.autocomplete("Alice", 10);

      expect(result).toEqual(MOCK_SUGGESTIONS);
      expect(CacheService.get).toHaveBeenCalledWith(
        "mm:search:autocomplete:alice:10",
      );
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        `SELECT name FROM users WHERE role = 'mentor' AND name ILIKE $1 LIMIT $2`,
        ["Alice%", 10],
      );
      expect(CacheService.set).toHaveBeenCalledWith(
        "mm:search:autocomplete:alice:10",
        MOCK_SUGGESTIONS,
        AUTOCOMPLETE_CACHE_TTL,
      );
    });

    it("cache hit — returns cached data without touching the database", async () => {
      const cachedSuggestions = ["Cached Mentor"];
      (CacheService.get as jest.Mock).mockResolvedValue(cachedSuggestions);

      const result = await SearchService.autocomplete("mentor", 5);

      expect(result).toEqual(cachedSuggestions);
      expect(CacheService.get).toHaveBeenCalledWith(
        "mm:search:autocomplete:mentor:5",
      );
      expect(pool.query).not.toHaveBeenCalled();
      expect(CacheService.set).not.toHaveBeenCalled();
    });

    it("cache miss then cache hit — database queried only on the first call", async () => {
      // First call: cache miss → DB query
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({
        rows: MOCK_SUGGESTIONS.map((name) => ({ name })),
      });

      const firstResult = await SearchService.autocomplete("bob", 10);
      expect(firstResult).toEqual(MOCK_SUGGESTIONS);
      expect(pool.query).toHaveBeenCalledTimes(1);

      // Second call: cache hit → no DB query
      (CacheService.get as jest.Mock).mockResolvedValue(MOCK_SUGGESTIONS);

      const secondResult = await SearchService.autocomplete("bob", 10);
      expect(secondResult).toEqual(MOCK_SUGGESTIONS);
      // Still only one DB call across both invocations
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it("uses the correct cache key based on normalised query and limit", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await SearchService.autocomplete("  AlIcE  ", 5);

      expect(CacheService.get).toHaveBeenCalledWith(
        "mm:search:autocomplete:alice:5",
      );
      expect(CacheService.set).toHaveBeenCalledWith(
        "mm:search:autocomplete:alice:5",
        [],
        AUTOCOMPLETE_CACHE_TTL,
      );
    });

    it("distinguishes cache keys for different limits", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await SearchService.autocomplete("test", 5);
      await SearchService.autocomplete("test", 10);

      expect(CacheService.get).toHaveBeenCalledWith(
        "mm:search:autocomplete:test:5",
      );
      expect(CacheService.get).toHaveBeenCalledWith(
        "mm:search:autocomplete:test:10",
      );
    });
  });

  describe("PostgreSQL fallback query", () => {
    it("executes the correct ILIKE query with the original query and limit", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ name: "John Doe" }, { name: "Johnny Appleseed" }],
      });

      const result = await SearchService.autocomplete("John", 3);

      expect(result).toEqual(["John Doe", "Johnny Appleseed"]);
      expect(pool.query).toHaveBeenCalledWith(
        `SELECT name FROM users WHERE role = 'mentor' AND name ILIKE $1 LIMIT $2`,
        ["John%", 3],
      );
    });

    it("returns an empty array when no mentors match", async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await SearchService.autocomplete("zzzzz");

      expect(result).toEqual([]);
    });
  });
});