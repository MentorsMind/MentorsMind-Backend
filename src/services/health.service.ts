import pool from "../config/database";
import { server } from "../config/stellar";
import config from "../config";
import { redisConfig } from "../config/redis.config";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { CURRENT_VERSION } from "../config/api-versions.config";
import { validateRequiredTables } from "../utils/table-validator.utils";
import * as os from "node:os";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthComponent {
  status: HealthStatus;
  responseTimeMs?: number;
  error?: string;
  details?: Record<string, any>;
}

export interface DetailedHealthStatus {
  status: HealthStatus;
  components: {
    db: HealthComponent;
    redis: HealthComponent;
    horizon: HealthComponent;
    queues: HealthComponent;
    tables?: HealthComponent;
    system?: HealthComponent;
  };
  uptime: number;
  version: string;
  timestamp: string;
}

// ─── Health Service ───────────────────────────────────────────────────────────

export class HealthService {
  private static readinessCache: {
    status: DetailedHealthStatus;
    timestamp: number;
  } | null = null;

  private static readonly CACHE_TTL_MS = 5000;

  /**
   * GET /health/live
   * Basic liveness check - returns true if the process is alive.
   */
  static isLive(): boolean {
    return true;
  }

  /**
   * GET /health/ready
   * Readiness probe - checks critical dependencies.
   * Cached for 5 seconds to prevent hammering.
   */
  static async checkReadiness(): Promise<DetailedHealthStatus> {
    const now = Date.now();
    if (
      this.readinessCache &&
      now - this.readinessCache.timestamp < this.CACHE_TTL_MS
    ) {
      return this.readinessCache.status;
    }

    const status = await this.performFullCheck();
    this.readinessCache = {
      status,
      timestamp: now,
    };

    return status;
  }

  /**
   * Internal full health check
   */
  private static async performFullCheck(): Promise<DetailedHealthStatus> {
    const [dbCheck, redisCheck, horizonCheck, queueCheck, tablesCheck] =
      await Promise.all([
        this.checkDatabase(),
        this.checkRedis(),
        this.checkHorizon(),
        this.checkBullMQ(),
        this.checkDatabaseTables(),
      ]);

    // Critical components for readiness: all must not be 'unhealthy'
    const criticalComponents = [dbCheck, redisCheck, horizonCheck];
    const isUnhealthy = criticalComponents.some(
      (c) => c.status === "unhealthy",
    );
    const isDegraded =
      !isUnhealthy && criticalComponents.some((c) => c.status === "degraded");

    const status: HealthStatus = isUnhealthy
      ? "unhealthy"
      : isDegraded
        ? "degraded"
        : "healthy";

    if (status !== "healthy") {
      logger.warn("Health check failed or degraded", {
        status,
        db: dbCheck.status,
        redis: redisCheck.status,
        horizon: horizonCheck.status,
      });
    }

    return {
      status,
      components: {
        db: dbCheck,
        redis: redisCheck,
        horizon: horizonCheck,
        queues: queueCheck,
        tables: tablesCheck,
        system: this.getSystemInfo(),
      },
      uptime: process.uptime(),
      version: config.server.apiVersion || CURRENT_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  private static async checkDatabase(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      await pool.query("SELECT 1");
      return { status: "healthy", responseTimeMs: Date.now() - start };
    } catch (err: any) {
      return {
        status: "unhealthy",
        responseTimeMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  private static async checkDatabaseTables(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      const validation = await validateRequiredTables();
      const responseTimeMs = Date.now() - start;

      if (validation.allTablesExist) {
        return {
          status: "healthy",
          responseTimeMs,
          details: { totalTables: validation.totalTables },
        };
      }

      return {
        status: "unhealthy",
        responseTimeMs,
        error: `Missing ${validation.missingTables.length} required table(s)`,
        details: {
          missingTables: validation.missingTables,
          totalTables: validation.totalTables,
        },
      };
    } catch (err: any) {
      return {
        status: "unhealthy",
        responseTimeMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  private static async checkRedis(): Promise<HealthComponent> {
    const start = Date.now();

    if (!redisConfig.url) {
      return { status: "degraded", error: "Redis URL not configured" };
    }

    if (!CacheService.isDistributed()) {
      return { status: "degraded", error: "Redis shared client not connected" };
    }

    try {
      // Ping via the shared client — no new connection created
      await CacheService.ping();
      return { status: "healthy", responseTimeMs: Date.now() - start };
    } catch (err: any) {
      return {
        status: "unhealthy",
        responseTimeMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  private static async checkBullMQ(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      const { emailQueue } = await import("../queues/email.queue");
      const counts = await emailQueue.getJobCounts(
        "active",
        "waiting",
        "completed",
        "failed",
      );
      if (counts.failed > 100) {
        return {
          status: "degraded",
          responseTimeMs: Date.now() - start,
          details: {
            emailQueueFailed: counts.failed,
            active: counts.active,
            waiting: counts.waiting,
          },
        };
      }
      return {
        status: "healthy",
        responseTimeMs: Date.now() - start,
        details: {
          active: counts.active,
          waiting: counts.waiting,
          failed: counts.failed,
        },
      };
    } catch (err: any) {
      return {
        status: "degraded",
        responseTimeMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  private static async checkHorizon(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      await server.ledgers().limit(1).call();
      return { status: "healthy", responseTimeMs: Date.now() - start };
    } catch (err: any) {
      return {
        status: "degraded",
        responseTimeMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  private static getSystemInfo(): HealthComponent {
    return {
      status: "healthy",
      details: {
        memory: process.memoryUsage(),
        cpu: os.loadavg(),
        freeMem: os.freemem(),
        totalMem: os.totalmem(),
      },
    };
  }

  /**
   * Returns a simplified health object as requested.
   */
  static async getSimplifiedStatus(): Promise<any> {
    const status = await this.checkReadiness();
    return {
      stellar: status.components.horizon.status === "healthy" ? "OK" : "DOWN",
      redis: status.components.redis.status === "healthy" ? "OK" : "DOWN",
      queues: {
        active: status.components.queues.details?.active ?? 0,
      },
    };
  }

  static async initialize(): Promise<void> {
    logger.info("HealthService initialized");
  }
}

export default HealthService;
