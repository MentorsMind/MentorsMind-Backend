import { PoolClient, QueryResult, QueryResultRow } from 'pg';
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
}

export class QueryMonitor {
  private static readonly SLOW_QUERY_THRESHOLD_MS = 500;

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
    const { useCache = false, ttlSeconds = 60, timeoutMs, preventNPlusOne } = options;
    
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
          await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
      }

      const res = await client.query<T>(text, params);
      
      const diff = process.hrtime(start);
      const durationMs = (diff[0] * 1e9 + diff[1]) / 1e6;

      // Analyze slow queries
      if (durationMs > this.SLOW_QUERY_THRESHOLD_MS) {
        console.warn(`[SLOW QUERY] ${text} - Took ${durationMs.toFixed(2)}ms`);
        // Auto-run explain plan analysis on slow queries
        const plan = await this.explainQuery(client, text, params);
        if (plan) {
            console.warn(`[QUERY EXPLAIN PLAN] For slow query:`, JSON.stringify(plan, null, 2));
        }
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
}
