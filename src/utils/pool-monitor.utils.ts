import config from "../config";
import { getPoolStats } from "./database.utils";
import {
  dbPoolExhaustionAlertsTotal,
  dbPoolIdleConnections,
  dbPoolTotalConnections,
  dbPoolUtilizationPercent,
  dbPoolWaitingClients,
} from "../config/metrics";
import { logger } from "./logger.utils";

let monitorInterval: NodeJS.Timeout | null = null;
let lastExhaustionAlertAt = 0;
const ALERT_COOLDOWN_MS = 60_000;

export function updatePoolMetrics(): void {
  const stats = getPoolStats();
  const max = config.db.poolMax;
  const utilization = max > 0 ? Math.round((stats.totalCount / max) * 100) : 0;

  dbPoolTotalConnections.set(stats.totalCount);
  dbPoolIdleConnections.set(stats.idleCount);
  dbPoolWaitingClients.set(stats.waitingCount);
  dbPoolUtilizationPercent.set(utilization);

  const threshold = config.db.poolExhaustionThreshold;
  if (utilization >= threshold || stats.waitingCount > 0) {
    const now = Date.now();
    if (now - lastExhaustionAlertAt >= ALERT_COOLDOWN_MS) {
      lastExhaustionAlertAt = now;
      dbPoolExhaustionAlertsTotal.inc();
      logger.warn("Database connection pool under pressure", {
        utilizationPercent: utilization,
        thresholdPercent: threshold,
        totalCount: stats.totalCount,
        idleCount: stats.idleCount,
        waitingCount: stats.waitingCount,
        poolMax: max,
      });
    }
  }
}

export function startPoolMonitor(intervalMs = 15_000): void {
  if (monitorInterval) return;
  updatePoolMetrics();
  monitorInterval = setInterval(updatePoolMetrics, intervalMs);
  monitorInterval.unref?.();
}

export function stopPoolMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
