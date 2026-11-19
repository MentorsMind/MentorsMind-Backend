import { performance } from "node:perf_hooks";

export interface PerformanceSample {
  name: string;
  durationMs: number;
  success: boolean;
  memoryDeltaBytes: number;
  timestamp: string;
}

export interface PerformanceMetric {
  name: string;
  count: number;
  errors: number;
  errorRate: number;
  minMs: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  throughputPerSecond: number;
  averageMemoryDeltaBytes: number;
}

export interface PerformanceReport {
  generatedAt: string;
  durationMs: number;
  metrics: PerformanceMetric[];
}

export interface RegressionThresholds {
  p95IncreasePercent?: number;
  errorRateIncreasePercent?: number;
  throughputDecreasePercent?: number;
}

export interface RegressionFinding {
  name: string;
  metric: "p95Ms" | "errorRate" | "throughputPerSecond";
  baseline: number;
  current: number;
  changePercent: number;
  thresholdPercent: number;
}

export class PerformanceProfilerService {
  private readonly samples: PerformanceSample[] = [];
  private readonly startedAt = performance.now();

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const startMemory = process.memoryUsage().heapUsed;
    let success = false;

    try {
      const result = await operation();
      success = true;
      return result;
    } finally {
      this.samples.push({
        name,
        durationMs: performance.now() - start,
        success,
        memoryDeltaBytes: process.memoryUsage().heapUsed - startMemory,
        timestamp: new Date().toISOString(),
      });
    }
  }

  getSamples(): PerformanceSample[] {
    return [...this.samples];
  }

  getReport(): PerformanceReport {
    const grouped = new Map<string, PerformanceSample[]>();
    for (const sample of this.samples) {
      const existing = grouped.get(sample.name) ?? [];
      existing.push(sample);
      grouped.set(sample.name, existing);
    }

    return {
      generatedAt: new Date().toISOString(),
      durationMs: performance.now() - this.startedAt,
      metrics: [...grouped.entries()].map(([name, samples]) => this.toMetric(name, samples)),
    };
  }

  static findRegressions(
    baseline: PerformanceReport,
    current: PerformanceReport,
    thresholds: RegressionThresholds = {},
  ): RegressionFinding[] {
    const limits = {
      p95IncreasePercent: thresholds.p95IncreasePercent ?? 10,
      errorRateIncreasePercent: thresholds.errorRateIncreasePercent ?? 5,
      throughputDecreasePercent: thresholds.throughputDecreasePercent ?? 10,
    };
    const baselineMetrics = new Map(baseline.metrics.map((metric) => [metric.name, metric]));
    const findings: RegressionFinding[] = [];

    for (const metric of current.metrics) {
      const previous = baselineMetrics.get(metric.name);
      if (!previous) continue;

      const p95Change = this.percentChange(previous.p95Ms, metric.p95Ms);
      if (p95Change > limits.p95IncreasePercent) {
        findings.push({ name: metric.name, metric: "p95Ms", baseline: previous.p95Ms, current: metric.p95Ms, changePercent: p95Change, thresholdPercent: limits.p95IncreasePercent });
      }

      const errorChange = (metric.errorRate - previous.errorRate) * 100;
      if (errorChange > limits.errorRateIncreasePercent) {
        findings.push({ name: metric.name, metric: "errorRate", baseline: previous.errorRate, current: metric.errorRate, changePercent: errorChange, thresholdPercent: limits.errorRateIncreasePercent });
      }

      const throughputChange = this.percentChange(metric.throughputPerSecond, previous.throughputPerSecond);
      if (throughputChange > limits.throughputDecreasePercent) {
        findings.push({ name: metric.name, metric: "throughputPerSecond", baseline: previous.throughputPerSecond, current: metric.throughputPerSecond, changePercent: throughputChange, thresholdPercent: limits.throughputDecreasePercent });
      }
    }

    return findings;
  }

  private toMetric(name: string, samples: PerformanceSample[]): PerformanceMetric {
    const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const elapsedSeconds = Math.max((performance.now() - this.startedAt) / 1000, 0.001);
    const errors = samples.filter((sample) => !sample.success).length;
    return {
      name,
      count: samples.length,
      errors,
      errorRate: errors / samples.length,
      minMs: durations[0] ?? 0,
      averageMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
      p50Ms: this.percentile(durations, 0.5),
      p95Ms: this.percentile(durations, 0.95),
      p99Ms: this.percentile(durations, 0.99),
      maxMs: durations[durations.length - 1] ?? 0,
      throughputPerSecond: samples.length / elapsedSeconds,
      averageMemoryDeltaBytes: samples.reduce((sum, sample) => sum + sample.memoryDeltaBytes, 0) / samples.length,
    };
  }

  private percentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.min(Math.ceil(sortedValues.length * percentile) - 1, sortedValues.length - 1);
    return sortedValues[Math.max(index, 0)];
  }

  private static percentChange(baseline: number, current: number): number {
    if (baseline === 0) return current === 0 ? 0 : 100;
    return ((current - baseline) / baseline) * 100;
  }
}