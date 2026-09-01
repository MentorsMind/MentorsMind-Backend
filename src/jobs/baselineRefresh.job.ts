/**
 * Baseline Refresh Job
 *
 * Nightly job that refreshes the Redis-backed rolling baselines consumed by
 * MlSecurityService.scoreDeviationForUser() (via BaselineStore). Recomputes
 * each active user's per-day distinct-IP counts over the trailing 30 days
 * from access_risk_log and writes them into Redis, so scoring stays off the
 * request hot path (see threat-detection.service.ts).
 *
 * Runs daily at 02:00 UTC.
 *
 * Part of issue #1001 "Replace Heuristic ML Security Scoring with Baseline
 * Learning".
 */

import { AccessRiskModel } from "../models/access-risk.model";
import { BaselineStore } from "../services/baseline-store.service";
import { logger } from "../utils/logger";

const BASELINE_WINDOW_DAYS = 30;

export interface BaselineRefreshResult {
  elapsedMs: number;
  usersProcessed: number;
  daysWritten: number;
  errors: number;
}

/** Main entry point — called by the scheduler. */
export async function runBaselineRefresh(): Promise<BaselineRefreshResult> {
  const startTime = Date.now();
  let usersProcessed = 0;
  let daysWritten = 0;
  let errors = 0;

  logger.info("[BaselineRefresh] Starting nightly baseline refresh job");

  try {
    const userIds = await AccessRiskModel.getUserIdsWithRecentActivity(
      BASELINE_WINDOW_DAYS,
    );

    for (const userId of userIds) {
      try {
        const dailyCounts = await AccessRiskModel.getDailyDistinctIpCounts(
          userId,
          BASELINE_WINDOW_DAYS,
        );

        for (const { day, count } of dailyCounts) {
          await BaselineStore.recordDailyCount(userId, new Date(day), count);
          daysWritten++;
        }

        usersProcessed++;
      } catch (err) {
        errors++;
        logger.error("[BaselineRefresh] Error refreshing baseline for user", {
          userId,
          error: (err as Error).message,
        });
      }
    }

    const elapsedMs = Date.now() - startTime;
    logger.info("[BaselineRefresh] Completed", {
      elapsedMs,
      usersProcessed,
      daysWritten,
      errors,
    });

    return { elapsedMs, usersProcessed, daysWritten, errors };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    logger.error("[BaselineRefresh] Fatal error", {
      error: (err as Error).message,
      elapsedMs,
    });
    throw err;
  }
}

class BaselineRefreshJob {
  private job: import("cron").CronJob | null = null;

  initialize(): void {
    if (this.job) {
      logger.warn("Baseline refresh job already initialized");
      return;
    }

    try {
      const { CronJob } = require("cron");
      this.job = new CronJob("0 2 * * *", async () => {
        try {
          await runBaselineRefresh();
        } catch (error) {
          logger.error("Baseline refresh job run failed", {
            error: (error as Error).message,
          });
        }
      });

      this.job.start();
      logger.info("Baseline refresh job started (daily at 2 AM UTC)");
    } catch (error) {
      logger.warn("Failed to start baseline refresh job", {
        error: (error as Error).message,
      });
    }
  }

  stop(): void {
    this.job?.stop();
    this.job = null;
  }
}

const baselineRefreshJob = new BaselineRefreshJob();
export default baselineRefreshJob;
