import pool from '../config/database';
import config from '../config';
import { logger } from '../utils/logger.utils';
import { toDatabaseError, isSerializationFailure, getPoolStats } from '../utils/database.utils';
import type {
  TransactionOptions,
  TransactionCallback,
  RetryOptions,
  DatabaseHealthResult,
  Migration,
  MigrationRecord,
} from '../types/database.types';
import { PoolClient } from 'pg';
import { dbCircuitBreakerOpenTotal } from '../config/metrics';

// ─── Default retry config ─────────────────────────────────────────────────────

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffFactor: 2,
};

// ─── Circuit Breaker ───────────────────────────────────────────────────────────

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

let circuitState: CircuitState = 'CLOSED';
let consecutiveExhaustionCount = 0;
let lastOpenTime = 0;
const CIRCUIT_RESET_TIMEOUT_MS = 30_000; // 30 seconds
const CONSECUTIVE_EXHAUSTION_THRESHOLD = 3;

export class CircuitBreakerError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function getCircuitState(): CircuitState {
  return circuitState;
}

export function resetCircuitBreaker(): void {
  circuitState = 'CLOSED';
  consecutiveExhaustionCount = 0;
  lastOpenTime = 0;
}

function checkCircuitBreaker(): void {
  if (!config.db.circuitBreakerEnabled) return;

  const now = Date.now();

  if (circuitState === 'OPEN') {
    if (now - lastOpenTime >= CIRCUIT_RESET_TIMEOUT_MS) {
      circuitState = 'HALF_OPEN';
      logger.info('Circuit breaker transitioning to HALF_OPEN state');
    } else {
      const retryAfter = Math.ceil((lastOpenTime + CIRCUIT_RESET_TIMEOUT_MS - now) / 1000);
      throw new CircuitBreakerError('Database circuit breaker is open', retryAfter);
    }
  }
}

export function onPoolPressure(): void {
  consecutiveExhaustionCount++;
  logger.warn('Pool pressure detected', { consecutiveExhaustionCount });

  if (consecutiveExhaustionCount >= CONSECUTIVE_EXHAUSTION_THRESHOLD && circuitState === 'CLOSED') {
    circuitState = 'OPEN';
    lastOpenTime = Date.now();
    dbCircuitBreakerOpenTotal.inc();
    logger.error('Circuit breaker opened due to pool exhaustion');
  }
}

function onSuccessfulConnection(): void {
  if (circuitState === 'HALF_OPEN') {
    circuitState = 'CLOSED';
    consecutiveExhaustionCount = 0;
    logger.info('Circuit breaker closed after successful connection');
  } else if (circuitState === 'CLOSED') {
    consecutiveExhaustionCount = 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calcDelay(attempt: number, opts: RetryOptions): number {
  const delay = opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt - 1);
  return Math.min(delay, opts.maxDelayMs);
}

async function acquireConnectionWithTimeout(timeoutMs = 5000): Promise<PoolClient> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Connection acquisition timeout'));
    }, timeoutMs);

    pool.connect()
      .then(client => {
        clearTimeout(timeoutId);
        resolve(client);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

// ─── DatabaseService ──────────────────────────────────────────────────────────

export class DatabaseService {
  // ── withConnection ───────────────────────────────────────────────────────────

  static async withConnection<T>(
    callback: (client: PoolClient) => Promise<T>,
    timeoutMs = 5000,
  ): Promise<T> {
    checkCircuitBreaker();

    let client: PoolClient | null = null;
    try {
      client = await acquireConnectionWithTimeout(timeoutMs);
      onSuccessfulConnection();
      return await callback(client);
    } catch (err) {
      // Check if error is due to pool exhaustion or connection timeout
      if (
        (err as Error).message.includes('timeout') ||
        (err as Error).message.includes('no connections available')
      ) {
        onPoolPressure();
      }
      throw toDatabaseError(err);
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  // ── Transactions ────────────────────────────────────────────────────────────

  /**
   * Executes a callback inside a PostgreSQL transaction.
   * Automatically commits on success, rolls back on failure.
   * Retries on serialization failures (40001 / 40P01) when maxRetries > 0.
   *
   * @example
   * const result = await DatabaseService.withTransaction(async (client) => {
   *   await client.query('INSERT INTO orders ...', [...]);
   *   await client.query('UPDATE inventory ...', [...]);
   *   return result;
   * });
   */
  static async withTransaction<T>(
    callback: TransactionCallback<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const { isolationLevel = 'READ COMMITTED', maxRetries = 1 } = options;
    let attempt = 0;

    while (true) {
      attempt++;
      checkCircuitBreaker();

      let client: PoolClient | null = null;
      try {
        client = await acquireConnectionWithTimeout();
        onSuccessfulConnection();
        await client.query('BEGIN');
        if (isolationLevel !== 'READ COMMITTED') {
          await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
        }

        const result = await callback(client);
        await client.query('COMMIT');
        logger.debug('Transaction committed', { attempt, isolationLevel });
        return result;
      } catch (err) {
        if (client) {
          await client.query('ROLLBACK').catch(() => {});
        }
        const isSerial = isSerializationFailure(err);

        if (isSerial && attempt < maxRetries) {
          const delay = calcDelay(attempt, DEFAULT_RETRY);
          logger.warn('Serialization failure — retrying transaction', { attempt, delayMs: delay });
          await sleep(delay);
          continue;
        }

        if (
          (err as Error).message.includes('timeout') ||
          (err as Error).message.includes('no connections available')
        ) {
          onPoolPressure();
        }

        logger.error('Transaction rolled back', {
          attempt,
          error: (err as Error).message,
          pgCode: (err as any)?.code,
        });
        throw toDatabaseError(err);
      } finally {
        if (client) {
          client.release();
        }
      }
    }
  }

  // ── Retry logic ──────────────────────────────────────────────────────────────

  /**
   * Executes any async operation with exponential backoff retries.
   * Useful for connection establishment or idempotent queries.
   *
   * @example
   * const rows = await DatabaseService.withRetry(
   *   () => pool.query('SELECT 1'),
   *   { maxAttempts: 5, initialDelayMs: 200, maxDelayMs: 10000, backoffFactor: 2 }
   * );
   */
  static async withRetry<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {},
  ): Promise<T> {
    const opts: RetryOptions = { ...DEFAULT_RETRY, ...options };
    let lastErr: Error = new Error('Unknown error');

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err as Error;
        if (attempt < opts.maxAttempts) {
          const delay = calcDelay(attempt, opts);
          logger.warn('Operation failed, retrying...', {
            attempt,
            maxAttempts: opts.maxAttempts,
            delayMs: delay,
            error: lastErr.message,
          });
          await sleep(delay);
        }
      }
    }

    logger.error('All retry attempts exhausted', { maxAttempts: opts.maxAttempts, error: lastErr.message });
    throw toDatabaseError(lastErr);
  }

  // ── Health check ─────────────────────────────────────────────────────────────

  /**
   * Performs a lightweight database health check.
   * Returns pool stats alongside connectivity status.
   */
  static async checkHealth(): Promise<DatabaseHealthResult> {
    const start = Date.now();
    try {
      await pool.query('SELECT 1 AS ok');
      const responseTimeMs = Date.now() - start;
      logger.debug('Database health check passed', { responseTimeMs });
      return { connected: true, responseTimeMs, poolStats: getPoolStats() };
    } catch (err) {
      const responseTimeMs = Date.now() - start;
      const message = (err as Error).message;
      logger.warn('Database health check failed', { responseTimeMs, error: message });
      return { connected: false, responseTimeMs, poolStats: getPoolStats(), error: message };
    }
  }

  // ── Migration runner ──────────────────────────────────────────────────────────

  /**
   * Ensures the migrations tracking table exists.
   */
  private static async ensureMigrationsTable(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id          TEXT        PRIMARY KEY,
        name        TEXT        NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        batch       INTEGER     NOT NULL DEFAULT 1
      )
    `);
  }

  /**
   * Returns the set of already-applied migration IDs.
   */
  private static async getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
    const result = await client.query<MigrationRecord>('SELECT id FROM _migrations');
    return new Set(result.rows.map((r) => r.id));
  }

  /**
   * Runs all pending migrations in order, each in its own transaction.
   * Skips migrations that have already been applied.
   *
   * @example
   * await DatabaseService.runMigrations([migration001, migration002]);
   */
  static async runMigrations(migrations: Migration[]): Promise<void> {
    const client = await pool.connect();
    try {
      await DatabaseService.ensureMigrationsTable(client);
      const applied = await DatabaseService.getAppliedMigrations(client);

      // Determine the next batch number
      const batchResult = await client.query<{ max: string }>(
        'SELECT COALESCE(MAX(batch), 0) AS max FROM _migrations',
      );
      const batch = parseInt(batchResult.rows[0].max, 10) + 1;

      const pending = migrations.filter((m) => !applied.has(m.id));
      if (pending.length === 0) {
        logger.info('No pending migrations');
        return;
      }

      logger.info(`Running ${pending.length} migration(s)`, { batch });

      for (const migration of pending) {
        await client.query('BEGIN');
        try {
          logger.info(`Applying migration: ${migration.id} — ${migration.name}`);
          await migration.up(client);
          await client.query(
            'INSERT INTO _migrations (id, name, batch) VALUES ($1, $2, $3)',
            [migration.id, migration.name, batch],
          );
          await client.query('COMMIT');
          logger.info(`Migration applied: ${migration.id}`);
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error('Migration failed, rolled back', { id: migration.id, error: (err as Error).message });
          throw toDatabaseError(err);
        }
      }

      logger.info('All migrations applied successfully', { batch, count: pending.length });
    } finally {
      client.release();
    }
  }

  /**
   * Rolls back the most recent migration batch.
   */
  static async rollbackMigrations(migrations: Migration[]): Promise<void> {
    const client = await pool.connect();
    try {
      await DatabaseService.ensureMigrationsTable(client);

      const batchResult = await client.query<{ max: string }>(
        'SELECT MAX(batch) AS max FROM _migrations',
      );
      const batch = parseInt(batchResult.rows[0].max ?? '0', 10);
      if (!batch) {
        logger.info('No migrations to roll back');
        return;
      }

      const records = await client.query<MigrationRecord>(
        'SELECT id FROM _migrations WHERE batch = $1 ORDER BY applied_at DESC',
        [batch],
      );
      const idsToRollback = new Set(records.rows.map((r) => r.id));
      const toRollback = migrations.filter((m) => idsToRollback.has(m.id)).reverse();

      logger.info(`Rolling back batch ${batch} (${toRollback.length} migration(s))`);

      for (const migration of toRollback) {
        await client.query('BEGIN');
        try {
          logger.info(`Reverting migration: ${migration.id}`);
          await migration.down(client);
          await client.query('DELETE FROM _migrations WHERE id = $1', [migration.id]);
          await client.query('COMMIT');
          logger.info(`Migration reverted: ${migration.id}`);
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error('Rollback failed', { id: migration.id, error: (err as Error).message });
          throw toDatabaseError(err);
        }
      }

      logger.info('Rollback complete', { batch });
    } finally {
      client.release();
    }
  }

  // ── Pool management ──────────────────────────────────────────────────────────

  /**
   * Gracefully closes the database pool (call on SIGTERM/SIGINT).
   */
  static async shutdown(): Promise<void> {
    logger.info('Closing database pool...');
    await pool.end();
    logger.info('Database pool closed');
  }
}

export default DatabaseService;
