/**
 * Deprecation Maintenance Job
 *
 * Scheduled job to handle deprecation-related tasks:
 * - Send notifications for upcoming sunsets
 * - Send final warnings
 * - Log deprecation metrics
 * - Clean up sunset endpoints
 */

import pool from "../config/database";
import deprecationManager from "../utils/deprecation.utils";
import deprecationNotificationService from "../services/deprecation-notification.service";
import { emailService } from "../services/email.service";
import { logInfo, logWarning } from "../utils/error.utils";
import {
  getDeprecatedEndpoints,
  getUpcomingSunsets,
  getSunsetEndpoints,
} from "../config/deprecation-registry";

// Declare require for dynamic imports
declare const require: any;

interface ActiveApiRecipient {
  userId: string;
  email: string;
  name: string;
  apiKeyId: string | null;
  apiVersion: string;
  endpointsUsed: string[];
  callCount: number;
  lastSeenAt: Date;
  apiKeyName?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

    logInfo("Deprecation maintenance jobs initialized", {
      jobCount: this.jobs.size,
    });
  }

  /**
   * Daily job to log deprecation metrics
   * Runs at 2 AM UTC daily
   */
  private startDailyMetricsJob(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 2 * * *", () => {
        this.logDeprecationMetrics();
      });

      job.start();
      this.jobs.set("daily-metrics", job);
      logInfo("Daily metrics job started");
    } catch (error) {
      logWarning("Failed to start daily metrics job", {
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
      const { CronJob } = require("cron");
      const job = new CronJob("0 9 * * 1", () => {
        void this.sendUpcomingSunsetNotifications().catch((error) => {
          logWarning("Failed to send upcoming sunset notifications", {
            error: (error as Error).message,
          });
        });
      });

      job.start();
      this.jobs.set("weekly-notifications", job);
      logInfo("Weekly notification job started");
    } catch (error) {
      logWarning("Failed to start weekly notification job", {
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
      const { CronJob } = require("cron");
      const job = new CronJob("0 10 * * *", () => {
        void this.sendFinalWarnings().catch((error) => {
          logWarning("Failed to send final warnings", {
            error: (error as Error).message,
          });
        });
      });

      job.start();
      this.jobs.set("final-warnings", job);
      logInfo("Final warning job started");
    } catch (error) {
      logWarning("Failed to start final warning job", {
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
      const { CronJob } = require("cron");
      const job = new CronJob("0 3 * * *", () => {
        this.cleanupSunsetEndpoints();
      });

      job.start();
      this.jobs.set("sunset-cleanup", job);
      logInfo("Sunset cleanup job started");
    } catch (error) {
      logWarning("Failed to start sunset cleanup job", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Log deprecation metrics
   */
  private logDeprecationMetrics(): void {
    const status = deprecationManager.getDeprecationStatus();
    const deprecated = status.filter((s) => s.status === "deprecated");
    const sunset = status.filter((s) => s.status === "sunset");

    logInfo("Deprecation metrics", {
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
  private async sendUpcomingSunsetNotifications(): Promise<{
    headers: { "X-Deprecation-Notice": "Sent" };
    sentCount: number;
    skippedCount: number;
  }> {
    const upcoming = getUpcomingSunsets();
    if (upcoming.length === 0) {
      logInfo("No upcoming sunsets to notify");
      return {
        headers: { "X-Deprecation-Notice": "Sent" },
        sentCount: 0,
        skippedCount: 0,
      };
    }

    const recipients = await this.getNotificationRecipients();
    if (recipients.length === 0) {
      logWarning("No recipients found for deprecation notifications");
      return {
        headers: { "X-Deprecation-Notice": "Sent" },
        sentCount: 0,
        skippedCount: 0,
      };
    }

    const deprecations = new Map(
      getDeprecatedEndpoints().map((entry) => [entry.endpoint, entry]),
    );

    let sentCount = 0;
    let skippedCount = 0;

    for (const recipient of recipients) {
      const matched = recipient.endpointsUsed
        .map((endpoint) => deprecations.get(endpoint))
        .filter(
          (
            entry,
          ): entry is {
            endpoint: string;
            sunsetDate: Date;
            migrationGuide?: string;
          } => Boolean(entry),
        );

      if (matched.length === 0) {
        skippedCount++;
        continue;
      }

      const template = this.buildDeprecationEmail(recipient, matched);
      const sendResult = await emailService.sendEmail({
        to: [recipient.email],
        subject: template.subject,
        htmlContent: template.html,
        textContent: template.text,
      });

      if (!sendResult.success) {
        skippedCount++;
        logWarning("Failed to send deprecation notification email", {
          userId: recipient.userId,
          apiKeyId: recipient.apiKeyId,
          error: sendResult.error,
        });
        continue;
      }

      await this.recordNotificationSend(recipient, matched);
      sentCount++;
    }

    logInfo("Deprecation notification sweep completed", {
      sentCount,
      skippedCount,
      recipientCount: recipients.length,
      endpointCount: upcoming.length,
      headers: { "X-Deprecation-Notice": "Sent" },
    });

    return {
      headers: { "X-Deprecation-Notice": "Sent" },
      sentCount,
      skippedCount,
    };
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
          (deprecation.sunsetDate.getTime() - new Date().getTime()) /
            (1000 * 60 * 60 * 24),
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
      logWarning("Failed to send final warnings", {
        error: (error as Error).message,
      });
    }
  }

  private buildDeprecationEmail(
    recipient: ActiveApiRecipient,
    endpoints: Array<{ endpoint: string; sunsetDate: Date; migrationGuide?: string }>,
  ): { subject: string; html: string; text: string } {
    const endpointList = endpoints
      .map((item) => {
        const guide = item.migrationGuide
          ? `<a href="${item.migrationGuide}">${item.migrationGuide}</a>`
          : "No migration guide provided";
        return `
          <li>
            <strong>${escapeHtml(item.endpoint)}</strong>
            <div>Sunset: ${item.sunsetDate.toISOString()}</div>
            <div>Guide: ${guide}</div>
          </li>
        `;
      })
      .join("");

    const textEndpoints = endpoints
      .map((item) => {
        return [
          `- ${item.endpoint}`,
          `  Sunset: ${item.sunsetDate.toISOString()}`,
          `  Guide: ${item.migrationGuide ?? "No migration guide provided"}`,
        ].join("\n");
      })
      .join("\n");

    const subject = `Action required: migrate away from deprecated API ${recipient.apiVersion}`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <h2>API deprecation notice</h2>
        <p>We found ${recipient.callCount} calls to deprecated API ${recipient.apiVersion} endpoints in the last 30 days.</p>
        <p><strong>Recipient:</strong> ${escapeHtml(recipient.name)} (${escapeHtml(recipient.email)})</p>
        <p><strong>API key:</strong> ${escapeHtml(recipient.apiKeyName ?? recipient.apiKeyId ?? "human user")}</p>
        <h3>Deprecated endpoints used</h3>
        <ul>${endpointList}</ul>
        <p>Please migrate before the sunset dates above to avoid broken integrations.</p>
      </div>
    `;

    const text = [
      subject,
      "",
      `We found ${recipient.callCount} calls to deprecated API ${recipient.apiVersion} endpoints in the last 30 days.`,
      `Recipient: ${recipient.name} <${recipient.email}>`,
      `API key: ${recipient.apiKeyName ?? recipient.apiKeyId ?? "human user"}`,
      "",
      "Deprecated endpoints used:",
      textEndpoints,
    ].join("\n");

    return { subject, html, text };
  }

  private async recordNotificationSend(
    recipient: ActiveApiRecipient,
    endpoints: Array<{ endpoint: string; sunsetDate: Date; migrationGuide?: string }>,
  ): Promise<void> {
    const endpointNames = endpoints.map((item) => item.endpoint);
    await pool.query(
      `
        INSERT INTO deprecation_notifications (
          user_id,
          api_key_id,
          api_version,
          endpoint_count,
          endpoints_used,
          call_count,
          last_seen_at,
          email_address,
          sent_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
      [
        recipient.userId,
        recipient.apiKeyId,
        recipient.apiVersion,
        endpointNames.length,
        JSON.stringify(endpointNames),
        recipient.callCount,
        recipient.lastSeenAt,
        recipient.email,
      ],
    );
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
      logWarning("Failed to clean up sunset endpoints", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get list of users to notify about deprecations
   * This is a placeholder - implement based on your user system
   */
  private async getNotificationRecipients(): Promise<ActiveApiRecipient[]> {
    const { rows } = await pool.query<{
      user_id: string;
      api_key_id: string | null;
      api_key_name: string | null;
      endpoint_count: string;
      call_count: string;
      last_seen_at: Date | string;
      endpoints_used: string[];
      email: string;
      name: string;
    }>(
      `
        WITH api_usage AS (
          SELECT
            al.user_id,
            NULLIF(al.metadata->>'apiKeyId', '')::uuid AS api_key_id,
            COALESCE(
              NULLIF(al.metadata->>'endpoint', ''),
              NULLIF(al.resource_id, ''),
              NULLIF(al.metadata->>'path', ''),
              NULLIF(al.metadata->>'route', ''),
              'unknown'
            ) AS endpoint_name,
            al.created_at
          FROM audit_logs al
          WHERE al.action = 'API_REQUEST'
            AND al.metadata->>'apiVersion' = 'v1'
            AND al.created_at >= NOW() - INTERVAL '30 days'
            AND al.user_id IS NOT NULL
        ),
        grouped AS (
          SELECT
            user_id,
            api_key_id,
            COUNT(*)::text AS call_count,
            COUNT(DISTINCT endpoint_name)::text AS endpoint_count,
            ARRAY_AGG(DISTINCT endpoint_name) AS endpoints_used,
            MAX(created_at) AS last_seen_at
          FROM api_usage
          GROUP BY user_id, api_key_id
        )
        SELECT
          g.user_id,
          g.api_key_id,
          g.call_count,
          g.endpoint_count,
          g.endpoints_used,
          g.last_seen_at,
          u.email,
          CONCAT_WS(' ', u.first_name, u.last_name) AS name,
          ak.name AS api_key_name
        FROM grouped g
        JOIN users u ON u.id = g.user_id
        LEFT JOIN integration_api_keys ak ON ak.id = g.api_key_id
        WHERE NOT EXISTS (
          SELECT 1
          FROM deprecation_notifications dn
          WHERE dn.user_id = g.user_id
            AND COALESCE(dn.api_key_id::text, '') = COALESCE(g.api_key_id::text, '')
            AND dn.api_version = 'v1'
            AND dn.sent_at >= NOW() - INTERVAL '14 days'
        )
        ORDER BY g.last_seen_at DESC
      `,
    );

    return rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      name: row.name || row.email,
      apiKeyId: row.api_key_id,
      apiVersion: "v1",
      endpointsUsed: row.endpoints_used || [],
      callCount: Number(row.call_count) || 0,
      lastSeenAt: new Date(row.last_seen_at),
      apiKeyName: row.api_key_name,
    }));
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
      nextDate: (() => {
        const nextDate = job.nextDate?.();
        if (!nextDate) {
          return null;
        }
        if (typeof nextDate.toISOString === "function") {
          return nextDate.toISOString();
        }
        if (typeof nextDate.toISO === "function") {
          return nextDate.toISO();
        }
        return String(nextDate);
      })(),
    }));
  }
}

export default new DeprecationMaintenanceJob();
