# Health Monitoring & Metrics

## Endpoints

### GET /health
Component-level health status (public)

**Response (200):**
```json
{
  "status": "success",
  "message": "Health status",
  "data": {
    "overall": "healthy",
    "timestamp": "2024-01-01T12:00:00Z",
    "components": {
      "database": {"status": "healthy", "responseTimeMs": 5},
      "redis": {"status": "healthy", "responseTimeMs": 2, "details": {"memoryUsed": 123456}},
      "stellar": {"status": "healthy", "responseTimeMs": 150},
      "system": {"status": "healthy", "details": {"uptime": 3600}}
    },
    "version": "v1.0.0",
    "uptime": 3600,
    "environment": "production"
  }
}
```

### GET /metrics
Prometheus metrics (text/plain)

**Curl:**
```
curl http://localhost:3000/metrics
```

### GET /ready
Readiness probe (k8s compatible)

## Metrics Tracked

- **Requests:** http_requests_total, http_request_duration_ms (p50/p95/p99), http_request_errors_total
- **Health:** health_degraded_components
- **System:** app_uptime_seconds, process_memory_usage_bytes, system_cpu_load_average
- **DB:** database_connections_active
- **Redis:** redis_memory_used_bytes

## Grafana Dashboard

Import `dashboards/health-dashboard.json`

**Key Panels:**
- Health Status (degraded components count)
- Request Duration P95
- Error Rate %
- Request Rate (timeseries)
- System Memory & Uptime

## Setup Guide

1. **Prometheus scrape:** 
   ```
   scrape_configs:
     - job_name: 'mentorminds'
       static_configs:
         - targets: ['localhost:3000']
       metrics_path: /metrics
   ```

2. **Grafana:** Add Prometheus DS, import dashboard JSON.

3. **Structured Logging:** Enabled by default in dev.

## Alerts

```
- Error rate > 5%
- Request duration P99 > 500ms
- Degraded components > 1
- Memory usage > 80%
```

## Testing

```bash
npm test
curl /health
curl /metrics | grep http_request
```

