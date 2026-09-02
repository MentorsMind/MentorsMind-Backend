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

export function startMemoryMonitoring(options: MemoryMonitorOptions = {}): void {
  memoryManager.stop();
  memoryManager.configure(options);
  memoryManager.start();
}

export default memoryMonitorMiddleware;