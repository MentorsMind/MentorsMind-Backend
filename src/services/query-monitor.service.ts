/**
 * query-monitor.service.ts
 *
 * Implements P50/P95/P99 latency percentile tracking per query fingerprint
 * using Redis sorted sets, and automated index recommendations from EXPLAIN
 * output.  Pairs with the instrumented queryLogger middleware (issue #742).
 */

import pool from "../config/database";
import { redis } from "../config/redis";
import { Logger } from "../utils/logger.utils";
import { QueryAnalyzer } from "../utils/query-analyzer";

// Redis key prefix for per-fingerprint execution-time sorted sets.
// Each set stores raw execution times (ms) as scores with random UUID members.
const REDIS_QUERY_TIMES_PREFIX = "qmon:times:";
// Cap the sorted set to the most recent N samples to avoid unbounded growth.
const MAX_SAMPLES_PER_FINGERPRINT = 1000;
// How long (seconds) to retain Redis samples per fingerprint.
const REDIS_SAMPLE_TTL_S = 86400 * 7; // 7 days

export interface SlowQueryRow {
  id: string;
  query_hash: string;
  normalized_query: string;
  execution_time_ms: number;
  plan_json: unknown;
  occurred_at: string;
  /** Populated in-memory from Redis percentile data */
  p50_ms?: number | null;
  p95_ms?: number | null;
  p99_ms?: number | null;
  occurrence_count?: number;
}

export interface IndexRecommendation {
  table: string;
  reason: string;
  suggestion: string;
}

export const QueryMonitorService = {
  /**
   * Record an execution time sample for the given query fingerprint/hash.
   * Uses a Redis sorted set (score = execution time ms).
   */
  async recordSample(queryHash: string, executionTimeMs: number): Promise<void> {
    try {
      const key = `${REDIS_QUERY_TIMES_PREFIX}${queryHash}`;
      const member = `${Date.now()}-${Math.random()}`;

      const pipeline = redis.pipeline();
      pipeline.zadd(key, executionTimeMs, member);
      // Keep only the latest MAX_SAMPLES_PER_FINGERPRINT entries
      pipeline.zremrangebyrank(key, 0, -(MAX_SAMPLES_PER_FINGERPRINT + 1));
      // Refresh TTL on each write
      pipeline.expire(key, REDIS_SAMPLE_TTL_S);
      await pipeline.exec();
    } catch (err) {
      // Redis errors must never block the request path
      logger.warn("QueryMonitorService.recordSample: Redis error", { queryHash, err });
    }
  },

  /**
   * Compute P50 / P95 / P99 latency for the given query hash from Redis.
   * Returns null for each percentile if insufficient data.
   */
  async getPercentiles(
    queryHash: string,
  ): Promise<{ p50: number | null; p95: number | null; p99: number | null; count: number }> {
    try {
      const key = `${REDIS_QUERY_TIMES_PREFIX}${queryHash}`;
      // ZRANGE with BYSCORE ascending gives us all members sorted by exec time
      const scores = await redis.zrange(key, 0, -1, "WITHSCORES");
      if (!scores || scores.length === 0) {
        return { p50: null, p95: null, p99: null, count: 0 };
      }

      // zrange WITHSCORES returns [member, score, member, score, ...]
      const times: number[] = [];
      for (let i = 1; i < scores.length; i += 2) {
        times.push(parseFloat(scores[i]));
      }
      times.sort((a, b) => a - b);

      const percentile = (arr: number[], p: number): number => {
        const idx = Math.max(0, Math.ceil((p / 100) * arr.length) - 1);
        return arr[idx];
      };

      return {
        p50: percentile(times, 50),
        p95: percentile(times, 95),
        p99: percentile(times, 99),
        count: times.length,
      };
    } catch (err) {
      logger.warn("QueryMonitorService.getPercentiles: Redis error", { queryHash, err });
      return { p50: null, p95: null, p99: null, count: 0 };
    }
  },

  /**
   * Fetch slow query log entries from PostgreSQL, enriched with Redis percentiles.
   */
  async getSlowQueries(opts: {
    threshold?: number;
    limit?: number;
    sortBy?: "frequency" | "max_time";
  }): Promise<SlowQueryRow[]> {
    const { threshold = 500, limit = 20, sortBy = "max_time" } = opts;

    const orderClause =
      sortBy === "frequency"
        ? "occurrence_count DESC, max_time DESC"
        : "max_time DESC";

    const { rows } = await pool.query<{
      query_hash: string;
      normalized_query: string;
      max_time: string;
      min_time: string;
      occurrence_count: string;
      last_occurred_at: string;
      last_plan_json: unknown;
      last_id: string;
    }>(
      `SELECT
         query_hash,
         normalized_query,
         MAX(execution_time_ms) AS max_time,
         MIN(execution_time_ms) AS min_time,
         COUNT(*)              AS occurrence_count,
         MAX(occurred_at)      AS last_occurred_at,
         (ARRAY_AGG(plan_json ORDER BY occurred_at DESC))[1] AS last_plan_json,
         (ARRAY_AGG(id       ORDER BY occurred_at DESC))[1] AS last_id
       FROM slow_query_log
       WHERE execution_time_ms >= $1
       GROUP BY query_hash, normalized_query
       ORDER BY ${orderClause}
       LIMIT $2`,
      [threshold, limit],
    );

    // Enrich with Redis percentile data in parallel
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const percentiles = await this.getPercentiles(row.query_hash);
        return {
          id: row.last_id,
          query_hash: row.query_hash,
          normalized_query: row.normalized_query,
          execution_time_ms: parseFloat(row.max_time),
          plan_json: row.last_plan_json,
          occurred_at: row.last_occurred_at,
          p50_ms: percentiles.p50,
          p95_ms: percentiles.p95,
          p99_ms: percentiles.p99,
          occurrence_count: parseInt(row.occurrence_count, 10),
        };
      }),
    );

    return enriched;
  },

  /**
   * Parse EXPLAIN output (text or JSON) and produce CREATE INDEX suggestions
   * for sequential scans on large tables (> 10,000 rows).
   */
  parseIndexRecommendations(planJson: unknown): IndexRecommendation[] {
    const recommendations: IndexRecommendation[] = [];
    if (!planJson) return recommendations;

    const analysis = QueryAnalyzer.analyzeExplainPlan(planJson);

    for (const recommendation of analysis.recommendations) {
      recommendations.push({
        table: recommendation.table,
        reason: recommendation.reason,
        suggestion: recommendation.sql,
      });
    }

    if (recommendations.length === 0) {
      const planText =
        typeof planJson === "string"
          ? planJson
          : JSON.stringify(planJson);

      const seqScanPattern = /Seq Scan on (\w+)[\s\S]*?rows=(\d+)/gi;
      let match: RegExpExecArray | null;
      const seen = new Set<string>();

      while ((match = seqScanPattern.exec(planText)) !== null) {
        const table = match[1];
        const rows = parseInt(match[2], 10);

        if (rows > 10_000 && !seen.has(table)) {
          seen.add(table);
          recommendations.push({
            table,
            reason: `Sequential scan detected on table "${table}" scanning ~${rows.toLocaleString()} rows`,
            suggestion: `CREATE INDEX CONCURRENTLY ON ${table} (<filtered_column>);`,
          });
        }
      }
    }

    return recommendations;
  },

  /**
   * Aggregate index recommendations across recent slow query logs.
   */
  async getAggregatedIndexRecommendations(limit = 50): Promise<IndexRecommendation[]> {
    const { rows } = await pool.query<{ plan_json: unknown }>(
      `SELECT plan_json
       FROM slow_query_log
       WHERE plan_json IS NOT NULL
       ORDER BY occurred_at DESC
       LIMIT $1`,
      [limit],
    );

    const allRecs: IndexRecommendation[] = [];
    const seenTables = new Set<string>();

    for (const row of rows) {
      const recs = this.parseIndexRecommendations(row.plan_json);
      for (const rec of recs) {
        if (!seenTables.has(rec.table)) {
          seenTables.add(rec.table);
          allRecs.push(rec);
        }
      }
    }

    return allRecs;
  },
};

export default QueryMonitorService;
