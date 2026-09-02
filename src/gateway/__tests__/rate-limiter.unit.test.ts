import { TokenBucketRateLimiter } from "../rate-limiter";

describe("TokenBucketRateLimiter", () => {
  it("allows up to capacity (sustained + burst) then blocks", () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerWindow: 5,
      windowMs: 1000,
      burst: 2,
    });

    const results = Array.from({ length: 8 }, () => limiter.consume("client-1"));
    expect(results.slice(0, 7).every((r) => r.allowed)).toBe(true);
    expect(results[7].allowed).toBe(false);
    expect(results[7].retryAfterMs).toBeGreaterThan(0);
  });

  it("refills tokens over time", () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const limiter = new TokenBucketRateLimiter({
      requestsPerWindow: 10,
      windowMs: 1000,
      burst: 0,
    });

    for (let i = 0; i < 10; i += 1) limiter.consume("c");
    expect(limiter.consume("c").allowed).toBe(false);

    jest.setSystemTime(now + 500); // 5 tokens back
    expect(limiter.consume("c").allowed).toBe(true);

    jest.useRealTimers();
  });

  it("isolates buckets per key", () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerWindow: 1,
      windowMs: 1000,
      burst: 0,
    });
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    expect(limiter.consume("b").allowed).toBe(true);
  });

  it("reports remaining tokens", () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerWindow: 3,
      windowMs: 1000,
      burst: 0,
    });
    expect(limiter.consume("k").remaining).toBe(2);
    expect(limiter.consume("k").remaining).toBe(1);
  });
});
