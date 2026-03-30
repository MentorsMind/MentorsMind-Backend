import { CronJob } from "cron";
import { AnalyticsService } from "../services/analytics.service";
import { logger } from "../utils/logger.utils";

/**
 * Refreshes analytics/reporting materialized views every hour.
 */
export class RefreshAnalyticsJob {
  private cronJob: CronJob | null = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn("Refresh analytics job already initialized");
      return;
    }

    this.cronJob = new CronJob("0 * * * *", async () => {
      await this.refreshNow();
    });

    this.cronJob.start();
    this.isInitialized = true;
    logger.info("Refresh analytics job initialized - runs hourly at minute 0");
  }

  async refreshNow(): Promise<void> {
    try {
      await AnalyticsService.refreshViews();
      logger.info("Analytics materialized views refreshed by cron");
    } catch (error) {
      logger.error("Failed to refresh analytics materialized views", { error });
    }
  }

  shutdown(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    this.isInitialized = false;
    logger.info("Refresh analytics job stopped");
  }
}

export const refreshAnalyticsJob = new RefreshAnalyticsJob();
