# MentorsMind Monitoring & APM

This document describes the metrics, tracing, and alerting setup for the MentorsMind backend.

---

## Table of Contents

1. [Overview](#overview)
2. [Prometheus Metrics](#prometheus-metrics)
3. [Distributed Tracing (OpenTelemetry)](#distributed-tracing-opentelemetry)
4. [Environment Variables](#environment-variables)
5. [Grafana Dashboard](#grafana-dashboard)
6. [Local Development Setup](#local-development-setup)
7. [Production Setup](#production-setup)
8. [Runbook](#runbook)

---

## Overview

MentorsMind uses two complementary observability pillars:

| Pillar | Tool | Purpose |
|--------|------|---------|
| Metrics | Prometheus + prom-client | Quantitative time-series (request rate, latency, errors) |
| Tracing | OpenTelemetry → Jaeger / Datadog | Distributed traces across HTTP, DB, Redis, queues |

Both are **opt-in at runtime** — the application starts and serves traffic even when neither is configured.

---

## Prometheus Metrics

### Scrape endpoint

| Environment | URL |
|-------------|-----|
| Local dev | `http://localhost:9464/metrics` |
| Production | `http://<internal-host>:${PROMETHEUS_PORT}/metrics` (not exposed publicly) |

The scrape endpoint is served by a **separate lightweight HTTP server** (`startMetricsServer()` in `src/middleware/metrics.middleware.ts`) so it can be firewall-restricted to the Prometheus scraper without touching the main API port.

### Registered metrics

#### HTTP

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `method`, `path`, `status_code` | Total HTTP requests |
| `http_request_duration_seconds` | Histogram | `method`, `path`, `status_code` | Request duration (seconds) |

Buckets for `http_request_duration_seconds`: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10`

#### WebSocket

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `active_websocket_connections` | Gauge | — | Currently open WebSocket connections |

#### Database (PostgreSQL)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `db_query_duration_seconds` | Histogram | `operation`, `table` | PostgreSQL query duration |

`operation` examples: `SELECT`, `INSERT`, `UPDATE`, `DELETE`

#### Redis

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `redis_call_duration_seconds` | Histogram | `command` | ioredis command duration |

`command` examples: `get`, `set`, `hgetall`, `zadd`

#### Queue (BullMQ)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `queue_job_duration_seconds` | Histogram | `queue_name`, `job_name`, `status` | Job processing duration |
| `queue_jobs_total` | Counter | `queue_name`, `job_name`, `status` | Total jobs processed |

`status` values: `completed`, `failed`

#### Stellar Horizon

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `stellar_api_call_duration_seconds` | Histogram | `operation`, `network` | Horizon API call duration |
| `stellar_api_calls_total` | Counter | `operation`, `network`, `status` | Total Horizon API calls |

`operation` examples: `loadAccount`, `submitTransaction`, `getTransactions`
`network` values: `testnet`, `mainnet`
`status` values: `success`, `error`

#### Default Node.js metrics

`collectDefaultMetrics()` is enabled, providing:

- `process_cpu_seconds_total`
- `process_heap_bytes`
- `nodejs_eventloop_lag_seconds`
- `nodejs_gc_duration_seconds`
- … and more

All default metrics carry the label `app=mentorminds`.

### Using metrics in code

Import individual instruments from `src/config/metrics.ts`:

```typescript
import { dbQueryDurationSeconds } from '../config/metrics';

const end = dbQueryDurationSeconds.startTimer({ operation: 'SELECT', table: 'users' });
const rows = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
end(); // records duration
```

```typescript
import { activeWebsocketConnections } from '../config/metrics';

wss.on('connection', (ws) => {
  activeWebsocketConnections.inc();
  ws.on('close', () => activeWebsocketConnections.dec());
});
```

```typescript
import { queueJobDurationSeconds, queueJobsTotal } from '../config/metrics';

worker.on('completed', (job, _result, durationMs) => {
  const seconds = durationMs / 1000;
  queueJobDurationSeconds.observe(
    { queue_name: worker.name, job_name: job.name, status: 'completed' },
    seconds,
  );
  queueJobsTotal.inc({ queue_name: worker.name, job_name: job.name, status: 'completed' });
});
```

---

## Distributed Tracing (OpenTelemetry)

### Activation

Call `initTracing()` as the **very first statement** in `src/server.ts` before any other imports:

```typescript
// server.ts
import { initTracing } from './config/tracing';
initTracing();           // must be first — patches modules at load time

import express from 'express';
// …
```

### Auto-instrumented libraries

| Library | Package |
|---------|---------|
| HTTP (incoming + outgoing) | `@opentelemetry/instrumentation-http` |
| Express routing | `@opentelemetry/instrumentation-express` |
| PostgreSQL (`pg`) | `@opentelemetry/instrumentation-pg` |
| Redis (`ioredis`) | `@opentelemetry/instrumentation-ioredis` |

`fs` and `dns` instrumentations are disabled to reduce span noise.

### Manual spans

Use `wrapWithSpan()` for code paths not covered by auto-instrumentation (BullMQ workers, Stellar calls):

```typescript
import { wrapWithSpan } from '../config/tracing';

// BullMQ worker
const result = await wrapWithSpan('queue.sessionReminder', async (span) => {
  span?.setAttribute('job.id', job.id);
  span?.setAttribute('queue.name', 'sessionReminder');
  return processReminder(job);
});

// Stellar Horizon call
const account = await wrapWithSpan('stellar.loadAccount', async (span) => {
  span?.setAttribute('stellar.operation', 'loadAccount');
  span?.setAttribute('stellar.network', env.STELLAR_NETWORK);
  return server.loadAccount(publicKey);
});
```

Spans are automatically ended and their status set to `OK` or `ERROR` by the helper.

### Exporters

| `OTEL_EXPORTER` value | Destination | Use case |
|-----------------------|-------------|----------|
| `jaeger` (default) | `JAEGER_ENDPOINT` (default: `http://localhost:14268/api/traces`) | Local development |
| `otlp` or `datadog` | `OTEL_EXPORTER_OTLP_ENDPOINT` (default: `http://localhost:4317`) | Production (Datadog Agent / OpenTelemetry Collector) |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROMETHEUS_ENABLED` | `true` | Enable/disable metrics collection |
| `PROMETHEUS_PORT` | `9464` | Port for the dedicated scrape server |
| `PROMETHEUS_ENDPOINT` | `/metrics` | Path served by the scrape server |
| `OTEL_EXPORTER` | `jaeger` | Tracing exporter: `jaeger` or `otlp`/`datadog` |
| `JAEGER_ENDPOINT` | `http://localhost:14268/api/traces` | Jaeger collector HTTP endpoint |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTLP/gRPC endpoint (Datadog Agent or collector) |

---

## Grafana Dashboard

The dashboard JSON is at `grafana/dashboard.json`. Import it via:

**Grafana UI → Dashboards → Import → Upload JSON file**

or via the Grafana API:

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -d @grafana/dashboard.json \
  http://grafana:3000/api/dashboards/import
```

### Panels included

- **Request rate** — `rate(http_requests_total[1m])` by method/status
- **Latency percentiles** — P50, P95, P99 for `http_request_duration_seconds`
- **Error rate** — 5xx responses as a percentage of total
- **Active WebSocket connections** — `active_websocket_connections`
- **DB query latency** — P95 for `db_query_duration_seconds`
- **Redis latency** — P95 for `redis_call_duration_seconds`
- **Queue throughput** — `rate(queue_jobs_total[5m])` by status
- **Stellar API latency** — P95 for `stellar_api_call_duration_seconds`
- **Node.js heap** — `nodejs_heap_size_used_bytes`
- **Event loop lag** — `nodejs_eventloop_lag_seconds`

---

## Local Development Setup

### 1. Start Jaeger (all-in-one)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 14268:14268 \
  jaegertracing/all-in-one:latest
```

Jaeger UI: http://localhost:16686

### 2. Start Prometheus

Add a scrape config to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: mentorminds
    static_configs:
      - targets: ['host.docker.internal:9464']
```

```bash
docker run -d --name prometheus \
  -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

### 3. Start Grafana

```bash
docker run -d --name grafana \
  -p 3001:3000 \
  grafana/grafana
```

Import `grafana/dashboard.json` as described above.

### 4. Start the backend

```bash
OTEL_EXPORTER=jaeger \
PROMETHEUS_ENABLED=true \
npm run dev
```

---

## Production Setup

### Datadog Agent (recommended)

Set `OTEL_EXPORTER=datadog` (or `otlp`) and point `OTEL_EXPORTER_OTLP_ENDPOINT` at the Datadog Agent's OTLP receiver port:

```bash
OTEL_EXPORTER=datadog
OTEL_EXPORTER_OTLP_ENDPOINT=http://datadog-agent:4317
```

Ensure the Datadog Agent has OTLP ingestion enabled (`DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_GRPC_ENDPOINT`).

### Prometheus scraping

Open `PROMETHEUS_PORT` (default `9464`) to your Prometheus scraper only. Block it from the public internet via firewall rules or a service mesh policy.

Recommended alert rules:

```yaml
# High error rate
- alert: HighErrorRate
  expr: rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
  for: 2m
  labels:
    severity: critical

# High P95 latency
- alert: HighLatency
  expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
  for: 5m
  labels:
    severity: warning

# Queue failures spiking
- alert: QueueFailures
  expr: rate(queue_jobs_total{status="failed"}[5m]) > 1
  for: 1m
  labels:
    severity: warning
```

---

## Runbook

### Metrics not appearing in Prometheus

1. Check `PROMETHEUS_ENABLED` is not `false`.
2. Verify the scrape server started: look for `Prometheus scrape target: http://0.0.0.0:<port>/metrics` in logs.
3. `curl http://localhost:9464/metrics` — should return Prometheus text format.
4. Check Prometheus target health at `http://prometheus:9090/targets`.

### No traces in Jaeger

1. Check `OTEL_EXPORTER=jaeger` is set (or unset — Jaeger is the default).
2. Verify `initTracing()` is called before any other imports in `server.ts`.
3. Look for `[Tracing] OpenTelemetry SDK started` in logs.
4. If you see `[Tracing] @opentelemetry packages not installed`, run:
   ```bash
   npm install @opentelemetry/sdk-node @opentelemetry/api \
     @opentelemetry/auto-instrumentations-node \
     @opentelemetry/resources @opentelemetry/semantic-conventions \
     @opentelemetry/exporter-jaeger
   ```

### High heap / memory growth

Check `nodejs_heap_size_used_bytes` in Grafana. Common causes:
- Large in-memory caches not evicting
- Event listener leaks on WebSocket server
- BullMQ jobs accumulating in completed/failed sets — configure `removeOnComplete` / `removeOnFail`.

### Queue jobs failing at high rate

Check `queue_jobs_total{status="failed"}` rate. Inspect BullMQ job logs with:
```bash
redis-cli LRANGE bull:<queue-name>:failed 0 20
```
