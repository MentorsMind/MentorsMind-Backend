/**
 * Shard routing and topology management (issue #865).
 *
 * Key placement uses a consistent-hash ring. The alternative, `hash % n`,
 * remaps nearly every key whenever the shard count changes — adding one shard
 * would become a full data migration. On a ring, adding a shard moves only the
 * keys that fall between the new virtual nodes and their predecessors.
 */

import crypto from "crypto";
import type { Pool } from "pg";
import { logger } from "../utils/logger";
import shardingConfig, { type ShardDefinition } from "../config/sharding.config";

export interface ShardHealth {
  id: string;
  healthy: boolean;
  lastCheckedAt: number;
  lastError?: string;
}

interface RingEntry {
  hash: number;
  shardId: string;
}

/** 32-bit unsigned hash, stable across processes and restarts. */
export function hashKey(key: string): number {
  const digest = crypto.createHash("md5").update(key).digest();
  return digest.readUInt32BE(0);
}

/**
 * Build the hash ring.
 *
 * Each shard gets `virtualNodes * weight` points so a heavier shard claims a
 * proportionally larger arc without needing a separate weighting pass.
 */
export function buildRing(shards: ShardDefinition[], virtualNodes: number): RingEntry[] {
  const ring: RingEntry[] = [];
  for (const shard of shards) {
    if (shard.draining) continue;
    const points = Math.max(1, Math.round(virtualNodes * (shard.weight || 1)));
    for (let i = 0; i < points; i += 1) {
      ring.push({ hash: hashKey(`${shard.id}#${i}`), shardId: shard.id });
    }
  }
  return ring.sort((a, b) => a.hash - b.hash);
}

/** First ring entry clockwise of the key's hash, wrapping at the end. */
export function locateOnRing(ring: RingEntry[], key: string): string | null {
  if (ring.length === 0) return null;
  const target = hashKey(key);

  let low = 0;
  let high = ring.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (ring[mid].hash < target) low = mid + 1;
    else high = mid;
  }

  return ring[low].hash >= target ? ring[low].shardId : ring[0].shardId;
}

class ShardManager {
  private ring: RingEntry[] = [];
  private pools = new Map<string, Pool>();
  private health = new Map<string, ShardHealth>();
  private shards: ShardDefinition[] = [];

  /**
   * Install a topology.
   *
   * Pools are injected rather than constructed here so importing this module
   * never opens connections as a side effect.
   */
  configure(shards: ShardDefinition[], pools: Map<string, Pool>): void {
    this.shards = shards;
    this.pools = pools;
    this.ring = buildRing(shards, shardingConfig.virtualNodes);
    for (const shard of shards) {
      if (!this.health.has(shard.id)) {
        this.health.set(shard.id, {
          id: shard.id,
          healthy: true,
          lastCheckedAt: 0,
        });
      }
    }
    logger.info(
      { shards: shards.length, ringPoints: this.ring.length },
      "Shard topology configured",
    );
  }

  get enabled(): boolean {
    return shardingConfig.enabled && this.ring.length > 0;
  }

  /** Shard column for a table, or null when the table is not sharded. */
  shardKeyFor(table: string): string | null {
    if (!shardingConfig.shardedTables.includes(table)) return null;
    return shardingConfig.shardKeys[table] ?? null;
  }

  /** Shard id that owns a key. */
  locate(key: string): string | null {
    if (!this.enabled) return null;
    return locateOnRing(this.ring, String(key));
  }

  poolFor(shardId: string): Pool | null {
    return this.pools.get(shardId) ?? null;
  }

  /** Pool owning a key, or null to fall back to the unsharded primary. */
  poolForKey(key: string): Pool | null {
    const shardId = this.locate(key);
    return shardId ? this.poolFor(shardId) : null;
  }

  allShardIds(): string[] {
    return this.shards.filter((s) => !s.draining).map((s) => s.id);
  }

  healthyShardIds(): string[] {
    return this.allShardIds().filter((id) => this.health.get(id)?.healthy !== false);
  }

  markHealth(shardId: string, healthy: boolean, error?: string): void {
    this.health.set(shardId, {
      id: shardId,
      healthy,
      lastCheckedAt: Date.now(),
      lastError: error,
    });
    if (!healthy) logger.warn({ shardId, error }, "Shard marked unhealthy");
  }

  healthSnapshot(): ShardHealth[] {
    return [...this.health.values()];
  }

  /**
   * Which keys would move if `candidate` joined the topology.
   *
   * Rebalancing is planned, never executed here: moving rows between shards is
   * a data migration with its own consistency and downtime story. This answers
   * "how much would move" so that decision can be made with a number attached.
   */
  planRebalance(candidate: ShardDefinition, sampleKeys: string[]): {
    moved: number;
    total: number;
    movedFraction: number;
    movesByShard: Record<string, number>;
  } {
    const before = this.ring;
    const after = buildRing(
      [...this.shards, candidate],
      shardingConfig.virtualNodes,
    );

    const movesByShard: Record<string, number> = {};
    let moved = 0;

    for (const key of sampleKeys) {
      const from = locateOnRing(before, key);
      const to = locateOnRing(after, key);
      if (from !== to) {
        moved += 1;
        if (from) movesByShard[from] = (movesByShard[from] ?? 0) + 1;
      }
    }

    return {
      moved,
      total: sampleKeys.length,
      movedFraction: sampleKeys.length === 0 ? 0 : moved / sampleKeys.length,
      movesByShard,
    };
  }
}

export const ShardManagerService = new ShardManager();
export default ShardManagerService;
