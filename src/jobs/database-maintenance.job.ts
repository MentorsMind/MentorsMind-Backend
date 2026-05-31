/**
 * Database Maintenance Job
 *
 * Scheduled jobs for regular database maintenance:
 * - Weekly VACUUM
 * - Weekly ANALYZE
 * - Monthly index rebuild
 * - Weekly table bloat monitoring
 */

import databaseMaintenanceManager from "../utils/database-maintenance.utils";
import { logInfo, logWarning, logError } from "../utils/error.utils";

// Declare require for dynamic imports
declare const require: any;

class DatabaseMaintenanceJob {
  private jobs: Map<string, any> = new Map();

  /**
   * Initialize all database maintenance jobs
   */
  initialize(): void {
    this.startWeeklyVacuumJob();
    this.startWeeklyAnalyzeJob();
    this.startMonthlyIndexRebuildJob();
    this.startWeeklyBloatCheckJob();

    logInfo("Database maintenance jobs initialized", {
      jobCount: this.jobs.size,
    });
  }

  /**
   * Weekly VACUUM job
   * Runs every Sunday at 2 AM UTC
   */
  private startWeeklyVacuumJob(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 2 * * 0", async () => {
        await this.executeVacuum();
      });

      job.start();
      this.jobs.set("weekly-vacuum", job);
      logInfo("Weekly VACUUM job started (Sunday 2 AM UTC)");
    } catch (error) {
      logWarning("Failed to start weekly VACUUM job", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Weekly ANALYZE job
   * Runs every Sunday at 3 AM UTC
   */
  private startWeeklyAnalyzeJob(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 3 * * 0", async () => {
        await this.executeAnalyze();
      });

      job.start();
      this.jobs.set("weekly-analyze", job);
      logInfo("Weekly ANALYZE job started (Sunday 3 AM UTC)");
    } catch (error) {
      logWarning("Failed to start weekly ANALYZE job", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Monthly index rebuild job
   * Runs on the first Sunday of each month at 4 AM UTC
   */
  private startMonthlyIndexRebuildJob(): void {
    try {
      const { CronJob } = require("cron");
      // First Sunday of month: 0 4 1-7 * 0
      const job = new CronJob("0 4 1-7 * 0", async () => {
        await this.executeIndexRebuild();
      });

      job.start();
      this.jobs.set("monthly-index-rebuild", job);
      logInfo(
        "Monthly index rebuild job started (First Sunday of month at 4 AM UTC)",
      );
    } catch (error) {
      logWarning("Failed to start monthly index rebuild job", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Weekly table bloat check job
   * Runs every Monday at 1 AM UTC
   */
  private startWeeklyBloatCheckJob(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 1 * * 1", async () => {
        await this.executeBloatCheck();
      });

      job.start();
      this.jobs.set("weekly-bloat-check", job);
      logInfo("Weekly bloat check job started (Monday 1 AM UTC)");
    } catch (error) {
      logWarning("Failed to start weekly bloat check job", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Execute VACUUM operation
   */
  private async executeVacuum(): Promise<void> {
    try {
      logInfo("Executing scheduled VACUUM operation");
      const stats = await databaseMaintenanceManager.runVacuum(false);
      logInfo("Scheduled VACUUM completed", {
        duration: stats.duration,
        status: stats.status,
      });
    } catch (error) {
      logError(error as Error, "high", {
        operation: "scheduled_vacuum",
      });
    }
  }

  /**
   * Execute ANALYZE operation
   */
  private async executeAnalyze(): Promise<void> {
    try {
      logInfo("Executing scheduled ANALYZE operation");
      const stats = await databaseMaintenanceManager.runAnalyze();
      logInfo("Scheduled ANALYZE completed", {
        duration: stats.duration,
        status: stats.status,
      });
    } catch (error) {
      logError(error as Error, "high", {
        operation: "scheduled_analyze",
      });
    }
  }

  /**
   * Execute index rebuild operation
   */
  private async executeIndexRebuild(): Promise<void> {
    try {
      logInfo("Executing scheduled index rebuild operation");
      const stats = await databaseMaintenanceManager.rebuildFragmentedIndexes();
      logInfo("Scheduled index rebuild completed", {
        duration: stats.duration,
        status: stats.status,
        details: stats.details,
      });
    } catch (error) {
      logError(error as Error, "high", {
        operation: "scheduled_index_rebuild",
      });
    }
  }

  /**
   * Execute table bloat check operation
   */
  private async executeBloatCheck(): Promise<void> {
    try {
      logInfo("Executing scheduled table bloat check");
      const stats = await databaseMaintenanceManager.checkTableBloat();
      logInfo("Scheduled bloat check completed", {
        duration: stats.duration,
        status: stats.status,
        details: stats.details,
      });
    } catch (error) {
      logError(error as Error, "high", {
        operation: "scheduled_bloat_check",
      });
    }
  }

  /**
   * Stop all jobs
   */
  stopAll(): void {
    for (const [name, job] of this.jobs) {
      job.stop();
      logInfo(`Stopped job: ${name}`);
    }
    this.jobs.clear();
  }

  /**
   * Get job status
   */
  getStatus() {
    return Array.from(this.jobs.entries()).map(([name, job]) => ({
      name,
      running: job.running,
      nextDate: job.nextDate().toISOString(),
    }));
  }

  /**
   * Manually trigger maintenance operations
   */
  async triggerVacuum(): Promise<any> {
    return databaseMaintenanceManager.runVacuum(false);
  }

  async triggerAnalyze(): Promise<any> {
    return databaseMaintenanceManager.runAnalyze();
  }

  async triggerIndexRebuild(): Promise<any> {
    return databaseMaintenanceManager.rebuildFragmentedIndexes();
  }

  async triggerBloatCheck(): Promise<any> {
    return databaseMaintenanceManager.checkTableBloat();
  }

  async triggerFullCycle(): Promise<any> {
    return databaseMaintenanceManager.runFullMaintenanceCycle();
  }
}

export default new DatabaseMaintenanceJob();
