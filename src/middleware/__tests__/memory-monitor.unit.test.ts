import {
  startMemoryMonitoring,
  stopMemoryMonitoring,
} from "../memory-monitor.middleware";
import { memoryManager } from "../../services/memory-manager.service";

describe("memoryMonitorMiddleware interval cleanup (#1077)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    stopMemoryMonitoring();
  });

  afterEach(() => {
    stopMemoryMonitoring();
    jest.useRealTimers();
  });

  it("starts exactly one sampling interval", () => {
    const before = jest.getTimerCount();

    startMemoryMonitoring({ sampleIntervalMs: 1_000 });

    expect(jest.getTimerCount()).toBe(before + 1);
  });

  it("clears the interval when stopMemoryMonitoring is called", () => {
    startMemoryMonitoring({ sampleIntervalMs: 1_000 });
    const during = jest.getTimerCount();

    stopMemoryMonitoring();

    expect(jest.getTimerCount()).toBe(during - 1);
  });

  it("takes no further samples after the interval is cleared", () => {
    startMemoryMonitoring({ sampleIntervalMs: 1_000 });
    jest.advanceTimersByTime(1_000);
    const samplesAtStop = memoryManager.getSamples().length;
    expect(samplesAtStop).toBeGreaterThan(0);

    stopMemoryMonitoring();
    jest.advanceTimersByTime(10_000);

    expect(memoryManager.getSamples().length).toBe(samplesAtStop);
  });

  it("keeps sampling while started (no functional change to monitoring)", () => {
    startMemoryMonitoring({ sampleIntervalMs: 1_000 });
    const before = memoryManager.getSamples().length;

    jest.advanceTimersByTime(3_000);

    expect(memoryManager.getSamples().length).toBeGreaterThan(before);
  });

  it("is idempotent — restarting does not stack intervals", () => {
    const before = jest.getTimerCount();

    startMemoryMonitoring({ sampleIntervalMs: 1_000 });
    startMemoryMonitoring({ sampleIntervalMs: 1_000 });

    expect(jest.getTimerCount()).toBe(before + 1);
  });

  it("returns a cleanup function that clears the interval", () => {
    const before = jest.getTimerCount();

    const cleanup = startMemoryMonitoring({ sampleIntervalMs: 1_000 });
    expect(typeof cleanup).toBe("function");
    expect(jest.getTimerCount()).toBe(before + 1);

    cleanup();

    expect(jest.getTimerCount()).toBe(before);
  });

  it("is safe to stop when monitoring was never started", () => {
    const before = jest.getTimerCount();

    expect(() => stopMemoryMonitoring()).not.toThrow();
    expect(jest.getTimerCount()).toBe(before);
  });
});
