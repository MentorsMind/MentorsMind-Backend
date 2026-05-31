/**
 * Unit tests for TokenBucketLimiter
 */

// Mock ioredis so tests run without a real Redis instance
jest.mock("ioredis", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      eval: jest.fn().mockResolvedValue([1, 10000]),
      del: jest.fn().mockResolvedValue(1),
    })),
  };
});

// Mock logger to suppress output
jest.mock("../../utils/logger.utils", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
  TokenBucketLimiter,
  RateLimitConfig,
  isTrustedIP,
  addTrustedIP,
  removeTrustedIP,
  getAnalytics,
  getAllAnalytics,
  resetAnalytics,
} from "../../utils/token-bucket-limiter";

const tokenBucketConfig: RateLimitConfig = {
  algorithm: "token-bucket",
  capacity: 5,
  refillRate: 1,
  burstSize: 5,
  dynamicAdjustment: false,
};

const slidingConfig: RateLimitConfig = {
  algorithm: "sliding-window",
  capacity: 3,
  refillRate: 1,
  burstSize: 3,
  dynamicAdjustment: false,
};

const fixedConfig: RateLimitConfig = {
  algorithm: "fixed-window",
  capacity: 3,
  refillRate: 1,
  burstSize: 3,
  dynamicAdjustment: false,
};

beforeEach(async () => {
  // Reset all buckets between tests
  await TokenBucketLimiter.reset("test-key");
  await TokenBucketLimiter.reset("dynamic-key");
  resetAnalytics();
});

// ─── Token Bucket Algorithm ───────────────────────────────────────────────────

describe("TokenBucketLimiter — token-bucket algorithm", () => {
  it("allows requests up to burst capacity", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await TokenBucketLimiter.consume(
        "test-key",
        tokenBucketConfig,
      );
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests beyond capacity", async () => {
    for (let i = 0; i < 5; i++) {
      await TokenBucketLimiter.consume("test-key", tokenBucketConfig);
    }
    const result = await TokenBucketLimiter.consume(
      "test-key",
      tokenBucketConfig,
    );
    expect(result.allowed).toBe(false);
  });

  it("returns correct tokensRemaining", async () => {
    const result = await TokenBucketLimiter.consume(
      "test-key",
      tokenBucketConfig,
    );
    expect(result.tokensRemaining).toBeGreaterThanOrEqual(0);
    expect(result.tokensRemaining).toBeLessThanOrEqual(
      tokenBucketConfig.burstSize,
    );
  });

  it("returns retryAfterMs > 0 when blocked", async () => {
    for (let i = 0; i < 5; i++) {
      await TokenBucketLimiter.consume("test-key", tokenBucketConfig);
    }
    const result = await TokenBucketLimiter.consume(
      "test-key",
      tokenBucketConfig,
    );
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("returns retryAfterMs = 0 when allowed", async () => {
    const result = await TokenBucketLimiter.consume(
      "test-key",
      tokenBucketConfig,
    );
    expect(result.retryAfterMs).toBe(0);
  });

  it("reports correct algorithm in result", async () => {
    const result = await TokenBucketLimiter.consume(
      "test-key",
      tokenBucketConfig,
    );
    expect(result.algorithm).toBe("token-bucket");
  });

  it("resets bucket on TokenBucketLimiter.reset()", async () => {
    for (let i = 0; i < 5; i++) {
      await TokenBucketLimiter.consume("test-key", tokenBucketConfig);
    }
    await TokenBucketLimiter.reset("test-key");
    const result = await TokenBucketLimiter.consume(
      "test-key",
      tokenBucketConfig,
    );
    expect(result.allowed).toBe(true);
  });

  it("isolates keys from each other", async () => {
    for (let i = 0; i < 5; i++) {
      await TokenBucketLimiter.consume("key-a", tokenBucketConfig);
    }
    const result = await TokenBucketLimiter.consume("key-b", tokenBucketConfig);
    expect(result.allowed).toBe(true);
    await TokenBucketLimiter.reset("key-a");
    await TokenBucketLimiter.reset("key-b");
  });
});

// ─── Sliding Window Algorithm ─────────────────────────────────────────────────

describe("TokenBucketLimiter — sliding-window algorithm", () => {
  it("allows requests within capacity", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await TokenBucketLimiter.consume("sw-key", slidingConfig);
      expect(result.allowed).toBe(true);
    }
    await TokenBucketLimiter.reset("sw-key");
  });

  it("blocks requests beyond capacity", async () => {
    for (let i = 0; i < 3; i++) {
      await TokenBucketLimiter.consume("sw-key", slidingConfig);
    }
    const result = await TokenBucketLimiter.consume("sw-key", slidingConfig);
    expect(result.allowed).toBe(false);
    await TokenBucketLimiter.reset("sw-key");
  });

  it("reports correct algorithm", async () => {
    const result = await TokenBucketLimiter.consume("sw-key", slidingConfig);
    expect(result.algorithm).toBe("sliding-window");
    await TokenBucketLimiter.reset("sw-key");
  });
});

// ─── Fixed Window Algorithm ───────────────────────────────────────────────────

describe("TokenBucketLimiter — fixed-window algorithm", () => {
  it("allows requests within capacity", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await TokenBucketLimiter.consume("fw-key", fixedConfig);
      expect(result.allowed).toBe(true);
    }
    await TokenBucketLimiter.reset("fw-key");
  });

  it("blocks requests beyond capacity", async () => {
    for (let i = 0; i < 3; i++) {
      await TokenBucketLimiter.consume("fw-key", fixedConfig);
    }
    const result = await TokenBucketLimiter.consume("fw-key", fixedConfig);
    expect(result.allowed).toBe(false);
    await TokenBucketLimiter.reset("fw-key");
  });

  it("reports correct algorithm", async () => {
    const result = await TokenBucketLimiter.consume("fw-key", fixedConfig);
    expect(result.algorithm).toBe("fixed-window");
    await TokenBucketLimiter.reset("fw-key");
  });
});

// ─── Trusted IP ───────────────────────────────────────────────────────────────

describe("Trusted IP helpers", () => {
  afterEach(() => {
    removeTrustedIP("10.0.0.1");
  });

  it("returns false for unknown IP", () => {
    expect(isTrustedIP("10.0.0.1")).toBe(false);
  });

  it("returns true after addTrustedIP", () => {
    addTrustedIP("10.0.0.1");
    expect(isTrustedIP("10.0.0.1")).toBe(true);
  });

  it("returns false after removeTrustedIP", () => {
    addTrustedIP("10.0.0.1");
    removeTrustedIP("10.0.0.1");
    expect(isTrustedIP("10.0.0.1")).toBe(false);
  });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

describe("Analytics", () => {
  it("returns zero counts for unknown key", () => {
    const a = getAnalytics("no-such-key");
    expect(a.totalRequests).toBe(0);
    expect(a.blockedRequests).toBe(0);
    expect(a.blockRate).toBe(0);
  });

  it("tracks total and blocked requests", async () => {
    const key = "analytics-key";
    const cfg: RateLimitConfig = {
      ...tokenBucketConfig,
      capacity: 2,
      burstSize: 2,
    };

    await TokenBucketLimiter.consume(key, cfg); // allowed
    await TokenBucketLimiter.consume(key, cfg); // allowed
    await TokenBucketLimiter.consume(key, cfg); // blocked

    const a = getAnalytics(key);
    expect(a.totalRequests).toBe(3);
    expect(a.blockedRequests).toBe(1);
    expect(a.blockRate).toBeCloseTo(1 / 3);
    expect(a.lastRequestAt).toBeInstanceOf(Date);

    await TokenBucketLimiter.reset(key);
  });

  it("getAllAnalytics returns entries for all tracked keys", async () => {
    await TokenBucketLimiter.consume("k1", tokenBucketConfig);
    await TokenBucketLimiter.consume("k2", tokenBucketConfig);

    const all = getAllAnalytics();
    const keys = all.map((a) => a.key);
    expect(keys).toContain("k1");
    expect(keys).toContain("k2");

    await TokenBucketLimiter.reset("k1");
    await TokenBucketLimiter.reset("k2");
  });

  it("resetAnalytics clears a specific key", async () => {
    await TokenBucketLimiter.consume("reset-key", tokenBucketConfig);
    resetAnalytics("reset-key");
    expect(getAnalytics("reset-key").totalRequests).toBe(0);
    await TokenBucketLimiter.reset("reset-key");
  });

  it("resetAnalytics() with no arg clears all", async () => {
    await TokenBucketLimiter.consume("a", tokenBucketConfig);
    await TokenBucketLimiter.consume("b", tokenBucketConfig);
    resetAnalytics();
    expect(getAllAnalytics()).toHaveLength(0);
    await TokenBucketLimiter.reset("a");
    await TokenBucketLimiter.reset("b");
  });
});

// ─── Dynamic Adjustment ───────────────────────────────────────────────────────

describe("Dynamic capacity adjustment", () => {
  it("reduces effective capacity when block rate is high", async () => {
    const key = "dynamic-key";
    const cfg: RateLimitConfig = {
      algorithm: "token-bucket",
      capacity: 10,
      refillRate: 1,
      burstSize: 10,
      dynamicAdjustment: true,
    };

    // Exhaust the bucket to build up a high block rate
    for (let i = 0; i < 10; i++) await TokenBucketLimiter.consume(key, cfg);
    // Now generate blocked requests to push block rate > 50%
    for (let i = 0; i < 15; i++) await TokenBucketLimiter.consume(key, cfg);

    const a = getAnalytics(key);
    expect(a.blockRate).toBeGreaterThan(0.5);

    // With dynamic adjustment, the next result should reflect reduced capacity
    const result = await TokenBucketLimiter.consume(key, cfg);
    expect(result.capacity).toBeLessThanOrEqual(cfg.capacity);
  });
});
