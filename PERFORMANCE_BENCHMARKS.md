# Performance Benchmarks

## Overview

This project includes comprehensive performance benchmarking for critical API endpoints to ensure consistent performance and detect regressions early.

## Quick Start

```bash
# Run benchmarks
npm run benchmark

# Create baseline
npm run benchmark:baseline

# Compare with baseline
npm run benchmark:compare
```

## Benchmarked Endpoints

### Auth Endpoints
- **POST /api/auth/register** - User registration
  - P95 Target: 300ms
- **POST /api/auth/login** - User login
  - P95 Target: 200ms
- **POST /api/auth/refresh** - Token refresh
  - P95 Target: 100ms
- **GET /api/auth/me** - Get current user
  - P95 Target: 75ms

### Search Endpoints
- **GET /api/v1/search/mentors** - Search mentors
  - P95 Target: 250ms
- **GET /api/v1/search/mentors (with filters)** - Filtered search
  - P95 Target: 350ms
- **GET /api/mentors** - List mentors
  - P95 Target: 200ms

### Payment Endpoints
- **POST /api/payments/initiate** - Initiate payment
  - P95 Target: 400ms
- **GET /api/payments/:id/status** - Get payment status
  - P95 Target: 120ms
- **GET /api/payments** - List user payments
  - P95 Target: 180ms
- **GET /api/payments/quote** - Get payment quote
  - P95 Target: 250ms

### Booking Endpoints
- **POST /api/bookings** - Create booking
  - P95 Target: 350ms
- **GET /api/bookings** - List user bookings
  - P95 Target: 160ms

## Performance Metrics

### Measured Metrics
- **P50 (Median)**: 50th percentile latency
- **P95**: 95th percentile latency (primary metric)
- **P99**: 99th percentile latency
- **Min/Max**: Minimum and maximum latencies
- **Mean**: Average latency
- **StdDev**: Standard deviation

### Thresholds
- **P95 Regression Threshold**: 10% increase triggers failure
- **P95 Warning Threshold**: 5% increase triggers warning
- **Success Rate**: 99% minimum (< 1% failures)

## Benchmark Process

### 1. Warmup Phase
- 10 requests to warm up the server
- Results discarded
- Ensures JIT compilation and cache warming

### 2. Benchmark Phase
- 100 requests per endpoint (configurable)
- Sequential execution for accurate timing
- Measures end-to-end latency

### 3. Analysis Phase
- Calculate percentiles (P50, P95, P99)
- Compare with baseline
- Detect regressions

## CI/CD Integration

### Automated Benchmarks
Benchmarks run automatically on:
- **Pull Requests**: Compare with baseline
- **Main Branch**: Update baseline if improved
- **Daily Schedule**: Track performance trends

### Regression Detection
- ✅ **Pass**: P95 within 10% of baseline
- ⚠️ **Warning**: P95 increased 5-10%
- ❌ **Fail**: P95 increased >10%

### PR Comments
Automated comments on PRs include:
- Performance comparison table
- Status indicators (improved/stable/warning/regression)
- Percentage changes for all metrics
- Link to detailed results

## Running Benchmarks Locally

### Prerequisites
```bash
# Start database and Redis
docker-compose up -d postgres redis

# Run migrations
npm run migrate:up

# Seed test data
npm run seed:test

# Start server
npm run dev
```

### Run Benchmarks
```bash
# In another terminal
npm run benchmark
```

### Create Baseline
```bash
# After verifying performance is good
npm run benchmark:baseline
```

### Compare with Baseline
```bash
# Run benchmarks
npm run benchmark

# Or compare existing results
npm run benchmark:compare
```

## Benchmark Configuration

### Endpoint Configuration
Located in `benchmarks/config.ts`:

```typescript
{
  "auth.login": {
    name: "User Login",
    method: "POST",
    path: "/api/auth/login",
    thresholds: {
      p50: 100,  // 100ms median
      p95: 200,  // 200ms p95
      p99: 350,  // 350ms p99
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  }
}
```

### Global Configuration
```typescript
{
  baseUrl: "http://localhost:3000",
  warmupRequests: 10,
  benchmarkRequests: 100,
  concurrency: 1,
  timeout: 30000,
  outputDir: "benchmarks/results",
  baselineDir: "benchmarks/baseline",
}
```

## Results

### Output Files
- `benchmarks/results/benchmark-{timestamp}.json` - Raw results
- `benchmarks/results/comparison-{timestamp}.json` - Comparison data
- `benchmarks/results/comparison.md` - Markdown report
- `benchmarks/baseline/baseline.json` - Baseline metrics

### Result Format
```json
{
  "endpoint": "auth.login",
  "name": "User Login",
  "metrics": {
    "count": 100,
    "min": 45.2,
    "max": 312.8,
    "mean": 98.5,
    "median": 95.3,
    "p95": 185.7,
    "p99": 245.1,
    "stdDev": 32.4
  },
  "thresholds": {
    "p50": 100,
    "p95": 200,
    "p99": 350
  },
  "passed": true,
  "failures": 0
}
```

## Interpreting Results

### Status Indicators
- 🟢 **Improved**: P95 decreased by >5%
- ⚪ **Stable**: P95 changed by <5%
- 🟡 **Warning**: P95 increased by 5-10%
- 🔴 **Regression**: P95 increased by >10%

### Example Output
```
✓ User Login
  Requests: 100
  Failures: 0
  Median: 95.30ms (threshold: 100ms)
  P95: 185.70ms (threshold: 200ms)
  P99: 245.10ms (threshold: 350ms)

🟢 Performance improved by 7.2%
  P50: 102.5ms → 95.3ms (-7.0%)
  P95: 200.0ms → 185.7ms (-7.2%)
  P99: 280.0ms → 245.1ms (-12.5%)
```

## Troubleshooting

### Benchmarks Failing
```bash
# Check server is running
curl http://localhost:3000/api/health

# Check database connection
psql $DATABASE_URL -c "SELECT 1"

# Check Redis connection
redis-cli ping

# View detailed logs
npm run benchmark 2>&1 | tee benchmark.log
```

### High Latencies
1. **Database**: Check query performance
   ```sql
   EXPLAIN ANALYZE SELECT ...
   ```

2. **Caching**: Verify Redis is working
   ```bash
   redis-cli INFO stats
   ```

3. **Network**: Check for network issues
   ```bash
   ping localhost
   ```

4. **Load**: Check system resources
   ```bash
   top
   htop
   ```

### Inconsistent Results
- Ensure no other processes are running
- Run multiple times and average
- Increase warmup requests
- Check for background jobs

## Best Practices

### DO ✅
- Run benchmarks on consistent hardware
- Use dedicated benchmark environment
- Warm up before benchmarking
- Run multiple iterations
- Compare with baseline
- Update baseline after improvements
- Monitor trends over time

### DON'T ❌
- Run benchmarks on production
- Run with other processes
- Skip warmup phase
- Compare different environments
- Ignore warnings
- Update baseline with regressions

## Performance Optimization

### If P95 is High
1. **Database Queries**
   - Add indexes
   - Optimize queries
   - Use connection pooling

2. **Caching**
   - Cache frequently accessed data
   - Use Redis for session storage
   - Implement query result caching

3. **Code**
   - Profile with flamegraphs
   - Optimize hot paths
   - Reduce allocations

4. **Infrastructure**
   - Scale horizontally
   - Upgrade hardware
   - Use CDN for static assets

### Monitoring
- Track P95 trends over time
- Set up alerts for regressions
- Monitor in production
- Use APM tools (Sentry, DataDog)

## Advanced Usage

### Custom Endpoints
Add to `benchmarks/config.ts`:

```typescript
"custom.endpoint": {
  name: "Custom Endpoint",
  method: "GET",
  path: "/api/custom",
  thresholds: {
    p50: 100,
    p95: 200,
    p99: 300,
    maxRegressionPercent: 10,
  },
}
```

### Custom Thresholds
Adjust thresholds based on endpoint complexity:
- Simple reads: P95 < 100ms
- Complex queries: P95 < 300ms
- Write operations: P95 < 500ms
- External API calls: P95 < 1000ms

### Load Testing
For load testing, use k6:
```bash
k6 run load-tests/search.k6.js
```

## Resources

- [Benchmarking Best Practices](https://github.com/GoogleChrome/lighthouse/blob/master/docs/variability.md)
- [Performance Budgets](https://web.dev/performance-budgets-101/)
- [P95 vs P99](https://www.dynatrace.com/news/blog/why-averages-suck-and-percentiles-are-great/)

## Support

For questions or issues:
1. Check existing benchmark results
2. Review documentation
3. Ask in team chat
4. Create an issue

---

**Current Status**: All endpoints meeting P95 targets ✅
