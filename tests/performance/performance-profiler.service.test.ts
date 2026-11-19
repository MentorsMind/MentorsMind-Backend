import { PerformanceProfilerService } from "../../src/services/performance-profiler.service";

describe("PerformanceProfilerService", () => {
  it("records successful and failed operations and calculates percentiles", async () => {
    const profiler = new PerformanceProfilerService();
    await profiler.measure("request", async () => undefined);
    await expect(profiler.measure("request", async () => { throw new Error("failed"); })).rejects.toThrow("failed");

    const metric = profiler.getReport().metrics[0];
    expect(metric.count).toBe(2);
    expect(metric.errors).toBe(1);
    expect(metric.p95Ms).toBeGreaterThanOrEqual(metric.minMs);
  });

  it("detects latency, error-rate, and throughput regressions", () => {
    const baseline = { generatedAt: "", durationMs: 1000, metrics: [{ name: "request", count: 10, errors: 0, errorRate: 0, minMs: 1, averageMs: 5, p50Ms: 5, p95Ms: 10, p99Ms: 10, maxMs: 10, throughputPerSecond: 10, averageMemoryDeltaBytes: 0 }] };
    const current = { ...baseline, metrics: [{ ...baseline.metrics[0], errorRate: 0.2, p95Ms: 20, throughputPerSecond: 8 }] };
    expect(PerformanceProfilerService.findRegressions(baseline, current)).toHaveLength(3);
  });
});