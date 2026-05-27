# Database Connection Pool Tuning

This document records the recommended PostgreSQL pool settings for MentorMinds Backend after load testing at 100, 500, and 1000 concurrent clients.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_POOL_MAX` | `20` | Maximum pool size |
| `DB_POOL_MIN` | `4` | Minimum idle connections |
| `DB_IDLE_TIMEOUT_MS` | `30000` | Close idle clients after 30s |
| `DB_CONNECTION_TIMEOUT_MS` | `2000` | Fail fast when pool is saturated |
| `DB_STATEMENT_TIMEOUT_MS` | `10000` | Cancel long-running queries |
| `DB_POOL_EXHAUSTION_THRESHOLD` | `90` | Alert when utilization exceeds this % |

## Recommended production values

Based on load tests (`npm run load-test:db -- --suite`):

| Concurrent users | Suggested `DB_POOL_MAX` | Notes |
|------------------|-------------------------|-------|
| 100 | 20 | Default handles sustained API traffic |
| 500 | 40 | Increase max and ensure Postgres `max_connections` allows headroom |
| 1000 | 60 | Pair with PgBouncer or read replicas for heavy read workloads |

Always set `DB_POOL_MIN=4` so warm connections are available after traffic spikes.

## Monitoring

Prometheus gauges:

- `db_pool_total_connections`
- `db_pool_idle_connections`
- `db_pool_waiting_clients`
- `db_pool_utilization_percent`
- `db_pool_exhaustion_alerts_total`

The pool monitor runs every 15 seconds and logs a warning when utilization crosses `DB_POOL_EXHAUSTION_THRESHOLD` or clients are waiting for connections.

## Running load tests

```bash
# Single level (100 concurrent, 3 iterations)
npx ts-node src/scripts/load-test-db.ts 100 3

# Full suite: 100, 500, 1000 concurrent
npx ts-node src/scripts/load-test-db.ts --suite
```
