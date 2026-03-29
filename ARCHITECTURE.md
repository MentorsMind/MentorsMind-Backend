# MentorsMind — Scaling Architecture

This document describes how the MentorsMind backend is structured for horizontal
scaling behind a load balancer: what state lives where, how WebSocket pub/sub
works across instances, and how to validate a multi-instance deployment.

---

## Table of Contents

1. [Overview](#overview)
2. [Stateless Principles](#stateless-principles)
3. [Shared State — Redis](#shared-state--redis)
4. [Load Balancer Configuration](#load-balancer-configuration)
5. [WebSocket Multi-Instance Pub/Sub](#websocket-multi-instance-pubsub)
6. [BullMQ — Shared Queue](#bullmq--shared-queue)
7. [Rate Limiting](#rate-limiting)
8. [Instance Identity and Log Correlation](#instance-identity-and-log-correlation)
9. [nginx Reference Configuration](#nginx-reference-configuration)
10. [Verifying a Two-Instance Deployment](#verifying-a-two-instance-deployment)
11. [Kubernetes / Docker Compose Notes](#kubernetes--docker-compose-notes)
12. [Known Limitations](#known-limitations)

---

## Overview

```
                         ┌──────────────────────────────────────────────┐
                         │             Load Balancer (nginx)            │
                         │          Round-robin, no sticky sessions     │
                         └─────────────────┬────────────────────────────┘
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  │                        │                        │
          ┌───────┴───────┐        ┌───────┴───────┐        ┌──────┴────────┐
          │  API Instance │        │  API Instance │        │  API Instance │
          │   :5000       │        │   :5001       │        │   :5002       │
          └───────┬───────┘        └───────┬───────┘        └──────┬────────┘
                  │                        │                        │
                  └────────────────────────┼────────────────────────┘
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  │                        │                        │
          ┌───────┴───────┐        ┌───────┴───────┐        ┌──────┴────────┐
          │    Redis       │        │  PostgreSQL   │        │  BullMQ       │
          │  (shared)      │        │  (shared)     │        │  (via Redis)  │
          └───────────────┘        └───────────────┘        └───────────────┘
```

All API replicas are **identical and interchangeable**. No instance holds unique
state. Any request can be served by any instance.

---

## Stateless Principles

| What | Where it lives | Notes |
|------|---------------|-------|
| JWT session tokens | Client (stateless JWT) | Verified from the token payload — no server-side session store |
| Presence (online/offline) | Redis `online:{userId}` keys with TTL | `PresenceService` reads/writes Redis |
| Rate-limit counters | Redis sorted sets `rl:sw:{key}` | Falls back to in-memory only if Redis is unavailable |
| WebSocket room membership | Socket.IO Redis adapter | Rooms synced via Redis pub/sub across all instances |
| Background job queues | BullMQ → Redis | All instances share one queue; a job is claimed by exactly one worker |
| File uploads | Object storage (S3 / GCS) | Never stored on the instance disk |
| Cached responses | Redis | `cache.middleware.ts` reads/writes shared Redis |

**Nothing is stored in Node.js process memory that must survive a restart or that must be visible to other instances.**

---

## Shared State — Redis

Redis is the single source of truth for all shared transient state. Connection
configuration (`REDIS_URL`) must point every instance at the same Redis cluster.

### Key namespaces

| Prefix | Owner | TTL | Purpose |
|--------|-------|-----|---------|
| `mm:` | `redis.config.ts` keyPrefix | Varies | General app cache (responses, templates) |
| `online:{userId}` | `PresenceService` | 30 s | Online/offline heartbeat |
| `rl:sw:{key}` | `RateLimiterService` | Window duration | Sliding-window rate-limit counters |
| `bull:` | BullMQ | Job-lifetime | Queue job data, locks, delayed sets |
| `socket.io#` | `@socket.io/redis-adapter` | Ephemeral | Cross-instance event routing |

---

## Load Balancer Configuration

- **Algorithm**: round-robin (or least-connections for imbalanced traffic)
- **Sticky sessions**: **not required** — all sessions are stateless JWTs
- **WebSocket upgrade**: must proxy `Upgrade: websocket` and `Connection: upgrade` headers
- **Health check**: `GET /health` — returns 200 when the instance is ready

---

## WebSocket Multi-Instance Pub/Sub

Socket.IO's default in-memory adapter only delivers events to sockets connected
to the **same process**. In a multi-instance deployment, `io.to('user:abc').emit(…)`
from instance A would silently drop the event if the user's socket is connected
to instance B.

**Solution**: `@socket.io/redis-adapter`

`src/config/socket.ts` creates two dedicated `ioredis` connections for the adapter:

```
Instance A                    Redis                     Instance B
─────────────────────────────────────────────────────────────────
emit('user:alice', event)
  │
  └─► pubClient.publish(channel, payload)
                              ┌─► subClient.message
                                     │
                                     └─► socket.to('user:alice').emit(event)
                                         (delivered to Alice's socket on B)
```

The two pub/sub connections are **separate** from the main application `redis`
client — pub/sub puts a connection into subscriber mode which prevents it from
executing regular commands.

### Enabling the adapter

The adapter activates automatically when `REDIS_URL` is set. If `REDIS_URL` is
absent (local dev without Redis), the server logs a warning and falls back to
the single-instance in-memory adapter.

```
Socket.IO: REDIS_URL not set — using in-memory adapter.
WebSocket events will NOT be broadcast across multiple instances.
```

---

## BullMQ — Shared Queue

All BullMQ queues use `src/queues/queue.config.ts` which derives
`redisConnection` from `REDIS_URL`. Every instance connects to the same Redis,
so:

- **Producers** (any instance) add jobs to the shared queue.
- **Consumers** (workers on any instance) compete for jobs; each job is claimed
  by exactly one worker via a Redis lock.
- **Failed job inspection** via the Bull Board UI (mounted at `/api/v1/jobs`)
  shows the global job state — works correctly from any instance.

### Critical connection settings

```ts
maxRetriesPerRequest: null  // required — BullMQ uses blocking BLPOP/BRPOP
enableOfflineQueue: false   // fail fast if Redis is unreachable
```

These are set in `src/queues/queue.config.ts`. The `maxRetriesPerRequest: null`
setting is **mandatory** for BullMQ workers — without it ioredis retries blocking
commands and throws `MaxRetriesPerRequestError`.

---

## Rate Limiting

`src/services/rate-limiter.service.ts` implements a Redis-backed sliding window
counter (`ZADD` + `ZREMRANGEBYSCORE` + `ZCARD`). When Redis is available, rate
limit counters are shared across all instances — a user who hits their limit on
instance A is also limited on instance B.

If Redis becomes unavailable the service falls back to an in-memory window (per
instance). During a Redis outage each instance enforces limits independently,
which may allow slightly more requests through than intended but never blocks
valid requests.

---

## Instance Identity and Log Correlation

Each instance stamps every log line with a stable `instanceId` so that logs from
multiple replicas can be filtered independently:

```json
{
  "level": "info",
  "message": "Socket.IO: Client connected",
  "instanceId": "api-pod-3",
  "userId": "abc123",
  "socketId": "xyz789",
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

**Configuration**:

| Priority | Source |
|----------|--------|
| 1 | `INSTANCE_ID` environment variable (set by orchestrator) |
| 2 | `os.hostname()` (Docker container name / Kubernetes pod name) |
| 3 | Random suffix `instance-<6 chars>` (fallback) |

Set `INSTANCE_ID` explicitly in production:

```yaml
# Kubernetes
env:
  - name: INSTANCE_ID
    valueFrom:
      fieldRef:
        fieldPath: metadata.name   # e.g. "mentorminds-api-6d8f7c4-xk2pq"
```

```yaml
# Docker Compose
environment:
  - INSTANCE_ID=api-1
```

---

## nginx Reference Configuration

```nginx
upstream mentorminds_api {
    least_conn;
    server api-1:5000;
    server api-2:5000;
    server api-3:5000;

    keepalive 32;
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name api.mentorminds.io;

    # HTTP health check passthrough (no auth)
    location /health {
        proxy_pass http://mentorminds_api;
        proxy_set_header Host $host;
    }

    # WebSocket upgrade — required for Socket.IO
    location /socket.io/ {
        proxy_pass http://mentorminds_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;   # keep long-lived WS connections alive
        proxy_send_timeout 3600s;
    }

    # REST API
    location /api/ {
        proxy_pass http://mentorminds_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";      # enable keepalive to upstream
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Note**: No `ip_hash` — sticky sessions are not required.

---

## Verifying a Two-Instance Deployment

### 1. Start two instances

```bash
INSTANCE_ID=api-1 PORT=5000 REDIS_URL=redis://localhost:6379 node dist/server.js &
INSTANCE_ID=api-2 PORT=5001 REDIS_URL=redis://localhost:6379 node dist/server.js &
```

Start nginx with the upstream pointing at both (see config above).

### 2. Confirm Redis adapter is active

Both instances should log:
```
Socket.IO: Redis adapter attached — multi-instance pub/sub active
```

### 3. Connect two WebSocket clients via the load balancer

```js
// Client A — connects (may land on api-1)
const socketA = io('http://localhost:80', { auth: { token: jwtForAlice } });

// Client B — connects (may land on api-2)
const socketB = io('http://localhost:80', { auth: { token: jwtForBob } });
```

### 4. Emit from instance A, verify delivery on instance B

Trigger an action that causes the server to emit to Alice's room (e.g. Bob sends
Alice a booking request). Verify that socketA receives the event even though it
may be connected to a different instance than the one that processed the booking.

```js
socketA.on('booking:received', (data) => {
  console.assert(data.fromUserId === bobId, 'Cross-instance delivery works');
});
```

### 5. Verify rate limiting is shared

Send 101 requests (above the default `general` limit of 100) from the same IP
alternating between both instances via the load balancer. The 101st request
should return `429` regardless of which instance handles it.

### 6. Confirm log correlation

Tail logs from both instances and check that `instanceId` differs:
```bash
tail -f logs/app-*.log | jq -r '[.instanceId, .message] | @tsv'
# api-1   HTTP GET /api/v1/users - 200
# api-2   HTTP GET /api/v1/bookings - 200
```

---

## Kubernetes / Docker Compose Notes

### Docker Compose (local multi-instance test)

```yaml
# docker-compose.scale.yml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  api:
    build: .
    environment:
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    deploy:
      replicas: 2   # spin up 2 API containers
    depends_on: [redis]

  nginx:
    image: nginx:alpine
    ports: ["80:80"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on: [api]
```

```bash
docker compose -f docker-compose.yml -f docker-compose.scale.yml up --scale api=2
```

### Kubernetes

- Set `INSTANCE_ID` from `metadata.name` (see [Instance Identity](#instance-identity-and-log-correlation))
- Use a `ClusterIP` Service + `Deployment` with `replicas: N`
- Redis: use a managed service (ElastiCache, Upstash, Redis Cloud) or the Bitnami Helm chart
- Horizontal Pod Autoscaler (HPA) safe — no warm-up state needed

---

## Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|-----------|
| Bull Board UI shows all jobs but job detail (`/jobs/:id`) fetches from Redis — works correctly across instances | None | — |
| Socket.IO `@socket.io/redis-adapter` adds ~1–2 ms latency per emit due to Redis round-trip | Minimal for chat/notification use cases | Use local adapter in dev; upgrade Redis if needed |
| In-memory rate-limit fallback during Redis outage is per-instance | Slightly permissive during outage | Alert on Redis connection errors; use Redis Sentinel / Cluster for HA |
| Presence TTL (30 s) means offline detection lags by up to 30 s | Acceptable for UX | Reduce TTL if tighter presence is needed (tradeoff: more Redis writes) |
