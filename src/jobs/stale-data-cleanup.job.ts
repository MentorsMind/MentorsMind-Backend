/**
 * Stale Data Cleanup Job
 *
 * Weekly cleanup for stale rows in operational tables.
 * Runs every Sunday at 03:30 UTC.
 */

import pool from "../config/database";
import { env } from "../config/env";
import type { PoolClient } from "pg";
import { logError, logInfo, logWarning } from "../utils/error.utils";

declare const require: any;

interface CleanupOperationResult {
  table: string;
  rowsDeleted: number;
  durationMs: number;
  dryRun: boolean;
  status: "success" | "skipped" | "failed";
  details: Record<string, unknown>;
}

interface CleanupRunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  operations: CleanupOperationResult[];
  headers: {
    "X-Deprecation-Notice": "Sent";
  };
}

const BATCH_SIZE = 1000;
const BATCH_PAUSE_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retentionDays(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function countRows(
  sql: string,
  values: unknown[] = [],
): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(sql, values);
  return Number(rows[0]?.count ?? 0);
}

async function withLockTimeout<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET lock_timeout = '5s'");
    return await callback(client);
  } finally {
    client.release();
  }
}

class StaleDataCleanupJob {
  private job: any;

  initialize(): void {
    this.startWeeklyCleanupJob();
    logInfo("Stale data cleanup job initialized");
  }

  private startWeeklyCleanupJob(): void {
    try {
      const { CronJob } = require("cron");
      this.job = new CronJob("30 3 * * 0", () => {
        void this.run().catch((error) => {
          logError(error as Error, "high", {
            operation: "weekly_stale_data_cleanup",
          });
        });
      });
      this.job.start();
      logInfo("Weekly stale data cleanup job started (Sunday 03:30 UTC)");
    } catch (error) {
      logWarning("Failed to start stale data cleanup job", {
        error: (error as Error).message,
      });
    }
  }

  private async runAuditLogCleanup(
    dryRun: boolean,
  ): Promise<CleanupOperationResult> {
    const startedAt = Date.now();
    const auditRetentionDays = retentionDays(
      env.AUDIT_LOG_RETENTION_DAYS,
      365,
    );
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - auditRetentionDays);

    try {
      const estimatedRows = await countRows(
        `SELECT COUNT(*)::text AS count FROM audit_logs WHERE created_at < $1`,
        [cutoff],
      );

      if (dryRun) {
        const durationMs = Date.now() - startedAt;
        logInfo("Stale data cleanup dry-run", {
          table: "audit_logs",
          estimatedRows,
          durationMs,
          retentionDays: auditRetentionDays,
        });
        return {
          table: "audit_logs",
          rowsDeleted: 0,
          durationMs,
          dryRun: true,
          status: "skipped",
          details: {
            estimatedRows,
            retentionDays: auditRetentionDays,
          },
        };
      }

      let deleted = 0;
      await withLockTimeout(async (client) => {
        while (true) {
          const { rowCount } = await client.query(
            `
              WITH batch AS (
                SELECT id
                FROM audit_logs
                WHERE created_at < $1
                ORDER BY created_at ASC
                LIMIT $2
              )
              DELETE FROM audit_logs
              WHERE id IN (SELECT id FROM batch)
            `,
            [cutoff, BATCH_SIZE],
          );

          const batchDeleted = rowCount ?? 0;
          deleted += batchDeleted;

          if (batchDeleted < BATCH_SIZE) {
            break;
          }

          await sleep(BATCH_PAUSE_MS);
        }

        await client.query(`ANALYZE VERBOSE audit_logs`);
      });

      const durationMs = Date.now() - startedAt;
      logInfo("Stale data cleanup completed", {
        table: "audit_logs",
        rowsDeleted: deleted,
        durationMs,
      });

      return {
        table: "audit_logs",
        rowsDeleted: deleted,
        durationMs,
        dryRun: false,
        status: "success",
        details: {
          retentionDays: auditRetentionDays,
          cutoff: cutoff.toISOString(),
          estimatedRows,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logError(error as Error, "high", {
        table: "audit_logs",
        operation: "cleanup_audit_logs",
      });
      return {
        table: "audit_logs",
        rowsDeleted: 0,
        durationMs,
        dryRun,
        status: "failed",
        details: {
          error: (error as Error).message,
        },
      };
    }
  }

  private async runSimpleCleanup(
    table: string,
    dryRun: boolean,
    countQuery: string,
    deleteQuery: string,
    values: unknown[] = [],
    analyzeTable = table,
  ): Promise<CleanupOperationResult> {
    const startedAt = Date.now();
    try {
      const estimatedRows = await countRows(countQuery, values);

      if (dryRun) {
        const durationMs = Date.now() - startedAt;
        logInfo("Stale data cleanup dry-run", {
          table,
          estimatedRows,
          durationMs,
        });
        return {
          table,
          rowsDeleted: 0,
          durationMs,
          dryRun: true,
          status: "skipped",
          details: {
            estimatedRows,
          },
        };
      }

      let rowsDeleted = 0;
      await withLockTimeout(async (client) => {
        const { rowCount } = await client.query(deleteQuery, values);
        rowsDeleted = rowCount ?? 0;
        await client.query(`ANALYZE VERBOSE ${analyzeTable}`);
      });

      const durationMs = Date.now() - startedAt;
      logInfo("Stale data cleanup completed", {
        table,
        rowsDeleted,
        durationMs,
      });

      return {
        table,
        rowsDeleted,
        durationMs,
        dryRun: false,
        status: "success",
        details: {
          estimatedRows,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logError(error as Error, "high", {
        table,
        operation: `cleanup_${table}`,
      });
      return {
        table,
        rowsDeleted: 0,
        durationMs,
        dryRun,
        status: "failed",
        details: {
          error: (error as Error).message,
        },
      };
    }
  }

  private async cleanupPushTokens(
    dryRun: boolean,
  ): Promise<CleanupOperationResult> {
    const retention = retentionDays(env.PUSH_TOKEN_RETENTION_DAYS, 30);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retention);
    return this.runSimpleCleanup(
      "push_tokens",
      dryRun,
      `
        SELECT COUNT(*)::text AS count
        FROM push_tokens
        WHERE is_active = FALSE
          AND COALESCE(last_used_at, updated_at, created_at) < $1
      `,
      `
        DELETE FROM push_tokens
        WHERE is_active = FALSE
          AND COALESCE(last_used_at, updated_at, created_at) < $1
      `,
      [cutoff],
    );
  }

  private async cleanupNotificationDeliveryTracking(
    dryRun: boolean,
  ): Promise<CleanupOperationResult> {
    const retention = retentionDays(
      env.NOTIFICATION_DELIVERY_RETENTION_DAYS,
      90,
    );
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retention);
    return this.runSimpleCleanup(
      "notification_delivery_tracking",
      dryRun,
      `
        SELECT COUNT(*)::text AS count
        FROM notification_delivery_tracking
        WHERE status = 'delivered'
          AND created_at < $1
      `,
      `
        DELETE FROM notification_delivery_tracking
        WHERE status = 'delivered'
          AND created_at < $1
      `,
      [cutoff],
    );
  }

  private async cleanupWebhookDeliveries(
    dryRun: boolean,
  ): Promise<CleanupOperationResult> {
    const retention = retentionDays(env.WEBHOOK_DELIVERY_RETENTION_DAYS, 60);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retention);
    return this.runSimpleCleanup(
      "webhook_deliveries",
      dryRun,
      `
        SELECT COUNT(*)::text AS count
        FROM webhook_deliveries
        WHERE status = 'success'
          AND created_at < $1
      `,
      `
        DELETE FROM webhook_deliveries
        WHERE status = 'success'
          AND created_at < $1
      `,
      [cutoff],
    );
  }

  private async cleanupSessionSummaries(
    dryRun: boolean,
  ): Promise<CleanupOperationResult> {
    const startedAt = Date.now();

    try {
      const estimatedRows = await countRows(
        `
          SELECT COUNT(*)::text AS count
          FROM session_summaries ss
          JOIN bookings b ON b.id = ss.booking_id
          WHERE b.status = 'cancelled'
        `,
      );

      if (dryRun) {
        const durationMs = Date.now() - startedAt;
        logInfo("Stale data cleanup dry-run", {
          table: "session_summaries",
          estimatedRows,
          durationMs,
        });
        return {
          table: "session_summaries",
          rowsDeleted: 0,
          durationMs,
          dryRun: true,
          status: "skipped",
          details: { estimatedRows },
        };
      }

      let rowsDeleted = 0;
      await withLockTimeout(async (client) => {
        const { rowCount } = await client.query(
          `
            DELETE FROM session_summaries ss
            USING bookings b
            WHERE ss.booking_id = b.id
              AND b.status = 'cancelled'
          `,
        );
        rowsDeleted = rowCount ?? 0;
        await client.query(`ANALYZE VERBOSE session_summaries`);
      });

      const durationMs = Date.now() - startedAt;
      logInfo("Stale data cleanup completed", {
        table: "session_summaries",
        rowsDeleted,
        durationMs,
      });

      return {
        table: "session_summaries",
        rowsDeleted,
        durationMs,
        dryRun: false,
        status: "success",
        details: { estimatedRows },
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logError(error as Error, "high", {
        table: "session_summaries",
        operation: "cleanup_session_summaries",
      });
      return {
        table: "session_summaries",
        rowsDeleted: 0,
        durationMs,
        dryRun,
        status: "failed",
        details: {
          error: (error as Error).message,
        },
      };
    }
  }

  private async cleanupChatbotMessages(
    dryRun: boolean,
  ): Promise<CleanupOperationResult> {
    const retention = retentionDays(env.CHATBOT_MESSAGE_RETENTION_DAYS, 180);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retention);
    return this.runSimpleCleanup(
      "chatbot_messages",
      dryRun,
      `
        SELECT COUNT(*)::text AS count
        FROM chatbot_messages
        WHERE created_at < $1
      `,
      `
        DELETE FROM chatbot_messages
        WHERE created_at < $1
      `,
      [cutoff],
    );
  }

  async run(dryRun = env.STALE_CLEANUP_DRY_RUN === "true"): Promise<CleanupRunResult> {
    const startedAt = Date.now();
    logInfo("Starting stale data cleanup job", { dryRun });

    const operations = [
      await this.runAuditLogCleanup(dryRun),
      await this.cleanupPushTokens(dryRun),
      await this.cleanupNotificationDeliveryTracking(dryRun),
      await this.cleanupWebhookDeliveries(dryRun),
      await this.cleanupSessionSummaries(dryRun),
      await this.cleanupChatbotMessages(dryRun),
    ];

    const durationMs = Date.now() - startedAt;
    const result: CleanupRunResult = {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      dryRun,
      operations,
      headers: {
        "X-Deprecation-Notice": "Sent",
      },
    };

    logInfo("Stale data cleanup job completed", {
      dryRun,
      durationMs,
      tables: operations.map((operation) => ({
        table: operation.table,
        rowsDeleted: operation.rowsDeleted,
        durationMs: operation.durationMs,
        status: operation.status,
      })),
    });

    return result;
  }

  stop(): void {
    if (this.job) {
      this.job.stop();
      logInfo("Stale data cleanup job stopped");
    }
  }

  getStatus() {
    if (!this.job) {
      return {
        running: false,
        message: "Job not initialized",
      };
    }

    return {
      running: this.job.running,
      nextDate: (() => {
        const nextDate = this.job.nextDate?.();
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
    };
  }

  async triggerCleanup(): Promise<CleanupRunResult> {
    return this.run(false);
  }

  async triggerNotificationCleanup(): Promise<CleanupOperationResult> {
    return this.cleanupNotificationDeliveryTracking(false);
  }

  async triggerTokenCleanup(): Promise<CleanupOperationResult> {
    return this.cleanupPushTokens(false);
  }

  async triggerAuditLogCleanup(): Promise<CleanupOperationResult> {
    return this.runAuditLogCleanup(false);
  }

  async triggerSessionArchival(): Promise<CleanupOperationResult> {
    return this.cleanupSessionSummaries(false);
  }
}

export default new StaleDataCleanupJob();
