# Performance Testing Baseline

This doc records weekly load tests via k6 and baseline targets.

## Default CPU/Memory
- Runner: GitHub Actions ubuntu-latest
- Test duration: 60s each
- Thresholds defined inside scripts

## Baseline targets
- GET /api/v1/search/mentors: 100 VUs, 60s, p95 < 200ms
- POST /api/v1/bookings: 50 VUs, 60s, p95 < 500ms
- GET /api/v1/wallets/me/balance: 100 VUs, 60s, p95 < 300ms
- WebSocket connections: 500 VUs, 60s, no drops (ws_conn_failed < 1%)

## Example run output
- search p95: 180ms
- booking p95: 420ms
- wallet p95: 250ms
- websocket successful opens: >95%

## Notes
- Use `BASE_URL` and `BASE_WS_URL` environment variables for target deployment.
- Run locally: `k6 run load-tests/search.k6.js`.
