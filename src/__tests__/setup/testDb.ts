/**
 * Integration test database helper.
 *
 * The pg Pool is created lazily on first access so that the connection
 * parameters set by globalSetup (TEST_DB_HOST etc.) are available before
 * the pool is constructed.
 */
import { Pool, QueryResult, QueryResultRow } from "pg";

let _pool: Pool | null = null;

function buildPool(): Pool {
  return new Pool({
    // globalSetup writes these env vars after starting the PostgreSQL container
    host: process.env.TEST_DB_HOST || process.env.DB_HOST || "localhost",
    port: parseInt(
      process.env.TEST_DB_PORT || process.env.DB_PORT || "5432",
      10,
    ),
    database: process.env.TEST_DB_NAME || process.env.DB_NAME || "testdb",
    user: process.env.TEST_DB_USER || process.env.DB_USER || "postgres",
    password:
      process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || "postgres",
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function getTestPool(): Pool {
  if (!_pool) {
    _pool = buildPool();
  }
  return _pool;
}

/**
 * Minimal typed query helper so factories can import `testPool` and call
 * `.query()` without needing direct access to the Pool instance.
 */
export const testPool = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    return getTestPool().query<T>(text, values as unknown[]);
  },
};

/**
 * Discovers all user-defined tables in the public schema at runtime and
 * truncates them in one statement, resetting sequences and cascading FK deletes.
 */
export async function truncateAllTables(): Promise<void> {
  const pool = getTestPool();

  const { rows } = await pool.query<{ tablename: string }>(`
    SELECT tablename
    FROM   pg_tables
    WHERE  schemaname = 'public'
      AND  tablename  NOT IN ('pgmigrations', 'spatial_ref_sys')
    ORDER  BY tablename
  `);

  if (rows.length === 0) return;

  const tableList = rows.map((r) => `"${r.tablename}"`).join(", ");
  await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}

/**
 * Call in globalTeardown (or afterAll) to cleanly drain the pool.
 */
export async function closeTestDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
