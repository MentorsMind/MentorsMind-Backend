import { Request, Response, NextFunction } from "express";
import { memoryManager, MemoryManagerOptions } from "../services/memory-manager.service";

export interface MemoryMonitorOptions extends MemoryManagerOptions {
  includeRequestPath?: boolean;
}

export function memoryMonitorMiddleware(options: MemoryMonitorOptions = {}) {
  const includeRequestPath = options.includeRequestPath ?? false;
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.memoryUsage().heapUsed;
    res.on("finish", () => {
      const end = process.memoryUsage().heapUsed;
      memoryManager.snapshot();
      if (end - start > 10 * 1024 * 1024) {
        const path = includeRequestPath ? ` on ${req.method} ${req.path}` : "";
        process.emitWarning(`Large request heap delta${path}: ${end - start} bytes`, {
          name: "MemoryPressureWarning",
        });
      }
    });
    next();
  };
}

export function memoryDashboardHandler(_req: Request, res: Response): void {
  res.json({ status: "ok", data: memoryManager.getAnalytics() });
}

export function memoryDashboardMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === "GET" && (req.path === "/memory" || req.path === "/memory/analytics")) {
      memoryDashboardHandler(req, res);
      return;
    }
    next();
  };
}

// Module-level interval handle so SIGTERM/graceful shutdown can clear it —
// same pattern as startPoolMonitor/stopPoolMonitor (issue #1077).
// Default matches MemoryManagerService's sampleIntervalMs default.
const DEFAULT_SAMPLE_INTERVAL_MS = 30_000;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic memory sampling. Idempotent — repeated calls do not stack
 * additional intervals.
 *
 * @returns cleanup function that clears the sampling interval (same as
 *          calling `stopMemoryMonitoring()`).
 */
export function startMemoryMonitoring(
  options: MemoryMonitorOptions = {},
): () => void {
  stopMemoryMonitoring();
  memoryManager.configure(options);
  memoryManager.snapshot();
  const intervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  monitorInterval = setInterval(() => {
    memoryManager.snapshot();
  }, intervalMs);
  monitorInterval.unref?.();
  return stopMemoryMonitoring;
}

/**
 * Stop periodic memory sampling and clear the interval. Safe to call when
 * monitoring was never started or is already stopped.
 */
export function stopMemoryMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  // Also clear the manager's own interval in case it was started elsewhere.
  memoryManager.stop();
}

export default memoryMonitorMiddleware;