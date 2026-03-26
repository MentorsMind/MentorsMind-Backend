import pool from '../config/database';
import { logger } from './logger.utils';
import type {
  PaginationOptions,
  PaginatedResult,
  UpsertOptions,
  QueryParams,
  DatabaseError,
  DatabaseErrorCode,
} from '../types/database.types';
import { PoolClient, QueryResultRow } from 'pg';

// ─── PostgreSQL SQLSTATE → typed error code ───────────────────────────────────

const PG_ERROR_MAP: Record<string, DatabaseErrorCode> = {
  '23505': 'UNIQUE_VIOLATION',
  '23503': 'FOREIGN_KEY_VIOLATION',
  '23502': 'NOT_NULL_VIOLATION',
  '23514': 'CHECK_VIOLATION',
  '40001': 'SERIALIZATION_FAILURE',
  '40P01': 'SERIALIZATION_FAILURE', // deadlock
  '57014': 'QUERY_TIMEOUT',
  '08000': 'CONNECTION_FAILED',
  '08003': 'CONNECTION_FAILED',
  '08006': 'CONNECTION_FAILED',
};

/**
 * Wraps a raw pg error into a typed DatabaseError.
 */
export function toDatabaseError(err: any): DatabaseError {
  const pgCode: string | undefined = err?.code;
  const errorCode: DatabaseErrorCode = (pgCode ? (PG_ERROR_MAP[pgCode] ?? 'UNKNOWN') : 'UNKNOWN');
  const dbErr = new Error(err?.message ?? 'Unknown database error') as DatabaseError;
  dbErr.code = errorCode;
  dbErr.pgCode = pgCode;
  dbErr.detail = err?.detail;
  dbErr.constraint = err?.constraint;
  dbErr.table = err?.table;
  dbErr.column = err?.column;
  return dbErr;
}

/**
 * Returns true if the error is a unique constraint violation.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (err as any)?.code === '23505';
}

/**
 * Returns true if the error is a foreign key constraint violation.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  return (err as any)?.code === '23503';
}

/**
 * Returns true if the error is a serialization/deadlock failure
 * (safe to retry in a transaction).
 */
export function isSerializationFailure(err: unknown): boolean {
  const code = (err as any)?.code;
  return code === '40001' || code === '40P01';
}

// ─── Pagination ───────────────────────────────────────────────────────────────

/**
 * Executes a paginated SELECT query.
 *
 * @example
 * const result = await paginate<User>(
 *   'SELECT * FROM users WHERE active = $1',
 *   [true],
 *   { page: 2, limit: 20 }
 * );
 */
export async function paginate<T extends QueryResultRow>(
  baseQuery: string,
  params: QueryParams,
  options: PaginationOptions,
): Promise<PaginatedResult<T>> {
  const { page, limit } = options;
  const offset = (page - 1) * limit;

  // Wrap in a CTE so we can count without a second round-trip
  const wrappedQuery = `
    WITH _base AS (${baseQuery}),
         _count AS (SELECT COUNT(*) AS total FROM _base)
    SELECT _base.*, _count.total
    FROM _base, _count
    ORDER BY (SELECT NULL)
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  try {
    const result = await pool.query<T & { total: string }>(wrappedQuery, [
      ...params,
      limit,
      offset,
    ]);
    const total = result.rows.length > 0 ? parseInt(result.rows[0].total, 10) : 0;
    const data = result.rows.map(({ total: _t, ...rest }) => rest as unknown as T);
    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };
  } catch (err) {
    logger.error('paginate: query failed', { error: (err as Error).message, baseQuery });
    throw toDatabaseError(err);
  }
}

// ─── Existence / Count ────────────────────────────────────────────────────────

/**
 * Returns true if any row matches the given WHERE clause.
 *
 * @example
 * const taken = await exists('users', 'email = $1', ['user@example.com']);
 */
export async function exists(
  table: string,
  whereClause: string,
  params: QueryParams,
): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT 1 FROM ${table} WHERE ${whereClause} LIMIT 1`,
      params,
    );
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    logger.error('exists: query failed', { table, error: (err as Error).message });
    throw toDatabaseError(err);
  }
}

/**
 * Returns the row count for a given WHERE clause.
 *
 * @example
 * const total = await count('bookings', 'mentor_id = $1', [mentorId]);
 */
export async function count(
  table: string,
  whereClause = '1=1',
  params: QueryParams = [],
): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${whereClause}`,
      params,
    );
    return parseInt(result.rows[0].n, 10);
  } catch (err) {
    logger.error('count: query failed', { table, error: (err as Error).message });
    throw toDatabaseError(err);
  }
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

/**
 * Performs an INSERT … ON CONFLICT DO UPDATE (upsert).
 *
 * @example
 * const row = await upsert('user_settings', { user_id: '...', theme: 'dark' }, {
 *   conflictColumns: ['user_id'],
 *   updateColumns: ['theme'],
 * });
 */
export async function upsert<T extends QueryResultRow>(
  table: string,
  data: Record<string, unknown>,
  options: UpsertOptions,
  client?: PoolClient,
): Promise<T> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`);

  const conflictTarget = options.conflictColumns.join(', ');
  const updateCols = options.updateColumns ?? keys.filter((k) => !options.conflictColumns.includes(k));
  const updateSet = updateCols.map((col) => `${col} = EXCLUDED.${col}`).join(', ');

  const query = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (${conflictTarget})
    DO UPDATE SET ${updateSet}
    RETURNING *
  `;

  try {
    const executor = client ?? pool;
    const result = await executor.query<T>(query, values);
    return result.rows[0];
  } catch (err) {
    logger.error('upsert: failed', { table, error: (err as Error).message });
    throw toDatabaseError(err);
  }
}

// ─── Bulk Insert ──────────────────────────────────────────────────────────────

/**
 * Inserts multiple rows in a single statement.
 *
 * @example
 * await bulkInsert('tags', ['name', 'slug'], [
 *   ['TypeScript', 'typescript'],
 *   ['Node.js', 'nodejs'],
 * ]);
 */
export async function bulkInsert(
  table: string,
  columns: string[],
  rows: unknown[][],
  client?: PoolClient,
): Promise<number> {
  if (rows.length === 0) return 0;

  const params: unknown[] = [];
  const valueClauses = rows.map((row) => {
    const placeholders = row.map((val) => {
      params.push(val);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const query = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES ${valueClauses.join(', ')}
    ON CONFLICT DO NOTHING
  `;

  try {
    const executor = client ?? pool;
    const result = await executor.query(query, params);
    return result.rowCount ?? 0;
  } catch (err) {
    logger.error('bulkInsert: failed', { table, error: (err as Error).message });
    throw toDatabaseError(err);
  }
}

// ─── Pool Stats ───────────────────────────────────────────────────────────────

/**
 * Returns current connection pool statistics.
 */
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}
