import { Gauge, Histogram } from "prom-client";
import { metricsRegistry } from "../config/metrics";

export interface MemorySnapshot {
  timestamp: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  heapUsedPercent: number;
}

export interface MemoryAnalytics {
  current: MemorySnapshot;
  averageHeapUsed: number;
  peakHeapUsed: number;
  samples: number;
  pressure: "normal" | "warning" | "critical";
}

export interface MemoryManagerOptions {
  sampleIntervalMs?: number;
  maxSamples?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
}

const memoryRssBytes = new Gauge({
  name: "node_memory_rss_bytes",
  help: "Resident set size of the Node.js process",
  registers: [metricsRegistry],
});
const memoryHeapUsedBytes = new Gauge({
  name: "node_memory_heap_used_bytes",
  help: "V8 heap used by the Node.js process",
  registers: [metricsRegistry],
});
const memoryHeapUsedPercent = new Gauge({
  name: "node_memory_heap_used_percent",
  help: "V8 heap usage as a percentage of the heap limit",
  registers: [metricsRegistry],
});
const gcDurationSeconds = new Histogram({
  name: "node_gc_duration_seconds",
  help: "Duration of manually requested garbage collection",
  buckets: [0.001, 0.005, 0.01, 0.025, 0.1, 0.5, 1],
  registers: [metricsRegistry],
});

export class MemoryManagerService {
  private options: Required<MemoryManagerOptions>;
  private readonly samples: MemorySnapshot[] = [];
  private interval?: ReturnType<typeof setInterval>;
  private peakHeapUsed = 0;

  constructor(options: MemoryManagerOptions = {}) {
    this.options = {
      sampleIntervalMs: options.sampleIntervalMs ?? 30_000,
      maxSamples: options.maxSamples ?? 120,
      warningThreshold: options.warningThreshold ?? 0.75,
      criticalThreshold: options.criticalThreshold ?? 0.9,
    };
  }

  public configure(options: MemoryManagerOptions = {}): void {
    this.options = {
      ...this.options,
      ...options,
    };
  }

  public snapshot(): MemorySnapshot {
    const usage = process.memoryUsage();
    const heapUsedPercent = usage.heapTotal > 0 ? usage.heapUsed / usage.heapTotal : 0;
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      ...usage,
      heapUsedPercent,
    };

    this.peakHeapUsed = Math.max(this.peakHeapUsed, snapshot.heapUsed);
    this.samples.push(snapshot);
    if (this.samples.length > this.options.maxSamples) this.samples.shift();
    memoryRssBytes.set(snapshot.rss);
    memoryHeapUsedBytes.set(snapshot.heapUsed);
    memoryHeapUsedPercent.set(heapUsedPercent * 100);
    return snapshot;
  }

  public getAnalytics(): MemoryAnalytics {
    const current = this.samples[this.samples.length - 1] ?? this.snapshot();
    const total = this.samples.reduce((sum, sample) => sum + sample.heapUsed, 0);
    const pressure = current.heapUsedPercent >= this.options.criticalThreshold
      ? "critical"
      : current.heapUsedPercent >= this.options.warningThreshold ? "warning" : "normal";
    return {
      current,
      averageHeapUsed: this.samples.length > 0 ? total / this.samples.length : 0,
      peakHeapUsed: this.peakHeapUsed,
      samples: this.samples.length,
      pressure,
    };
  }

  public getSamples(): MemorySnapshot[] {
    return this.samples.slice();
  }

  public optimizeGarbageCollection(): boolean {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) return false;
    const start = process.hrtime.bigint();
    gc();
    gcDurationSeconds.observe(Number(process.hrtime.bigint() - start) / 1e9);
    this.snapshot();
    return true;
  }

  public start(): void {
    if (this.interval) return;
    this.snapshot();
    this.interval = setInterval(() => this.snapshot(), this.options.sampleIntervalMs);
    this.interval.unref();
  }

  public stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }
}

export const memoryManager = new MemoryManagerService();
export default memoryManager;