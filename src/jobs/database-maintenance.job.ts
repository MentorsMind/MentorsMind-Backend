/**
 * Database Maintenance Job
 *
 * Weekly database maintenance for high-write tables:
 * - VACUUM ANALYZE on target tables
 * - REINDEX CONCURRENTLY on bloated indexes
 * - ANALYZE VERBOSE on stale statistics
 * - CLUSTER audit_logs by created_at
 *
 * Runs every Sunday at 01:00 UTC.
 */

import * as Sentry from "@sentry/node";
import type { PoolClient } from "pg";
import pool from "../config/database";
import { dbTableSizeBytes } from "../config/metrics";
import { logError, logInfo, logWarning } from "../utils/error.utils";

declare const require: any;

type MaintenanceStatus = "success" | "warning" | "failed" | "skipped";

interface TableSnapshot {
  tableName: string;
  totalSizeBytes: number;
  deadTuples: number;
  lastVacuum: Date | null;
  lastAnalyze: Date | null;
}

interface MaintenanceStepResult {
  operation: string;
  status: MaintenanceStatus;
  durationMs: number;
  details: Record<string, unknown>;
}

interface MaintenanceRunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: MaintenanceStepResult[];
  before: TableSnapshot[];
  after: TableSnapshot[];
  headers: {
    "X-Maintenance-Notice": "Sent";
  };
}

const HIGH_WRITE_TABLES = [
  "bookings",
  "transactions",
  "audit_logs",
  "notifications",
  "webhook_deliveries",
  "session_summaries",
] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function isLockTimeoutError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  return err.code === "55P03" || /lock timeout/i.test(err.message ?? "");
}

async function withClient<T>(
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

class DatabaseMaintenanceJob {
  private jobs: Map<string, any> = new Map();

  initialize(): void {
    this.startWeeklyMaintenanceJob();
    logInfo("Database maintenance job initialized", {
      jobs: this.jobs.size,
    });
  }

  private startWeeklyMaintenanceJob(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 1 * * 0", () => {
        void this.run().catch((error) => {
          logError(error as Error, "high", {
            operation: "weekly_database_maintenance",
          });
        });
      });
      job.start();
      this.jobs.set("weekly-maintenance", job);
      logInfo("Weekly database maintenance job started (Sunday 01:00 UTC)");
    } catch (error) {
      logWarning("Failed to start weekly database maintenance job", {
        error: (error as Error).message,
      });
    }
  }

  private async getTableSnapshots(
    tableNames: readonly string[],
  ): Promise<TableSnapshot[]> {
    const { rows } = await pool.query<{
      table_name: string;
      total_size_bytes: string;
      dead_tuples: string;
      last_vacuum: Date | string | null;
      last_analyze: Date | string | null;
    }>(
      `
        SELECT
          relname AS table_name,
          pg_total_relation_size(relid)::text AS total_size_bytes,
          COALESCE(n_dead_tup, 0)::text AS dead_tuples,
          last_vacuum,
          last_analyze
        FROM pg_stat_user_tables
        WHERE relname = ANY($1)
      `,
      [tableNames],
    );

    const snapshots = rows.map((row) => ({
      tableName: row.table_name,
      totalSizeBytes: Number(row.total_size_bytes) || 0,
      deadTuples: Number(row.dead_tuples) || 0,
      lastVacuum: row.last_vacuum ? new Date(row.last_vacuum) : null,
      lastAnalyze: row.last_analyze ? new Date(row.last_analyze) : null,
    }));

    for (const snapshot of snapshots) {
      dbTableSizeBytes.labels(snapshot.tableName).set(snapshot.totalSizeBytes);
    }

    return snapshots;
  }

  private async vacuumTables(full = false): Promise<MaintenanceStepResult[]> {
    const steps: MaintenanceStepResult[] = [];

    for (const tableName of HIGH_WRITE_TABLES) {
      const startedAt = Date.now();
      const snapshotBefore = await this.getTableSnapshots([tableName]);

      try {
        await withClient(async (client) => {
          const statement = full
            ? `VACUUM (FULL, ANALYZE) ${quoteIdentifier(tableName)}`
            : `VACUUM ANALYZE ${quoteIdentifier(tableName)}`;
          await client.query(statement);
        });

        const [after] = await this.getTableSnapshots([tableName]);
        const durationMs = Date.now() - startedAt;
        const step: MaintenanceStepResult = {
          operation: `vacuum:${tableName}`,
          status: "success",
          durationMs,
          details: {
            full,
            before: snapshotBefore[0],
            after,
          },
        };
        steps.push(step);
        logInfo("Database maintenance vacuum completed", {
          table: tableName,
          durationMs,
          deadTuplesBefore: snapshotBefore[0]?.deadTuples ?? 0,
          deadTuplesAfter: after?.deadTuples ?? 0,
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const status: MaintenanceStatus = isLockTimeoutError(error)
          ? "skipped"
          : "failed";
        steps.push({
          operation: `vacuum:${tableName}`,
          status,
          durationMs,
          details: {
            error: (error as Error).message,
            before: snapshotBefore[0],
          },
        });

        if (status === "skipped") {
          logWarning("Database maintenance vacuum skipped due to lock timeout", {
            table: tableName,
          });
        } else {
          logError(error as Error, "high", {
            operation: `vacuum:${tableName}`,
            table: tableName,
          });
        }
      }
    }

    return steps;
  }

  private async reindexBloatedIndexes(
    thresholdPercent = 30,
  ): Promise<MaintenanceStepResult[]> {
    const { rows } = await pool.query<{
      schemaname: string;
      table_name: string;
      index_name: string;
      estimated_bloat_percent: string;
      idx_scan: string;
    }>(
      `
        SELECT
          schemaname,
          relname AS table_name,
          indexrelname AS index_name,
          CASE
            WHEN pg_relation_size(relid) = 0 THEN 0
            ELSE GREATEST(
              0,
              ((pg_relation_size(indexrelid)::numeric / NULLIF(pg_relation_size(relid), 0)) * 100) - 100
            )
          END::text AS estimated_bloat_percent,
          COALESCE(idx_scan, 0)::text AS idx_scan
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
      `,
    );

    const candidates = rows.filter((row) => {
      const bloat = Number(row.estimated_bloat_percent) || 0;
      const scans = Number(row.idx_scan) || 0;
      return bloat > thresholdPercent && scans >= 0;
    });

    const results: MaintenanceStepResult[] = [];
    for (const candidate of candidates) {
      const startedAt = Date.now();
      try {
        await withClient(async (client) => {
          await client.query(
            `REINDEX INDEX CONCURRENTLY ${quoteIdentifier(candidate.schemaname)}.${quoteIdentifier(candidate.index_name)}`,
          );
        });

        const durationMs = Date.now() - startedAt;
        results.push({
          operation: `reindex:${candidate.index_name}`,
          status: "success",
          durationMs,
          details: {
            table: candidate.table_name,
            estimatedBloatPercent: Number(candidate.estimated_bloat_percent) || 0,
          },
        });
        logInfo("Database maintenance reindex completed", {
          index: candidate.index_name,
          table: candidate.table_name,
          durationMs,
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const status: MaintenanceStatus = isLockTimeoutError(error)
          ? "skipped"
          : "failed";
        results.push({
          operation: `reindex:${candidate.index_name}`,
          status,
          durationMs,
          details: {
            table: candidate.table_name,
            error: (error as Error).message,
          },
        });
        if (status === "skipped") {
          logWarning("Database maintenance reindex skipped due to lock timeout", {
            index: candidate.index_name,
          });
        } else {
          logError(error as Error, "high", {
            operation: `reindex:${candidate.index_name}`,
            table: candidate.table_name,
          });
        }
      }
    }

    if (candidates.length === 0) {
      results.push({
        operation: "reindex",
        status: "success",
        durationMs: 0,
        details: { candidates: 0 },
      });
    }

    return results;
  }

  private async analyzeStaleTables(): Promise<MaintenanceStepResult[]> {
    const { rows } = await pool.query<{
      schemaname: string;
      tablename: string;
      last_analyze: Date | string | null;
    }>(
      `
        SELECT schemaname, tablename, last_analyze
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
          AND (last_analyze IS NULL OR last_analyze < NOW() - INTERVAL '7 days')
      `,
    );

    const results: MaintenanceStepResult[] = [];
    for (const row of rows) {
      const startedAt = Date.now();
      try {
        await withClient(async (client) => {
          await client.query(
            `ANALYZE VERBOSE ${quoteIdentifier(row.schemaname)}.${quoteIdentifier(row.tablename)}`,
          );
        });
        const durationMs = Date.now() - startedAt;
        results.push({
          operation: `analyze:${row.tablename}`,
          status: "success",
          durationMs,
          details: {
            lastAnalyze: row.last_analyze,
          },
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const status: MaintenanceStatus = isLockTimeoutError(error)
          ? "skipped"
          : "failed";
        results.push({
          operation: `analyze:${row.tablename}`,
          status,
          durationMs,
          details: {
            error: (error as Error).message,
          },
        });
        if (status === "skipped") {
          logWarning("Database maintenance analyze skipped due to lock timeout", {
            table: row.tablename,
          });
        } else {
          logError(error as Error, "high", {
            operation: `analyze:${row.tablename}`,
          });
        }
      }
    }

    return results;
  }

  private async clusterAuditLogs(): Promise<MaintenanceStepResult[]> {
    const { rows } = await pool.query<{ index_name: string }>(
      `
        SELECT indexname AS index_name
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'audit_logs'
          AND indexdef ILIKE '%(created_at)%'
        ORDER BY indexname
        LIMIT 1
      `,
    );

    if (rows.length === 0) {
      return [
        {
          operation: "cluster:audit_logs",
          status: "skipped",
          durationMs: 0,
          details: { reason: "no created_at index found" },
        },
      ];
    }

    const indexName = rows[0].index_name;
    const startedAt = Date.now();
    try {
      await withClient(async (client) => {
        await client.query(
          `CLUSTER VERBOSE ${quoteIdentifier("public")}.audit_logs USING ${quoteIdentifier(indexName)}`,
        );
      });
      const durationMs = Date.now() - startedAt;
      return [
        {
          operation: "cluster:audit_logs",
          status: "success",
          durationMs,
          details: { indexName },
        },
      ];
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const status: MaintenanceStatus = isLockTimeoutError(error)
        ? "skipped"
        : "failed";
      if (status === "skipped") {
        logWarning("Database maintenance cluster skipped due to lock timeout", {
          indexName,
        });
      } else {
        logError(error as Error, "high", {
          operation: "cluster:audit_logs",
          indexName,
        });
      }

      return [
        {
          operation: "cluster:audit_logs",
          status,
          durationMs,
          details: {
            indexName,
            error: (error as Error).message,
          },
        },
      ];
    }
  }

  async run(): Promise<MaintenanceRunResult> {
    const startedAt = Date.now();
    logInfo("Starting weekly database maintenance cycle");

    const before = await this.getTableSnapshots(HIGH_WRITE_TABLES);
    const steps = [
      ...(await this.vacuumTables(false)),
      ...(await this.reindexBloatedIndexes(30)),
      ...(await this.analyzeStaleTables()),
      ...(await this.clusterAuditLogs()),
    ];
    const after = await this.getTableSnapshots(HIGH_WRITE_TABLES);

    const durationMs = Date.now() - startedAt;
    const result: MaintenanceRunResult = {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      steps,
      before,
      after,
      headers: {
        "X-Maintenance-Notice": "Sent",
      },
    };

    logInfo("Weekly database maintenance cycle completed", {
      durationMs,
      steps: steps.length,
      totalTables: HIGH_WRITE_TABLES.length,
    });

    if (durationMs > 30 * 60 * 1000) {
      Sentry.captureMessage("Database maintenance operation exceeded 30 minutes", {
        level: "warning",
        extra: {
          durationMs,
          steps: steps.map((step) => step.operation),
        },
      });
    }

    return result;
  }

  stopAll(): void {
    for (const [name, job] of this.jobs) {
      job.stop();
      logInfo(`Stopped database maintenance job: ${name}`);
    }
    this.jobs.clear();
  }

  getStatus() {
    return Array.from(this.jobs.entries()).map(([name, job]) => ({
      name,
      running: Boolean(job.running),
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

  async triggerVacuum(full = false): Promise<MaintenanceStepResult[]> {
    return this.vacuumTables(full);
  }

  async triggerAnalyze(): Promise<MaintenanceStepResult[]> {
    return this.analyzeStaleTables();
  }

  async triggerIndexRebuild(): Promise<MaintenanceStepResult[]> {
    return this.reindexBloatedIndexes(30);
  }

  async triggerBloatCheck(): Promise<TableSnapshot[]> {
    return this.getTableSnapshots(HIGH_WRITE_TABLES);
  }

  async triggerFullCycle(): Promise<MaintenanceRunResult> {
    return this.run();
  }
}

export default new DatabaseMaintenanceJob();
