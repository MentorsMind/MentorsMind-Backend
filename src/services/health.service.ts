import { db } from "../config/database";
import { server } from "../config/stellar";
import config from "../config";
import { redisConfig } from "../config/redis.config";
import { CacheService } from "./cache.service";
import { JwksService } from "./jwks.service";
import { OracleService } from "./oracle.service";
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
    analyticsViews?: HealthComponent;
    system?: HealthComponent;
    jwks?: HealthComponent;
    verificationContract?: HealthComponent;
    oracle?: HealthComponent;
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
    lastError: string | null;
  } | null = null;

  private static readonly HEALTHY_CACHE_TTL_MS = 5000;
  private static readonly UNHEALTHY_CACHE_TTL_MS = 1000;

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
   * Cached briefly to prevent hammering while still detecting recovery quickly.
   */
  static async checkReadiness(): Promise<DetailedHealthStatus> {
    const now = Date.now();
    if (
      this.readinessCache &&
      now - this.readinessCache.timestamp <
        this.getCacheTtl(this.readinessCache.status)
    ) {
      return this.readinessCache.status;
    }

    let status: DetailedHealthStatus;
    try {
      status = await this.performFullCheck();
    } catch (err: any) {
      const lastError = err instanceof Error ? err.message : String(err);
      logger.error("Readiness check threw an exception", { error: lastError });
      return this.createUnhandledErrorStatus(lastError);
    }

    this.readinessCache = {
      status,
      timestamp: now,
      lastError: this.getHealthStatusError(status),
    };

    return status;
  }

  private static getCacheTtl(status: DetailedHealthStatus): number {
    return status.status === "unhealthy"
      ? this.UNHEALTHY_CACHE_TTL_MS
      : this.HEALTHY_CACHE_TTL_MS;
  }

  private static getHealthStatusError(
    status: DetailedHealthStatus,
  ): string | null {
    if (status.status === "healthy") {
      return null;
    }

    return (
      Object.entries(status.components)
        .map(([name, component]) =>
          component.error ? `${name}: ${component.error}` : undefined,
        )
        .find((error): error is string => Boolean(error)) ?? null
    );
  }

  private static createUnhandledErrorStatus(
    error: string,
  ): DetailedHealthStatus {
    const failedComponent: HealthComponent = {
      status: "unhealthy",
      error,
    };

    return {
      status: "unhealthy",
      components: {
        db: failedComponent,
        redis: failedComponent,
        horizon: failedComponent,
        queues: failedComponent,
        system: this.getSystemInfo(),
      },
      uptime: process.uptime(),
      version: config.server.apiVersion || CURRENT_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Internal full health check
   */
  private static async performFullCheck(): Promise<DetailedHealthStatus> {
    const [
      dbCheck,
      redisCheck,
      horizonCheck,
      queueCheck,
      tablesCheck,
      analyticsViewsCheck,
      jwksCheck,
      verificationContractCheck,
      oracleCheck,
    ] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkHorizon(),
      this.checkBullMQ(),
      this.checkDatabaseTables(),
      this.checkAnalyticsViews(),
      this.checkJwks(),
      this.checkVerificationContract(),
      this.checkOracle(),
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
        analyticsViews: analyticsViewsCheck,
        system: this.getSystemInfo(),
        jwks: jwksCheck,
        verificationContract: verificationContractCheck,
        oracle: oracleCheck,
      },
      uptime: process.uptime(),
      version: config.server.apiVersion || CURRENT_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reports whether the Soroban oracle contract is available.
   *
   * - "healthy"  – oracle is configured and serving fresh prices.
   * - "degraded" – oracle circuit-breaker triggered; service is using
   *                last-known-good prices (up to 10 min old).  Ops should
   *                investigate feeder availability or STALE_SECS threshold.
   * - "healthy"  – oracle is not configured (optional component).
   */
  private static async checkOracle(): Promise<HealthComponent> {
    if (!OracleService.isConfigured()) {
      return {
        status: "healthy",
        details: { configured: false },
      };
    }

    if (OracleService.isDegraded) {
      return {
        status: "degraded",
        error: OracleService.degradedReason || "Oracle circuit-breaker open",
        details: {
          configured: true,
          usingLastKnownGood: true,
          lkgMaxStalenessMs: 10 * 60 * 1000,
        },
      };
    }

    return {
      status: "healthy",
      details: { configured: true, usingLastKnownGood: false },
    };
  }

  /**
   * Reports how many mentor verifications are stuck waiting on an on-chain
   * transaction (on_chain_pending = true). Degraded once the retry job's
   * backoff-eligible count grows, which usually means SOROBAN_RPC_URL is
   * unreachable or the verification contract is rejecting submissions
   * (issue #768).
   */
  private static async checkVerificationContract(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      const { rows } = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE on_chain_pending = TRUE) AS count,
           COUNT(*) FILTER (WHERE on_chain_pending = TRUE AND retry_count >= 3) AS retrying
         FROM mentor_verifications`,
      );
      const pendingCount = parseInt(rows[0]?.count ?? "0", 10);
      const escalatedCount = parseInt(rows[0]?.retrying ?? "0", 10);

      return {
        status: escalatedCount > 0 ? "degraded" : "healthy",
        responseTimeMs: Date.now() - start,
        details: { pendingCount, escalatedCount },
      };
    } catch (err: any) {
      return {
        status: "unhealthy",
        responseTimeMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  private static async checkDatabase(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      await db.query("SELECT 1");
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

  private static async checkAnalyticsViews(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      const requiredViews = [
        "mv_daily_revenue",
        "mv_daily_users",
        "mv_session_stats",
        "mv_top_mentors",
        "mv_asset_distribution",
        "mv_revenue_time_series",
        "mv_hourly_session_demand",
      ];

      const query = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'MATERIALIZED VIEW'
          AND table_name = ANY($1::text[])
      `;

      const { rows } = await db.query(query, [requiredViews]);
      const foundViews = rows.map((r: any) => r.table_name);
      const allExist = requiredViews.every((v) => foundViews.includes(v));
      const responseTimeMs = Date.now() - start;

      if (allExist) {
        return {
          status: "healthy",
          responseTimeMs,
          details: { totalViews: requiredViews.length },
        };
      }

      const missing = requiredViews.filter((v) => !foundViews.includes(v));
      return {
        status: "degraded",
        responseTimeMs,
        error: `Missing ${missing.length} analytics view(s)`,
        details: {
          missingViews: missing,
          totalViews: requiredViews.length,
          message: "Run migrations 015_analytics_views.sql and 102_create_forecasting_views.sql to create analytics views",
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

  private static async checkJwks(): Promise<HealthComponent> {
    const start = Date.now();
    try {
      const rotationStatus = await JwksService.getRotationStatus();
      const currentKey = await JwksService.getCurrentKey();
      
      return {
        status: "healthy",
        responseTimeMs: Date.now() - start,
        details: {
          ...rotationStatus,
          hasCurrentKey: !!currentKey,
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
