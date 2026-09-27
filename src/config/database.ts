import { trackAndLogQuery } from '../middleware/queryLogger';
import { Pool, PoolClient } from "pg";
import config from "./index";
import { logger } from "../utils/logger";
import { createSecurePoolConfig } from "../database/connection";

export const poolConfig = createSecurePoolConfig(config.db);

export const pool = new Pool(poolConfig);

export const createOptimizedPool = (): Pool => {
  const optimized = new Pool(poolConfig);

  optimized.on("error", (err) => {
    logger.error({ error: err.message }, "Unexpected database pool error");
  });

  optimized.on("connect", (client) => {
    client.query("SET join_collapse_limit = 8").catch(() => {});
    client.on("error", (error) => {
      logger.error({ error: error.message }, "Database client error");
    });
  });

  return optimized;
};

export const testConnection = async (): Promise<boolean> => {
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      // Basic health check query to ensure database is responsive
      await client.query('SELECT 1');
      const latency = Date.now() - start;
      logger.info({ latencyMs: latency }, "Database connected successfully and is responsive");
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : error },
      "Database connection failed",
    );
    return false;
  }
};

// ─── Pool Utilization Monitoring ──────────────────────────────────────────────
// Periodically logs the connection pool metrics if the pool is under load or
// just to provide telemetry for dynamic scaling decisions.

let monitorInterval: NodeJS.Timeout | null = null;

export const startPoolMonitoring = (intervalMs = 60000) => {
  if (monitorInterval) return;
  monitorInterval = setInterval(() => {
    const { totalCount, idleCount, waitingCount } = pool;
    logger.info(
      { totalCount, idleCount, waitingCount, max: config.db.poolMax },
      'Database pool utilization telemetry'
    );
  }, intervalMs);
};

export const stopPoolMonitoring = () => {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
};

// Start monitoring automatically
startPoolMonitoring();

pool.on("error", (err) => {
  logger.error({ error: err.message }, "Unexpected database pool error");
});

pool.on("connect", (client) => {
  client.query("SET join_collapse_limit = 8").catch(() => {});
  client.on("error", (error) => {
    logger.error({ error: error.message }, "Database client error");
  });
});

export const db = {
  query: async (text: string, params?: any[]) => {
    return await trackAndLogQuery(pool, text, params || []);
  },
  connect: async () => {
    return await pool.connect();
  },
};

// ─── Tenant-aware pool checkout ───────────────────────────────────────────────
//
// TenantPoolManager wraps the pool so that every connection checkout
// automatically sets the `app.tenant_id` PostgreSQL session variable.
// This enables PostgreSQL Row Level Security (RLS) policies to enforce
// tenant isolation at the database layer, providing a defense-in-depth
// guarantee even if the application-level tenant filter is bypassed.
//
// Usage (see the JSDoc on connect() / withClient() below for full examples):
//   await TenantPoolManager.withClient(tenantId, async (client) => {
//     await client.query('SELECT * FROM bookings');
//   });
//
// Queries sent through the plain `pool` / `db` exports never set
// `app.tenant_id`, so RLS treats them as unfiltered. Use TenantPoolManager
// for any tenant-scoped data.
//
// The variable is reset to '' on release so the next borrower of that
// connection gets a clean slate.

export const TenantPoolManager = {
  /**
   * Acquire a pool client with `app.tenant_id` set to `tenantId`, so RLS
   * policies restrict every query on it to that tenant's rows.
   *
   * You MUST call `client.release()` in a `finally` block — a leaked client
   * exhausts the pool and keeps its tenant setting. Prefer `withClient()`,
   * which does this for you; use `connect()` only when you need to hold the
   * client across several steps (e.g. an explicit transaction).
   *
   * `tenantId` handling:
   *  - UUID               → rows restricted to that tenant
   *  - '__ADMIN_BYPASS__' → all rows (admin routes only)
   *  - null / ''          → no RLS filtering
   *  - anything else      → logged and treated as '' (NO filtering)
   *
   * @example
   * const client = await TenantPoolManager.connect(TenantContext.requireTenantId());
   * try {
   *   await client.query('BEGIN');
   *   await client.query('UPDATE bookings SET status = $1 WHERE id = $2', ['cancelled', id]);
   *   await client.query('COMMIT');
   * } catch (err) {
   *   await client.query('ROLLBACK');
   *   throw err;
   * } finally {
   *   client.release();
   * }
   */
  async connect(tenantId: string | null): Promise<PoolClient> {
    const client = await pool.connect();

    // Sanitize: only allow UUID-shaped values, empty string, or the bypass
    // sentinel. Reject anything else to prevent injection via the setting.
    const safeId = sanitizeTenantId(tenantId);

    try {
      // Use set_config with is_local=FALSE so the value applies to the whole
      // session (surviving COMMIT / ROLLBACK) until the wrapped release()
      // below resets it.
      await client.query(`SELECT set_config('app.tenant_id', $1, FALSE)`, [safeId]);
    } catch (err) {
      client.release();
      throw err;
    }

    // Wrap release to reset the tenant setting before returning the connection
    // to the pool, so the next borrower gets a clean state.
    const originalRelease = client.release.bind(client);
    (client as any).release = async (err?: Error | boolean) => {
      try {
        await client.query(`SELECT set_config('app.tenant_id', '', FALSE)`);
      } catch {
        // Best-effort reset — don't block release on failure.
      }
      originalRelease(err as any);
    };

    return client;
  },

  /**
   * Execute a callback with a tenant-scoped client, automatically releasing
   * the connection when done (or on error). This is the default way to run
   * tenant-scoped queries.
   *
   * Take the tenant ID from `TenantContext`, never from request input. Pair
   * it with `withTenantFilter` so isolation holds even where RLS is not
   * enabled on the table. Do not keep a reference to `client` after the
   * callback returns — it has already been released.
   *
   * @example
   * const tenantId = TenantContext.requireTenantId();
   * const bookings = await TenantPoolManager.withClient(tenantId, async (client) => {
   *   const { query, params } = withTenantFilter(
   *     'SELECT * FROM bookings WHERE mentor_id = $1', [mentorId], tenantId);
   *   const { rows } = await client.query(query, params);
   *   return rows;
   * });
   */
  async withClient<T>(
    tenantId: string | null,
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await TenantPoolManager.connect(tenantId);
    try {
      return await callback(client);
    } finally {
      await (client as any).release();
    }
  },
};

/**
 * Validate and sanitize a tenant ID before passing it to set_config.
 * Accepts:
 *  - A valid UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 *  - The admin bypass sentinel '__ADMIN_BYPASS__'
 *  - null / undefined / empty string → returns ''
 *
 * Rejects any other value to prevent session-variable injection.
 */
function sanitizeTenantId(tenantId: string | null | undefined): string {
  if (!tenantId) return '';

  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (tenantId === '__ADMIN_BYPASS__' || UUID_REGEX.test(tenantId)) {
    return tenantId;
  }

  // Unexpected value — log and return empty (no filtering) rather than throw,
  // so a misconfigured request degrades gracefully instead of crashing.
  logger.warn(
    { tenantId },
    'sanitizeTenantId: invalid tenant ID format — falling back to no-filter',
  );
  return '';
}

export default pool;
