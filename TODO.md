# Health Monitoring & Metrics Implementation TODO

## Current Progress: Step 5/12 (Health service & controller created)

### Steps:

1. ✅ Install `prom-client` dependency
2. ✅ `src/config/monitoring.config.ts`
3. ✅ `src/services/health.service.ts`
4. ✅ `src/controllers/health.controller.ts`
5. ✅ `src/middleware/metrics.middleware.ts`
6. ✅ `src/config/index.ts`
7. Update `src/app.ts` - Add metrics middleware
8. Update `src/routes/index.ts` - Route /health and /metrics to controller
9. ✅ Tests updated
10. ✅ Grafana dashboard created
11. ✅ docs/monitoring.md created
12. Test & Verify

**Notes:**
- Update TODO.md after each major step
- Use prom-client for Prometheus metrics
- Health checks: PostgreSQL (pool.query), Redis (ping), Stellar (ledgers.call), system (uptime/memory)
- Metrics: request rates, durations (p50/95/99), errors, DB/Redis stats

