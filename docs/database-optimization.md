# Database Optimization and Monitoring Guide

## Query Optimization Strategies

1. **Avoid SELECT \***: Always specify exact columns needed for the feature instead of fetching the entire row context.
2. **Prevent N+1 Queries**: Never run queries inside loop iterations. Resolve nested relationships and batched lookups primarily through fewer queries or DataLoader patterns. The `QueryMonitor.execute` API accepts a `preventNPlusOne: true` parameter for annotating and logging safely batched queries.
3. **Query Caching**: Use the built-in Redis caching capability via `QueryMonitor` by supplying `useCache: true` and a `ttlSeconds` for frequently read, but rarely updated endpoint responses.
4. **Timeouts**: Define timeouts dynamically using `QueryMonitor.execute({ timeoutMs: <ms> })` to ensure anomalous long-running queries do not consume active connection pool slots.

## Indexing Guidelines

- **Foreign Keys**: Always build indexes on foreign keys (e.g., `user_id` on `transactions`, `reporter_id` on `disputes`).
- **Status and Types**: Index categorical columns frequently used in `WHERE` and `GROUP BY` patterns like transaction `status` or ledger `type`.
- **Composite Indexes**: Construct composite indexes carefully based on actual production querying shapes. Columns typically evaluated simultaneously should be sequentially indexed matching their selectivity level (selective first). Example: `(user_id, status)` rather than separate single-column indexes.
- **Timestamp Sorting**: Use descending indexes on temporal fields like `created_at DESC` especially when powering pagination `ORDER BY created_at DESC LIMIT X`.

## Performance Monitoring Guide

- **Slow Query Logging & Thresholds**: Any PostgreSQL executed query exceeding `500ms` duration is trapped automatically by `QueryMonitor` and logs a specialized warning tag.
- **Automatic Explain Plans**: When a slow query anomaly is encountered, an automatic `EXPLAIN (ANALYZE, FORMAT JSON)` runs against the guilty query syntax to recover and document the exact execution breakdown immediately beside the metric logging.
- **Connection Pool Monitoring**: Prevent database denial of service with a configured minimum pool of 4 and maximum of 20 as set in `database-pool.config.ts`, maintaining idle connection resilience.
