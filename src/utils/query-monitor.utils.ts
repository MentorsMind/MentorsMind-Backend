import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import Redis from 'ioredis';
import config from '../config';

const redisConfig = config.redis ? { url: config.redis.url } : { host: '127.0.0.1', port: 6379 };
// Use configuration URL if present, else default
const redis = redisConfig.url
  ? new Redis(redisConfig.url)
  : new Redis({ host: redisConfig.host, port: Number(redisConfig.port) || 6379 });

export interface QueryOptions {
  useCache?: boolean;
  ttlSeconds?: number;
  timeoutMs?: number;
  preventNPlusOne?: boolean;
  caller?: string;
}

export class QueryMonitor {
  private static readonly SLOW_QUERY_THRESHOLD_MS = 500;
  private static pool: Pool | null = null;

  /**
   * Set the pool reference so the monitor can persist slow query logs.
   * Call once at startup: QueryMonitor.init(pool)
   */
  static init(pool: Pool): void {
    this.pool = pool;
  }

  /**
   * Explains a query plan to analyze performance.
   */
  static async explainQuery(client: PoolClient, text: string, params?: any[]): Promise<any> {
    try {
      const explainQuery = `EXPLAIN (ANALYZE, FORMAT JSON) ${text}`;
      const res = await client.query(explainQuery, params);
      return res.rows[0];
    } catch (error) {
      console.error(`[Query Monitor] Failed to explain query: ${error}`);
      return null;
    }
  }

  /**
   * Executes a query with monitoring, optional caching, custom timeouts, and N+1 tracking context
   */
  static async execute<T extends QueryResultRow = any>(
    client: PoolClient,
    text: string,
    params?: any[],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const { useCache = false, ttlSeconds = 60, timeoutMs, preventNPlusOne, caller } = options;

    // Simplistic hash for query result caching
    const cacheKey = useCache
        ? `query_cache:${Buffer.from(text + JSON.stringify(params)).toString('base64')}`
        : null;

    if (useCache && cacheKey) {
      const cachedResult = await redis.get(cacheKey);
      if (cachedResult) {
        const rows = JSON.parse(cachedResult);
        return {
          rows,
          command: 'SELECT',
          rowCount: rows.length,
          oid: 0,
          fields: []
        };
      }
    }

    if (preventNPlusOne) {
       // A log indicating this query leverages batched execution (e.g., via DataLoader).
       console.debug(`[Query Monitor] Batch execution preventing N+1 for query: ${text.substring(0, 40)}...`);
    }

    const start = process.hrtime();

    try {
      if (timeoutMs) {
          // Dynamic query timeout handling per query
          await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
      }

      const res = await client.query<T>(text, params);

      const diff = process.hrtime(start);
      const durationMs = (diff[0] * 1e9 + diff[1]) / 1e6;

      // Analyze and persist slow queries
      if (durationMs > this.SLOW_QUERY_THRESHOLD_MS) {
        console.warn(`[SLOW QUERY] ${text} - Took ${durationMs.toFixed(2)}ms`);
        // Auto-run explain plan analysis on slow queries
        const plan = await this.explainQuery(client, text, params);
        if (plan) {
            console.warn(`[QUERY EXPLAIN PLAN] For slow query:`, JSON.stringify(plan, null, 2));
        }

        // Persist to slow_query_log table (fire-and-forget)
        this.logSlowQuery(text, durationMs, res.rowCount ?? 0, caller, plan);
      }

      // Cache query results if requested
      if (useCache && cacheKey && res.rows.length > 0) {
        await redis.set(cacheKey, JSON.stringify(res.rows), 'EX', ttlSeconds);
      }

      return res;
    } catch (error) {
      console.error(`[QUERY ERROR] Failed execution for ${text}:`, error);
      throw error;
    }
  }

  /**
   * Persist a slow query record to the slow_query_log table.
   * Non-blocking — failures are logged but never thrown.
   */
  private static logSlowQuery(
    queryText: string,
    durationMs: number,
    rowsReturned: number,
    caller?: string,
    queryPlan?: any,
  ): void {
    if (!this.pool) return;

    this.pool.query(
      `INSERT INTO slow_query_log (query_text, duration_ms, rows_returned, caller, query_plan)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        queryText.substring(0, 4000),
        durationMs.toFixed(2),
        rowsReturned,
        caller ?? null,
        queryPlan ? JSON.stringify(queryPlan) : null,
      ],
    ).catch((err) => {
      console.error('[Query Monitor] Failed to log slow query:', err.message);
    });
  }

  /**
   * Retrieve the top N slowest queries from the application-level log.
   */
  static async getTopSlowQueries(pool: Pool, limit = 10): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT
         LEFT(query_text, 200) AS query_preview,
         COUNT(*) AS occurrences,
         ROUND(AVG(duration_ms)::numeric, 2) AS avg_ms,
         ROUND(MAX(duration_ms)::numeric, 2) AS max_ms,
         MAX(created_at) AS last_seen
       FROM slow_query_log
       WHERE created_at > NOW() - INTERVAL '7 days'
       GROUP BY LEFT(query_text, 200)
       ORDER BY avg_ms DESC
       LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /**
   * Retrieve top slow queries from pg_stat_statements (requires the extension).
   * Returns empty array if the extension is not installed.
   */
  static async getTopSlowFromPgStats(pool: Pool, limit = 10): Promise<any[]> {
    try {
      const { rows } = await pool.query(
        `SELECT
           queryid,
           LEFT(query, 200) AS query_preview,
           calls,
           ROUND(total_exec_time::numeric, 2) AS total_ms,
           ROUND(mean_exec_time::numeric, 2) AS avg_ms,
           ROUND(max_exec_time::numeric, 2) AS max_ms,
           rows AS total_rows
         FROM pg_stat_statements
         ORDER BY mean_exec_time DESC
         LIMIT $1`,
        [limit],
      );
      return rows;
    } catch {
      // pg_stat_statements not installed
      return [];
    }
  }

  /**
   * Purge slow query log entries older than the given number of days.
   */
  static async purgeOldLogs(pool: Pool, daysToKeep = 30): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM slow_query_log WHERE created_at < NOW() - make_interval(days => $1)`,
      [daysToKeep],
    );
    return rowCount ?? 0;
  }
}
