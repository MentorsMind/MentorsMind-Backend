import { QueryResultRow, PoolClient } from 'pg';

// ─── Connection & Pool ────────────────────────────────────────────────────────

export interface DatabaseConfig {
  url: string;
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  poolMax: number;
  poolMin: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
}

export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

// ─── Query ────────────────────────────────────────────────────────────────────

export interface QueryOptions {
  /** Timeout for this specific query in ms (overrides pool-level timeout) */
  timeoutMs?: number;
  /** Cache results in Redis for this many seconds */
  cacheSeconds?: number;
  /** Log if query exceeds this threshold (ms). Default: 500ms */
  slowThresholdMs?: number;
}

export type QueryParams = (string | number | boolean | null | Date | object)[];

export interface TypedQueryResult<T extends QueryResultRow = any> {
  rows: T[];
  rowCount: number;
  command: string;
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export type TransactionIsolationLevel =
  | 'READ UNCOMMITTED'
  | 'READ COMMITTED'
  | 'REPEATABLE READ'
  | 'SERIALIZABLE';

export interface TransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  /** Retry the transaction up to N times on serialization failures */
  maxRetries?: number;
}

export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;

// ─── Error Handling ───────────────────────────────────────────────────────────

export type DatabaseErrorCode =
  | 'CONNECTION_FAILED'
  | 'QUERY_TIMEOUT'
  | 'SERIALIZATION_FAILURE'
  | 'UNIQUE_VIOLATION'
  | 'FOREIGN_KEY_VIOLATION'
  | 'NOT_NULL_VIOLATION'
  | 'CHECK_VIOLATION'
  | 'UNKNOWN';

export interface DatabaseError extends Error {
  code: DatabaseErrorCode;
  pgCode?: string;      // PostgreSQL SQLSTATE code
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface UpsertOptions {
  /** Column(s) that determine uniqueness conflict */
  conflictColumns: string[];
  /** Columns to update on conflict (defaults to all non-conflict columns) */
  updateColumns?: string[];
}

// ─── Migration ────────────────────────────────────────────────────────────────

export interface Migration {
  id: string;         // e.g. "001_create_users"
  name: string;
  up: (client: PoolClient) => Promise<void>;
  down: (client: PoolClient) => Promise<void>;
}

export interface MigrationRecord {
  id: string;
  name: string;
  applied_at: Date;
  batch: number;
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface DatabaseHealthResult {
  connected: boolean;
  responseTimeMs: number;
  poolStats: PoolStats;
  error?: string;
}

// ─── Retry ────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  /** Multiply delay by this factor each retry */
  backoffFactor: number;
}
