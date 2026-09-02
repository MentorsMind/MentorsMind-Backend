/**
 * Cross-shard query execution (issue #865).
 *
 * A query carrying its table's shard key touches exactly one shard. Anything
 * else has to fan out, and fan-out is where sharding stops being free: the
 * work is N round trips, results must be merged in the application, and
 * `LIMIT`/`OFFSET` no longer mean what they say.
 *
 * This makes those costs explicit rather than hiding them behind a single
 * `query()` that silently becomes O(shards).
 */

import type { QueryResultRow } from "pg";
import { logger } from "../utils/logger";
import shardingConfig from "../config/sharding.config";
import ShardManagerService from "./shard-manager.service";

export interface FanoutOptions {
  /** Merge comparator; required for a meaningful ordered LIMIT. */
  sort?: <T>(a: T, b: T) => number;
  /** Applied after the merge, not per shard. */
  limit?: number;
  /** Shards to target. Defaults to every healthy shard. */
  shardIds?: string[];
  /** Reject rather than run when the fan-out exceeds the configured cap. */
  enforceMaxFanout?: boolean;
}

export interface FanoutResult<T> {
  rows: T[];
  shardsQueried: number;
  shardsFailed: string[];
  /** True when some shard failed and `rows` is therefore incomplete. */
  partial: boolean;
  durationMs: number;
}

export class CrossShardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossShardError";
  }
}

/**
 * Run the same statement on many shards and merge.
 *
 * Declared at module scope rather than as an object method so generic calls
 * from other members are typed — a method referenced through `this` in an
 * object literal is untyped, and `this.fanout<T>()` will not compile.
 */
export async function fanout<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  options: FanoutOptions = {},
): Promise<FanoutResult<T>> {
  const startedAt = Date.now();
  const targets = options.shardIds ?? ShardManagerService.healthyShardIds();

  if (targets.length === 0) {
    throw new CrossShardError("No healthy shards available for fan-out");
  }

  if (options.enforceMaxFanout !== false && targets.length > shardingConfig.maxFanout) {
    throw new CrossShardError(
      `Fan-out across ${targets.length} shards exceeds the configured maximum of ${shardingConfig.maxFanout}`,
    );
  }

  const failed: string[] = [];
  const settled = await Promise.all(
    targets.map(async (shardId) => {
      const pool = ShardManagerService.poolFor(shardId);
      if (!pool) {
        failed.push(shardId);
        return [] as T[];
      }
      try {
        const result = await pool.query<T>(sql, params);
        return result.rows;
      } catch (error) {
        failed.push(shardId);
        ShardManagerService.markHealth(
          shardId,
          false,
          error instanceof Error ? error.message : String(error),
        );
        logger.warn({ shardId }, "Shard query failed during fan-out");
        return [] as T[];
      }
    }),
  );

  let rows = settled.flat();

  // Sorting must happen after the merge. Per-shard ORDER BY only orders within
  // a shard, so the concatenation is not globally ordered.
  if (options.sort) rows = rows.sort(options.sort);
  if (typeof options.limit === "number") rows = rows.slice(0, options.limit);

  return {
    rows,
    shardsQueried: targets.length,
    shardsFailed: failed,
    partial: failed.length > 0,
    durationMs: Date.now() - startedAt,
  };
}

export const CrossShardQueryService = {
  /**
   * Single-shard read. Preferred whenever the shard key is known.
   */
  async onShard<T extends QueryResultRow = QueryResultRow>(
    shardKey: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const pool = ShardManagerService.poolForKey(shardKey);
    if (!pool) {
      throw new CrossShardError(
        `No shard resolved for key ${shardKey}; is sharding configured?`,
      );
    }
    const result = await pool.query<T>(sql, params);
    return result.rows;
  },

  fanout,

  /**
   * Count across shards.
   *
   * Sums per-shard counts. Note this is only exact for a partition-aligned
   * predicate: a `COUNT(DISTINCT x)` cannot be summed this way, because the
   * same value may appear on several shards.
   */
  async count(
    sql: string,
    params: unknown[] = [],
    options: FanoutOptions = {},
  ): Promise<{ total: number; partial: boolean }> {
    const result = await fanout<{ count: string }>(sql, params, options);
    const total = result.rows.reduce(
      (sum, row) => sum + Number(row.count ?? 0),
      0,
    );
    return { total, partial: result.partial };
  },

  /**
   * Best-effort write across shards.
   *
   * **This is not a distributed transaction.** Postgres two-phase commit across
   * independent shards needs a coordinator and a recovery path for prepared-
   * but-unresolved transactions; without one, a mid-fan-out failure leaves some
   * shards committed. The result reports exactly which shards applied so a
   * caller can compensate, and the naming avoids implying atomicity the system
   * does not provide.
   */
  async writeAcrossShards(
    sql: string,
    params: unknown[] = [],
    options: FanoutOptions = {},
  ): Promise<{ applied: string[]; failed: string[]; atomic: false }> {
    const targets = options.shardIds ?? ShardManagerService.healthyShardIds();
    const applied: string[] = [];
    const failed: string[] = [];

    for (const shardId of targets) {
      const pool = ShardManagerService.poolFor(shardId);
      if (!pool) {
        failed.push(shardId);
        continue;
      }
      try {
        await pool.query(sql, params);
        applied.push(shardId);
      } catch (error) {
        failed.push(shardId);
        logger.error(
          {
            shardId,
            error: error instanceof Error ? error.message : String(error),
            applied,
          },
          "Cross-shard write failed; earlier shards remain committed",
        );
      }
    }

    return { applied, failed, atomic: false };
  },
};

export default CrossShardQueryService;
