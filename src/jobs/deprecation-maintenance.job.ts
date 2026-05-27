/**
 * Deprecation Maintenance Job
 * 
 * Scheduled job to handle deprecation-related tasks:
 * - Send notifications for upcoming sunsets
 * - Send final warnings
 * - Log deprecation metrics
 * - Clean up sunset endpoints
 */

import deprecationManager from '../utils/deprecation.utils';
import deprecationNotificationService from '../services/deprecation-notification.service';
import { logInfo, logWarning } from '../utils/error.utils';
import { getUpcomingSunsets, getSunsetEndpoints } from '../config/deprecation-registry';

// Declare require for dynamic imports
declare const require: any;

class DeprecationMaintenanceJob {
  private jobs: Map<string, any> = new Map();

  /**
   * Initialize all deprecation maintenance jobs
   */
  initialize(): void {
    this.startDailyMetricsJob();
    this.startWeeklyNotificationJob();
    this.startFinalWarningJob();
    this.startSunsetCleanupJob();

    logInfo('Deprecation maintenance jobs initialized', {
      jobCount: this.jobs.size,
    });
  }

  /**
   * Daily job to log deprecation metrics
   * Runs at 2 AM UTC daily
   */
  private startDailyMetricsJob(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CronJob } = require('cron');
      const job = new CronJob('0 2 * * *', () => {
        this.logDeprecationMetrics();
      });

      job.start();
      this.jobs.set('daily-metrics', job);
      logInfo('Daily metrics job started');
    } catch (error) {
      logWarning('Failed to start daily metrics job', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Weekly job to send notifications for upcoming sunsets
   * Runs every Monday at 9 AM UTC
   */
  private startWeeklyNotificationJob(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CronJob } = require('cron');
      const job = new CronJob('0 9 * * 1', () => {
        this.sendUpcomingSunsetNotifications();
      });

      job.start();
      this.jobs.set('weekly-notifications', job);
      logInfo('Weekly notification job started');
    } catch (error) {
      logWarning('Failed to start weekly notification job', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Final warning job for endpoints about to sunset
   * Runs daily at 10 AM UTC
   */
  private startFinalWarningJob(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CronJob } = require('cron');
      const job = new CronJob('0 10 * * *', () => {
        this.sendFinalWarnings();
      });

      job.start();
      this.jobs.set('final-warnings', job);
      logInfo('Final warning job started');
    } catch (error) {
      logWarning('Failed to start final warning job', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Sunset cleanup job to remove endpoints past their sunset date
   * Runs daily at 3 AM UTC
   */
  private startSunsetCleanupJob(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CronJob } = require('cron');
      const job = new CronJob('0 3 * * *', () => {
        this.cleanupSunsetEndpoints();
      });

      job.start();
      this.jobs.set('sunset-cleanup', job);
      logInfo('Sunset cleanup job started');
    } catch (error) {
      logWarning('Failed to start sunset cleanup job', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Log deprecation metrics
   */
  private logDeprecationMetrics(): void {
    const status = deprecationManager.getDeprecationStatus();
    const deprecated = status.filter((s) => s.status === 'deprecated');
    const sunset = status.filter((s) => s.status === 'sunset');

    logInfo('Deprecation metrics', {
      totalDeprecated: deprecated.length,
      totalSunset: sunset.length,
      upcoming: getUpcomingSunsets().length,
      endpoints: status.map((s) => ({
        endpoint: s.endpoint,
        status: s.status,
        daysUntilSunset: s.daysUntilSunset,
      })),
    });
  }

  /**
   * Send notifications for upcoming sunsets
   */
  private async sendUpcomingSunsetNotifications(): Promise<void> {
    try {
      const upcoming = getUpcomingSunsets();

      if (upcoming.length === 0) {
        logInfo('No upcoming sunsets to notify');
        return;
      }

      logInfo(`Sending notifications for ${upcoming.length} upcoming sunsets`);

      // Get list of users to notify
      // This would typically query your database for active API users
      const recipients = await this.getNotificationRecipients();

      if (recipients.length === 0) {
        logWarning('No recipients found for deprecation notifications');
        return;
      }

      await deprecationNotificationService.sendUpcomingSunsetNotifications(recipients);

      logInfo(`Notifications sent to ${recipients.length} users`, {
        endpointCount: upcoming.length,
      });
    } catch (error) {
      logWarning('Failed to send upcoming sunset notifications', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Send final warnings for endpoints about to sunset
   */
  private async sendFinalWarnings(): Promise<void> {
    try {
      const upcoming = getUpcomingSunsets().filter((item) => {
        const deprecation = deprecationManager.getDeprecation(item.endpoint);
        if (!deprecation) return false;

        const daysUntilSunset = Math.ceil(
          (deprecation.sunsetDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );

        return daysUntilSunset <= 7;
      });

      if (upcoming.length === 0) {
        return;
      }

      logInfo(`Sending final warnings for ${upcoming.length} endpoints`);

      const recipients = await this.getNotificationRecipients();

      if (recipients.length === 0) {
        return;
      }

      await deprecationNotificationService.sendFinalWarnings(recipients);

      logInfo(`Final warnings sent to ${recipients.length} users`, {
        endpointCount: upcoming.length,
      });
    } catch (error) {
      logWarning('Failed to send final warnings', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Clean up sunset endpoints
   */
  private cleanupSunsetEndpoints(): void {
    try {
      const sunset = getSunsetEndpoints();

      if (sunset.length === 0) {
        return;
      }

      logInfo(`Cleaning up ${sunset.length} sunset endpoints`);

      for (const item of sunset) {
        // Log that endpoint is sunset
        logInfo(`Endpoint sunset: ${item.endpoint}`, {
          replacementEndpoint: item.replacementEndpoint,
        });

        // In production, you might want to:
        // 1. Archive endpoint configuration
        // 2. Update documentation
        // 3. Send final notification to remaining users
        // 4. Remove from active endpoints list
      }
    } catch (error) {
      logWarning('Failed to clean up sunset endpoints', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get list of users to notify about deprecations
   * This is a placeholder - implement based on your user system
   */
  private async getNotificationRecipients() {
    // TODO: Query your database for active API users
    // Example:
    // const users = await User.find({ apiAccessEnabled: true });
    // return users.map(u => ({
    //   userId: u.id,
    //   email: u.email,
    //   name: u.name,
    // }));

    return [];
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
}

export default new DeprecationMaintenanceJob();
