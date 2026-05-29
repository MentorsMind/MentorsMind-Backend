import { CacheService } from "../../services/cache.service";

// Mock Redis
jest.mock("ioredis");

// Mock logger
jest.mock("../../utils/logger.utils", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock redis config — empty URL forces in-memory cache (stable under Jest + ioredis mock)
jest.mock("../../config/redis.config", () => ({
  redisConfig: {
    url: "",
    defaultTtl: 3600,
    logMetrics: false,
    options: {},
  },
}));

describe("CacheService", () => {
  beforeEach(() => {
    // Clear any in-memory cache state
    jest.clearAllMocks();
  });

  describe("get", () => {
    it("should return cached value when available", async () => {
      const key = "test:get:available";
      const value = { data: "test" };

      // First set the value
      await CacheService.set(key, value);

      // Then get it back
      const result = await CacheService.get<typeof value>(key);

      expect(result).toEqual(value);
    });

    it("should return null when key not found", async () => {
      const key = "nonexistent:key";

      const result = await CacheService.get(key);

      expect(result).toBeNull();
    });
  });

  describe("set", () => {
    it("should set value with default TTL", async () => {
      const key = "test:key";
      const value = { data: "test" };

      await CacheService.set(key, value);

      // Verify by getting it back
      const result = await CacheService.get<typeof value>(key);
      expect(result).toEqual(value);
    });

    it("should set value with custom TTL", async () => {
      const key = "test:key";
      const value = { data: "test" };
      const ttl = 60;

      await CacheService.set(key, value, ttl);

      // Verify by getting it back
      const result = await CacheService.get<typeof value>(key);
      expect(result).toEqual(value);
    });
  });

  describe("del", () => {
    it("should delete existing key", async () => {
      const key = "test:key";
      const value = { data: "test" };

      // Set value first
      await CacheService.set(key, value);

      // Verify it exists
      let result = await CacheService.get<typeof value>(key);
      expect(result).toEqual(value);

      // Delete it
      await CacheService.del(key);

      // Verify it's gone
      result = await CacheService.get<typeof value>(key);
      expect(result).toBeNull();
    });

    it("should handle deleting non-existent key", async () => {
      const key = "nonexistent:key";

      // Should not throw
      await expect(CacheService.del(key)).resolves.toBeUndefined();
    });
  });

  describe("invalidatePattern", () => {
    it("should invalidate keys matching pattern", async () => {
      const pattern = "test:*";
      const keys = ["test:key1", "test:key2", "other:key"];

      // Set multiple values
      await CacheService.set(keys[0], { data: "value1" });
      await CacheService.set(keys[1], { data: "value2" });
      await CacheService.set(keys[2], { data: "value3" });

      // Invalidate pattern
      await CacheService.invalidatePattern(pattern);

      // Check that matching keys are gone
      let result = await CacheService.get(keys[0]);
      expect(result).toBeNull();

      result = await CacheService.get(keys[1]);
      expect(result).toBeNull();

      // Non-matching key should still exist
      result = await CacheService.get(keys[2]);
      expect(result).toEqual({ data: "value3" });
    });
  });

  describe("wrap", () => {
    it("should return cached value if available", async () => {
      const key = "test:wrap:cached-hit";
      const cachedValue = { data: "cached" };
      const fn = jest.fn().mockResolvedValue({ data: "fresh" });

      // Pre-populate cache
      await CacheService.set(key, cachedValue);

      const result = await CacheService.wrap(key, 3600, fn);

      expect(result).toEqual(cachedValue);
      expect(fn).not.toHaveBeenCalled();
    });

    it("should call function and cache result if not cached", async () => {
      const key = "test:wrap:uncached-fresh";
      const freshValue = { data: "fresh" };
      const fn = jest.fn().mockResolvedValue(freshValue);

      const result = await CacheService.wrap(key, 3600, fn);

      expect(result).toEqual(freshValue);
      expect(fn).toHaveBeenCalledTimes(1);

      // Verify it was cached
      const cached = await CacheService.get<typeof freshValue>(key);
      expect(cached).toEqual(freshValue);
    });

    it("should handle function errors", async () => {
      const key = "test:wrap:error-path";
      const error = new Error("Function failed");
      const fn = jest.fn().mockRejectedValue(error);

      await expect(CacheService.wrap(key, 3600, fn)).rejects.toThrow(
        "Function failed",
      );
      expect(fn).toHaveBeenCalledTimes(1);

      // Should not have cached the error
      const cached = await CacheService.get(key);
      expect(cached).toBeNull();
    });
  });

  describe("getMetrics", () => {
    it("should return current metrics", () => {
      const metrics = CacheService.getMetrics();

      expect(metrics).toHaveProperty("hits");
      expect(metrics).toHaveProperty("misses");
      expect(metrics).toHaveProperty("sets");
      expect(metrics).toHaveProperty("deletes");
      expect(metrics).toHaveProperty("errors");

      // All should be numbers
      Object.values(metrics).forEach((value) => {
        expect(typeof value).toBe("number");
      });
    });
  });

  describe("isDistributed", () => {
    it("should return whether Redis is available", () => {
      // Since we're using in-memory cache in tests, this should be false
      const isDistributed = CacheService.isDistributed();

      expect(typeof isDistributed).toBe("boolean");
    });
  });

  describe("warm", () => {
    it("should warm cache with multiple entries", async () => {
      const entries = [
        {
          key: "warm:key1",
          ttl: 3600,
          fn: jest.fn().mockResolvedValue({ data: "value1" }),
        },
        {
          key: "warm:key2",
          ttl: 1800,
          fn: jest.fn().mockResolvedValue({ data: "value2" }),
        },
      ];

      await CacheService.warm(entries);

      // Verify both functions were called
      expect(entries[0].fn).toHaveBeenCalledTimes(1);
      expect(entries[1].fn).toHaveBeenCalledTimes(1);

      // Verify values are cached
      const result1 = await CacheService.get(entries[0].key);
      expect(result1).toEqual({ data: "value1" });

      const result2 = await CacheService.get(entries[1].key);
      expect(result2).toEqual({ data: "value2" });
    });

    it("should handle errors during warming", async () => {
      const entries = [
        {
          key: "warm:err:key1",
          ttl: 3600,
          fn: jest.fn().mockResolvedValue({ data: "value1" }),
        },
        {
          key: "warm:err:key2",
          ttl: 1800,
          fn: jest.fn().mockRejectedValue(new Error("Failed to fetch")),
        },
      ];

      // Should not throw, should handle errors gracefully
      await expect(CacheService.warm(entries)).resolves.toBeUndefined();

      // First entry should still be cached
      const result1 = await CacheService.get(entries[0].key);
      expect(result1).toEqual({ data: "value1" });

      // Second entry should not be cached due to error
      const result2 = await CacheService.get(entries[1].key);
      expect(result2).toBeNull();
    });
  });
});
