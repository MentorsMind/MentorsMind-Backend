# Performance Benchmarks

Quick reference for running performance benchmarks.

## Quick Commands

```bash
# Run all benchmarks
npm run benchmark

# Create baseline
npm run benchmark:baseline

# Compare with baseline
npm run benchmark:compare
```

## Directory Structure

```
benchmarks/
├── config.ts          # Endpoint configurations
├── runner.ts          # Benchmark execution
├── comparator.ts      # Baseline comparison
├── index.ts           # CLI entry point
├── results/           # Results (gitignored)
│   ├── benchmark-*.json
│   ├── comparison-*.json
│   └── comparison.md
└── baseline/          # Baseline (committed)
    └── baseline.json
```

## Adding New Endpoints

Edit `config.ts`:

```typescript
"my.endpoint": {
  name: "My Endpoint",
  method: "GET",
  path: "/api/my-endpoint",
  thresholds: {
    p50: 100,   // 100ms median
    p95: 200,   // 200ms p95
    p99: 300,   // 300ms p99
    maxRegressionPercent: 10,
  },
  warmupRequests: 10,
  benchmarkRequests: 100,
}
```

## Interpreting Results

### Status Indicators
- 🟢 **Improved**: P95 decreased >5%
- ⚪ **Stable**: P95 changed <5%
- 🟡 **Warning**: P95 increased 5-10%
- 🔴 **Regression**: P95 increased >10%

### Example Output
```
✓ User Login
  Requests: 100
  Failures: 0
  Median: 95.30ms (threshold: 100ms)
  P95: 185.70ms (threshold: 200ms)
  P99: 245.10ms (threshold: 350ms)
```

## CI/CD

Benchmarks run automatically on:
- Pull requests (compare with baseline)
- Push to main (update baseline)
- Daily schedule (track trends)

## Troubleshooting

### Server Not Running
```bash
# Start server
npm run dev

# Check health
curl http://localhost:3000/api/health
```

### No Baseline
```bash
# Create baseline
npm run benchmark:baseline
```

### High Latencies
1. Check database performance
2. Verify Redis is running
3. Check system resources
4. Review recent code changes

## Resources

- [Full Documentation](../PERFORMANCE_BENCHMARKS.md)
- [Implementation Summary](../ISSUE_422_IMPLEMENTATION_SUMMARY.md)
