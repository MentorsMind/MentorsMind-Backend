/**
 * Horizontal sharding configuration (issue #865).
 *
 * The shard topology is configuration, not code: adding a shard must not
 * require a deploy of new logic, and the mapping from key to shard must be
 * reproducible across every process that computes it.
 */

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export interface ShardDefinition {
  /** Stable identifier. Never reuse an id for different storage. */
  id: string;
  connectionString: string;
  /** Weight for rebalancing; a larger shard takes proportionally more keys. */
  weight: number;
  /** Reads and writes are refused while a shard is draining. */
  draining: boolean;
}

export interface ShardingConfig {
  enabled: boolean;
  /**
   * Number of virtual nodes on the hash ring.
   *
   * Consistent hashing is used rather than `hash % shardCount` because modulo
   * remaps almost every key when the shard count changes, which turns adding
   * one shard into a full data migration. With a ring, only the keys adjacent
   * to the new node move.
   */
  virtualNodes: number;
  /** Tables that are sharded. Everything else stays on the primary. */
  shardedTables: string[];
  /** Column carrying the shard key, per table. */
  shardKeys: Record<string, string>;
  shards: ShardDefinition[];
  /** Fan-out queries touching more shards than this are rejected. */
  maxFanout: number;
  /** Health probe interval. */
  healthIntervalMs: number;
}

function parseShards(): ShardDefinition[] {
  // SHARDS="id1=postgres://...;id2=postgres://..."
  const raw = process.env.DB_SHARDS ?? "";
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      const id = entry.slice(0, separator).trim();
      const connectionString = entry.slice(separator + 1).trim();
      return { id, connectionString, weight: 1, draining: false };
    })
    .filter((s) => s.id && s.connectionString);
}

export const shardingConfig: ShardingConfig = {
  enabled: (process.env.DB_SHARDING_ENABLED ?? "false") === "true",
  virtualNodes: num("DB_SHARD_VIRTUAL_NODES", 128),
  shardedTables: (process.env.DB_SHARDED_TABLES ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
  shardKeys: {
    // Tenant-scoped tables shard on the owning user so a user's rows stay
    // co-located and the common queries never fan out.
    sessions: "mentor_id",
    bookings: "mentee_id",
    messages: "conversation_id",
    reviews: "mentor_id",
    ...parseShardKeyOverrides(),
  },
  shards: parseShards(),
  maxFanout: num("DB_SHARD_MAX_FANOUT", 8),
  healthIntervalMs: num("DB_SHARD_HEALTH_INTERVAL_MS", 30_000),
};

function parseShardKeyOverrides(): Record<string, string> {
  // SHARD_KEYS="table:column,table2:column2"
  const raw = process.env.DB_SHARD_KEYS ?? "";
  const out: Record<string, string> = {};
  for (const pair of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [table, column] = pair.split(":").map((p) => p.trim());
    if (table && column) out[table] = column;
  }
  return out;
}

export default shardingConfig;
