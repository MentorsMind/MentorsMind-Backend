# Database Connection Guide

## Overview

MentorsMind-Backend uses **PostgreSQL** via the `pg` library with a full connection-pooling setup, typed utilities, retry logic, transaction support, and a built-in migration runner.

---

## Configuration

All database config is driven by environment variables. Add them to your `.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/mentorminds
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mentorminds
DB_USER=postgres
DB_PASSWORD=yourpassword

# Pool tuning (optional — sensible defaults provided)
DB_POOL_MAX=20
DB_POOL_MIN=4
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=2000
```

---

## Files

| File | Purpose |
|------|---------|
| `src/config/database.ts` | Pool instance + `testConnection()` |
| `src/config/database-pool.config.ts` | Optimized pool (min/max, timeouts, error events) |
| `src/services/database.service.ts` | Transactions, retry logic, migration runner, health check |
| `src/utils/database.utils.ts` | paginate, exists, count, upsert, bulkInsert, error helpers |
| `src/types/database.types.ts` | TypeScript types for all DB operations |
| `src/utils/query-monitor.utils.ts` | Slow-query detection, per-query caching, N+1 tracking |
| `src/utils/seed-runner.utils.ts` | Seeding within a transaction with rollback |

---

## Usage

### Basic queries

```typescript
import pool from '../config/database';

const { rows } = await pool.query<User>('SELECT * FROM users WHERE id = $1', [userId]);
```

### Transactions

```typescript
import { DatabaseService } from '../services/database.service';

const order = await DatabaseService.withTransaction(async (client) => {
  const { rows } = await client.query('INSERT INTO orders (...) VALUES (...) RETURNING *', [...]);
  await client.query('UPDATE inventory SET stock = stock - 1 WHERE id = $1', [itemId]);
  return rows[0];
}, { isolationLevel: 'REPEATABLE READ', maxRetries: 3 });
```

### Retry logic

```typescript
// Retry a flaky external call or connection with exponential backoff
const result = await DatabaseService.withRetry(
  () => pool.query('SELECT 1'),
  { maxAttempts: 5, initialDelayMs: 200, maxDelayMs: 8000, backoffFactor: 2 },
);
```

### Pagination

```typescript
import { paginate } from '../utils/database.utils';

const result = await paginate<User>(
  'SELECT * FROM users WHERE active = $1',
  [true],
  { page: 2, limit: 20 },
);
// result.data, result.total, result.totalPages, result.hasNextPage
```

### Upsert

```typescript
import { upsert } from '../utils/database.utils';

await upsert('user_settings', { user_id: '...', theme: 'dark' }, {
  conflictColumns: ['user_id'],
  updateColumns: ['theme'],
});
```

### Exists / Count

```typescript
import { exists, count } from '../utils/database.utils';

const taken = await exists('users', 'email = $1', ['user@example.com']);
const total = await count('bookings', 'status = $1', ['pending']);
```

### Bulk insert

```typescript
import { bulkInsert } from '../utils/database.utils';

await bulkInsert('tags', ['name', 'slug'], [
  ['TypeScript', 'typescript'],
  ['Node.js', 'nodejs'],
]);
```

---

## Migrations

Migrations are tracked in a `_migrations` table (created automatically).

```typescript
import { DatabaseService } from '../services/database.service';
import type { Migration } from '../types/database.types';

const migration001: Migration = {
  id: '001_create_users',
  name: 'Create users table',
  up: async (client) => {
    await client.query(`CREATE TABLE users (id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL)`);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS users`);
  },
};

// Run all pending migrations
await DatabaseService.runMigrations([migration001]);

// Rollback the latest batch
await DatabaseService.rollbackMigrations([migration001]);
```

---

## Health Check

```typescript
const health = await DatabaseService.checkHealth();
// { connected: true, responseTimeMs: 3, poolStats: { totalCount, idleCount, waitingCount } }
```

---

## Error Handling

All database utility functions wrap raw pg errors into typed `DatabaseError` objects:

```typescript
import { toDatabaseError, isUniqueViolation } from '../utils/database.utils';

try {
  await pool.query('INSERT INTO users (email) VALUES ($1)', [email]);
} catch (err) {
  if (isUniqueViolation(err)) {
    throw new ConflictError('Email already in use');
  }
  throw toDatabaseError(err);
}
```

**Typed error codes:** `UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `NOT_NULL_VIOLATION`, `CHECK_VIOLATION`, `SERIALIZATION_FAILURE`, `QUERY_TIMEOUT`, `CONNECTION_FAILED`, `UNKNOWN`

---

## Query Best Practices

1. **Always use parameterized queries** — never string-interpolate user input
2. **Use `withTransaction`** for multi-statement operations that must succeed atomically
3. **Use `paginate()`** instead of manually writing LIMIT/OFFSET — it counts in a single round-trip
4. **Use `QueryMonitor.execute()`** for queries where you want automatic slow-query detection and Redis caching
5. **Check pool stats** with `getPoolStats()` to detect connection pressure under load

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `role "postgres" does not exist` | Test DB user missing | Create role: `createuser -s postgres` |
| `connect ECONNREFUSED` | Postgres not running | `brew services start postgresql` |
| Slow queries in logs | Missing index or large table scan | Run `EXPLAIN ANALYZE` via `QueryMonitor.explainQuery()` |
| `SERIALIZATION_FAILURE` | Concurrent transactions conflict | Use `withTransaction(..., { maxRetries: 3 })` |
| Pool exhausted | `DB_POOL_MAX` too low | Increase `DB_POOL_MAX` in env or optimize long-running queries |
