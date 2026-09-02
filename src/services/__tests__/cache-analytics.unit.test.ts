import {
  CacheAnalyticsService,
  EXPENSIVE_LOADER_MS,
  MIN_SAMPLES,
} from "../cache-analytics.service";
import type { OrchestratorEvent } from "../cache-orchestrator.service";

function event(partial: Partial<OrchestratorEvent>): OrchestratorEvent {
  return {
    type: "hit",
    key: "mentors:1",
    tier: "l1",
    namespace: "mentors",
    durationMs: 1,
    ...partial,
  };
}

function feed(
  service: CacheAnalyticsService,
  e: Partial<OrchestratorEvent>,
  times: number,
): void {
  for (let i = 0; i < times; i++) service.record(event(e));
}

describe("CacheAnalyticsService", () => {
  it("aggregates hit rate and per-tier counts by namespace", () => {
    const analytics = new CacheAnalyticsService();
    feed(analytics, { type: "hit", tier: "l1", durationMs: 2 }, 3);
    feed(analytics, { type: "hit", tier: "l2", durationMs: 10 }, 1);
    feed(analytics, { type: "miss", tier: "loader", durationMs: 100 }, 4);

    const [stats] = analytics.snapshot();
    expect(stats.namespace).toBe("mentors");
    expect(stats.hitRate).toBeCloseTo(0.5);
    expect(stats.tierHits.l1).toBe(3);
    expect(stats.tierHits.l2).toBe(1);
    expect(stats.avgReadMs).toBeCloseTo(4);
    expect(stats.avgLoadMs).toBeCloseTo(100);
  });

  it("orders namespaces by traffic", () => {
    const analytics = new CacheAnalyticsService();
    feed(analytics, { namespace: "quiet" }, 2);
    feed(analytics, { namespace: "busy" }, 10);

    expect(analytics.snapshot().map((s) => s.namespace)).toEqual([
      "busy",
      "quiet",
    ]);
  });

  it("stays silent below the sample threshold", () => {
    const analytics = new CacheAnalyticsService();
    feed(
      analytics,
      { type: "miss", tier: "loader", durationMs: 5_000 },
      MIN_SAMPLES - 1,
    );

    expect(analytics.recommendations()).toEqual([]);
  });

  it("flags a low hit rate as critical below 20%", () => {
    const analytics = new CacheAnalyticsService();
    feed(analytics, { type: "hit" }, 2);
    feed(analytics, { type: "miss", tier: "loader" }, 48);

    const rec = analytics
      .recommendations()
      .find((r) => r.code === "low-hit-rate");
    expect(rec).toBeDefined();
    expect(rec?.severity).toBe("critical");
  });

  it("flags a namespace that never serves from L1", () => {
    const analytics = new CacheAnalyticsService();
    feed(analytics, { type: "hit", tier: "l2" }, 30);

    expect(analytics.recommendations().map((r) => r.code)).toContain(
      "l1-bypassed",
    );
  });

  it("recommends warming an expensive loader", () => {
    const analytics = new CacheAnalyticsService();
    feed(analytics, { type: "hit", tier: "l1" }, 30);
    feed(
      analytics,
      { type: "miss", tier: "loader", durationMs: EXPENSIVE_LOADER_MS + 50 },
      5,
    );

    const rec = analytics
      .recommendations()
      .find((r) => r.code === "expensive-loader");
    expect(rec?.message).toMatch(/Register a warmer/);
  });

  it("flags invalidation churn", () => {
    const analytics = new CacheAnalyticsService();
    feed(analytics, { type: "hit", tier: "l1" }, 30);
    feed(analytics, { type: "set", tier: null }, 5);
    feed(analytics, { type: "invalidate", tier: null }, 20);

    expect(analytics.recommendations().map((r) => r.code)).toContain(
      "invalidation-churn",
    );
  });

  it("resets its counters", () => {
    const analytics = new CacheAnalyticsService();
    feed(analytics, {}, 5);
    analytics.reset();

    expect(analytics.snapshot()).toEqual([]);
  });
});
