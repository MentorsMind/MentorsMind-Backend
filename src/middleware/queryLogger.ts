/**
 * queryLogger.ts
 *
 * PostgreSQL query performance middleware (issue #742).
 *
 * Instruments the shared pg.Pool by:
 *  - Timing every query via the pool-level `query` event
 *  - Logging queries that exceed SLOW_QUERY_THRESHOLD_MS with normalised SQL
 *    (parameter values are redacted for security)
 *  - Persisting slow-query records in the `slow_query_log` table
 *  - Running EXPLAIN (ANALYZE, BUFFERS) asynchronously so the original caller
 *    never waits for the plan capture
 *  - Recording per-fingerprint latency samples in Redis via QueryMonitorService
 *  - Incrementing the db_query_duration_ms Prometheus histogram
 *
 * The legacy trackAndLogQuery export is retained for backward compatibility
 * with callers that still use it directly.
 */

import * as crypto from "crypto";
import pool from "../config/database";
import { logger } from "../utils/logger";
import { dbQueryDurationMs } from "../config/metrics";
import QueryMonitorService from "../services/query-monitor.service";

// ─── Configuration ────────────────────────────────────────────────────────────

const SLOW_QUERY_THRESHOLD_MS =
  parseInt(process.env.SLOW_QUERY_THRESHOLD_MS ?? "500", 10);

/** Legacy counters kept for the alert-threshold check */
let totalQueries = 0;
let slowQueries = 0;
const ALERT_THRESHOLD_PERCENT = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip literal parameter values from a SQL string so that the stored
 * normalised form is safe to log and deduplicate across invocations.
 *
 * Replaces:
 *   - single-quoted string literals → ''
 *   - integer / decimal literals    → 0
 *   - placeholder params ($1 … $N) are already safe, kept as-is
 */
function normalizeQuery(sql: string): string {
  return sql
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")   // string literals
    .replace(/\b\d+(\.\d+)?\b/g, "0")       // numeric literals
    .replace(/\s+/g, " ")
    .trim();
}

/** Derive a stable, compact hash from a normalised SQL string. */
function hashQuery(normalised: string): string {
  return crypto.createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

/** Extract a coarse query type label for Prometheus. */
function queryType(sql: string): string {
  const first = sql.trimStart().substring(0, 6).toLowerCase();
  if (first.startsWith("select")) return "select";
  if (first.startsWith("insert")) return "insert";
  if (first.startsWith("update")) return "update";
  if (first.startsWith("delete")) return "delete";
  return "other";
}

// ─── Async EXPLAIN helper ─────────────────────────────────────────────────────

/**
 * Capture EXPLAIN (ANALYZE, BUFFERS) for a slow query without blocking the
 * original caller.  Runs on a fresh pool connection to avoid interleaving.
 *
 * Fires-and-forgets; errors are swallowed after logging.
 */
async function captureExplainPlan(
  sql: string,
  params: unknown[],
): Promise<unknown> {
  let client;
  try {
    client = await pool.connect();
    // Use EXPLAIN ANALYZE BUFFERS JSON for machine-readable output
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
    const { rows } = await client.query(explainSql, params);
    return rows[0]?.["QUERY PLAN"] ?? null;
  } catch (err) {
    logger.warn("queryLogger: EXPLAIN capture failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    client?.release();
  }
}

// ─── Slow-query persistence ───────────────────────────────────────────────────

async function persistSlowQuery(
  normalisedQuery: string,
  queryHash: string,
  executionTimeMs: number,
  planJson: unknown,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO slow_query_log
         (query_hash, normalized_query, execution_time_ms, plan_json, occurred_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [queryHash, normalisedQuery, executionTimeMs, planJson ? JSON.stringify(planJson) : null],
    );
  } catch (err) {
    logger.warn("queryLogger: failed to persist slow query log", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Pool instrumentation ─────────────────────────────────────────────────────

let poolInstrumented = false;

/**
 * Attach query-timing listeners to the shared pool.
 * Safe to call multiple times — will instrument only once.
 */
export function instrumentPool(): void {
  if (poolInstrumented || !pool?.query) return;
  poolInstrumented = true;

  // pg Pool fires `query` event for every query submitted through the pool.
  // We monkey-patch Pool.query to wrap the promise with timing logic because
  // the built-in event API doesn't expose duration.
  const originalQuery = pool.query.bind(pool);

  // @ts-ignore — we're augmenting the pool prototype at runtime
  pool.query = async function instrumentedQuery(
    textOrConfig: any,
    valuesOrCallback?: any,
  ): Promise<any> {
    const start = process.hrtime.bigint();
    totalQueries++;

    try {
      const result = await originalQuery(textOrConfig, valuesOrCallback);
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;

      const sql: string =
        typeof textOrConfig === "string" ? textOrConfig : textOrConfig?.text ?? "";
      const params: unknown[] =
        Array.isArray(valuesOrCallback)
          ? valuesOrCallback
          : Array.isArray(textOrConfig?.values)
          ? textOrConfig.values
          : [];

      const qType = queryType(sql);
      dbQueryDurationMs.observe({ query_type: qType }, durationMs);

      if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
        slowQueries++;

        const normalised = normalizeQuery(sql);
        const qHash = hashQuery(normalised);

        logger.warn("Slow query detected", {
          durationMs: durationMs.toFixed(2),
          queryHash: qHash,
          normalizedSql: normalised,
        });

        checkAlertThreshold();

        // Record Redis percentile sample (non-blocking)
        QueryMonitorService.recordSample(qHash, durationMs).catch(() => {});

        // Asynchronously capture plan and persist — never await this
        setImmediate(async () => {
          try {
            const planJson = await captureExplainPlan(sql, params);
            await persistSlowQuery(normalised, qHash, durationMs, planJson);

            if (planJson) {
              const recs = QueryMonitorService.parseIndexRecommendations(planJson);
              if (recs.length > 0) {
                logger.info("queryLogger: index recommendations generated", { recs });
              }
            }
          } catch (asyncErr) {
            logger.warn("queryLogger: async slow-query handling failed", {
              error: asyncErr instanceof Error ? asyncErr.message : String(asyncErr),
            });
          }
        });
      }

      return result;
    } catch (error) {
      throw error;
    }
  };
}

// Instrument the pool immediately when this module is first loaded.
instrumentPool();

// ─── Alert threshold ──────────────────────────────────────────────────────────

function checkAlertThreshold(): void {
  if (totalQueries > 20) {
    const slowPct = (slowQueries / totalQueries) * 100;
    if (slowPct > ALERT_THRESHOLD_PERCENT) {
      logger.error(
        `PERFORMANCE ALERT: ${slowPct.toFixed(2)}% of queries are slow (>${SLOW_QUERY_THRESHOLD_MS}ms).`,
      );
    }
  }
}

// ─── Legacy export (backward compat) ─────────────────────────────────────────

/**
 * @deprecated Use the pool instrumentation via instrumentPool() instead.
 * Retained for callers that import trackAndLogQuery directly.
 */
export async function trackAndLogQuery(
  client: any,
  sql: string,
  params: any[],
): Promise<any> {
  const start = process.hrtime.bigint();
  totalQueries++;

  try {
    const result = await client.query(sql, params);
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const qType = queryType(sql);
    dbQueryDurationMs.observe({ query_type: qType }, durationMs);

    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      slowQueries++;
      const normalised = normalizeQuery(sql);
      const qHash = hashQuery(normalised);

      logger.warn("Slow query detected", {
        durationMs: durationMs.toFixed(2),
        queryHash: qHash,
        normalizedSql: normalised,
      });

      checkAlertThreshold();
      QueryMonitorService.recordSample(qHash, durationMs).catch(() => {});

      setImmediate(async () => {
        try {
          const planJson = await captureExplainPlan(sql, params);
          await persistSlowQuery(normalised, qHash, durationMs, planJson);
        } catch (_) {}
      });
    }

    return result;
  } catch (error) {
    throw error;
  }
}
