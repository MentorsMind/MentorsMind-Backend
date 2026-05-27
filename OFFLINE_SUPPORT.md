# Offline Support — MentorsMind Backend

This document describes the server-side offline support strategy for the MentorsMind mobile app.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Caching — Snapshots](#data-caching--snapshots)
4. [Action Queue — Offline Writes](#action-queue--offline-writes)
5. [Sync on Reconnect](#sync-on-reconnect)
6. [Conflict Detection & Resolution](#conflict-detection--resolution)
7. [API Reference](#api-reference)
8. [Socket.IO Events](#socketio-events)
9. [Database Schema](#database-schema)
10. [Mobile Client Integration Guide](#mobile-client-integration-guide)
11. [Maintenance & Cleanup](#maintenance--cleanup)

---

## Overview

The offline support system allows the MentorsMind mobile app to:

- **Cache user data locally** — download a full data snapshot before going offline
- **Queue actions while offline** — capture writes (bookings, messages, notes, etc.) locally
- **Sync when connection is restored** — upload queued actions and download changed data
- **Handle sync conflicts** — detect and resolve data conflicts with three strategies

The implementation is entirely server-side. The mobile client is responsible for local storage (SQLite, AsyncStorage, etc.) and calling the sync API on reconnect.

---

## Architecture

```
Mobile App (offline)                    MentorsMind Backend
─────────────────────────────────────────────────────────────
                                        ┌─────────────────────┐
  1. GET /offline/snapshot  ──────────► │ OfflineCacheService │
     ◄── Full data bundle               │  (Redis + Postgres) │
                                        └─────────────────────┘
  [goes offline]
  [captures actions locally]

  2. POST /offline/sync     ──────────► ┌─────────────────────┐
     { syncState, actions }             │ OfflineSyncService  │
     ◄── { deltas, results }            │                     │
                                        │ OfflineQueueService │
                                        │ OfflineCacheService │
                                        └─────────────────────┘
  3. Apply deltas locally
  4. Resolve conflicts (if any)
```

**Key components:**

| Component | File | Responsibility |
|---|---|---|
| `OfflineCacheService` | `src/services/offline-cache.service.ts` | Build snapshots, compute deltas, track sync state |
| `OfflineQueueService` | `src/services/offline-queue.service.ts` | Persist, process, and conflict-check queued actions |
| `OfflineSyncService` | `src/services/offline-sync.service.ts` | Orchestrate the full sync cycle |
| `OfflineController` | `src/controllers/offline.controller.ts` | HTTP request handling |
| Routes | `src/routes/offline.routes.ts` | Mounted at `/api/v1/offline` |
| Migration | `database/migrations/057_create_offline_queue.sql` | DB schema |

---

## Data Caching — Snapshots

### Full Snapshot

Before going offline, the mobile client downloads a complete data bundle:

```
GET /api/v1/offline/snapshot
Authorization: Bearer <token>
```

Response:
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "generatedAt": "2026-05-27T10:00:00Z",
    "etag": "a1b2c3d4e5f6a7b8",
    "domains": {
      "profile": {
        "data": { "id": "...", "firstName": "Alice", ... },
        "lastSyncedAt": "2026-05-27T10:00:00Z",
        "recordCount": 1,
        "etag": "abc123"
      },
      "bookings": {
        "data": [ { "id": "...", "topic": "React", ... } ],
        "lastSyncedAt": "2026-05-27T10:00:00Z",
        "recordCount": 3,
        "etag": "def456"
      },
      "notifications": { ... },
      "goals": { ... },
      "messages": { ... }
    }
  }
}
```

**Snapshot contents:**
| Domain | Data included |
|---|---|
| `profile` | User profile (name, bio, avatar, timezone) |
| `bookings` | Upcoming bookings (next 30 days, non-cancelled) |
| `notifications` | Last 50 notifications |
| `goals` | Active goals (non-archived) |
| `messages` | Last 100 messages across all conversations |

**Conditional requests (ETag):**

The client should store the `etag` and send it on subsequent requests:

```
GET /api/v1/offline/snapshot
If-None-Match: a1b2c3d4e5f6a7b8
```

If data hasn't changed, the server returns `304 Not Modified` — no data transfer needed.

**Caching:** Snapshots are cached in Redis for 5 minutes. Use `?refresh=true` to force a rebuild.

---

### Delta Sync

Instead of re-downloading the full snapshot, the client can request only changed records:

```
GET /api/v1/offline/delta?domain=bookings&since=2026-05-01T00:00:00Z
Authorization: Bearer <token>
```

Response:
```json
{
  "success": true,
  "data": {
    "domain": "bookings",
    "since": "2026-05-01T00:00:00Z",
    "records": [ { "id": "...", "status": "confirmed", ... } ],
    "deletedIds": [ "uuid-of-cancelled-booking" ],
    "newEtag": "xyz789",
    "recordCount": 2
  }
}
```

**Supported domains:** `bookings`, `notifications`, `profile`, `goals`, `messages`

**`deletedIds`** contains IDs of records that should be removed from the client's local store (e.g. cancelled bookings, archived goals).

---

## Action Queue — Offline Writes

While offline, the mobile client captures user actions locally. On reconnect, it submits them to the server.

### Supported Action Types

| Action Type | Required Payload Fields |
|---|---|
| `booking:create` | `mentorId`, `scheduledAt`, `durationMinutes`, `topic`, `notes?` |
| `booking:cancel` | `bookingId`, `reason?` |
| `booking:reschedule` | `bookingId`, `newScheduledAt`, `reason?` |
| `review:create` | `sessionId`, `rating`, `comment?` |
| `note:create` | `sessionId`, `content` |
| `note:update` | `noteId`, `content` |
| `goal:update` | `goalId`, `updates` (partial Goal object) |
| `profile:update` | `firstName?`, `lastName?`, `bio?`, `notificationPreferences?` |
| `message:send` | `conversationId`, `content` |

### Enqueue a Single Action

```
POST /api/v1/offline/queue
Authorization: Bearer <token>
Content-Type: application/json

{
  "clientKey": "550e8400-e29b-41d4-a716-446655440000",
  "actionType": "booking:cancel",
  "payload": {
    "bookingId": "uuid",
    "reason": "Schedule conflict"
  },
  "clientTimestamp": "2026-05-27T09:30:00Z"
}
```

- `clientKey` — a UUID generated by the client. Used for idempotency: re-submitting the same key is safe.
- `clientTimestamp` — when the action was captured on the device. Used for ordering.

Response:
```json
{
  "success": true,
  "data": { "actionId": "server-uuid", "status": "pending" }
}
```

---

## Sync on Reconnect

The primary sync endpoint handles everything in one call:

```
POST /api/v1/offline/sync
Authorization: Bearer <token>
Content-Type: application/json

{
  "syncState": {
    "domains": {
      "bookings": "2026-05-20T00:00:00Z",
      "notifications": "2026-05-20T00:00:00Z",
      "profile": "2026-05-20T00:00:00Z",
      "goals": "2026-05-20T00:00:00Z",
      "messages": "2026-05-20T00:00:00Z"
    }
  },
  "actions": [
    {
      "clientKey": "uuid-1",
      "actionType": "booking:cancel",
      "payload": { "bookingId": "uuid", "reason": "Conflict" },
      "clientTimestamp": "2026-05-25T14:00:00Z"
    },
    {
      "clientKey": "uuid-2",
      "actionType": "note:create",
      "payload": { "sessionId": "uuid", "content": "Great session!" },
      "clientTimestamp": "2026-05-25T15:00:00Z"
    }
  ]
}
```

Response:
```json
{
  "success": true,
  "data": {
    "syncedAt": "2026-05-27T10:05:00Z",
    "deltas": {
      "bookings": {
        "records": [ ... ],
        "deletedIds": [ "uuid" ],
        "newEtag": "abc",
        "recordCount": 1
      },
      "notifications": { ... }
    },
    "actionResults": [
      { "clientKey": "uuid-1", "status": "completed", "result": { "bookingId": "uuid", "status": "cancelled" } },
      { "clientKey": "uuid-2", "status": "completed", "result": { "noteId": "uuid" } }
    ],
    "conflicts": [],
    "summary": {
      "domainsUpdated": 2,
      "actionsProcessed": 2,
      "actionsCompleted": 2,
      "actionsFailed": 0,
      "conflictsDetected": 0
    }
  }
}
```

**Processing order:** Actions are processed in `clientTimestamp` order to preserve causality.

**Socket.IO notification:** After sync completes, the server emits `offline:sync:complete` to the user's socket room.

---

## Conflict Detection & Resolution

### When Conflicts Occur

The server detects conflicts before executing an action:

| Action | Conflict condition |
|---|---|
| `booking:cancel` | Booking already cancelled or completed |
| `booking:reschedule` | Booking already cancelled/completed, or server updated it after client went offline |
| `note:update` | Note was modified on the server after the client's offline snapshot |
| `profile:update` | Profile was updated on the server after the client's offline snapshot |

### Conflict Response

When a conflict is detected, the action gets `status: "conflict"` with details:

```json
{
  "clientKey": "uuid-1",
  "status": "conflict",
  "conflictData": {
    "type": "booking_state_changed",
    "currentStatus": "completed",
    "serverUpdatedAt": "2026-05-26T12:00:00Z",
    "message": "Booking is already completed on the server."
  }
}
```

The server also emits `offline:conflict` via Socket.IO so the client can prompt the user immediately.

### Resolving Conflicts

```
POST /api/v1/offline/conflicts/:actionId/resolve
Authorization: Bearer <token>
Content-Type: application/json

{
  "strategy": "client_wins"
}
```

**Strategies:**

| Strategy | Behaviour |
|---|---|
| `client_wins` | Re-process the action, overwriting server state |
| `server_wins` | Discard the action, keep server state |
| `merge` | Apply a client-supplied `mergedPayload` (manual merge) |

**Merge example:**
```json
{
  "strategy": "merge",
  "mergedPayload": {
    "noteId": "uuid",
    "content": "Combined content from both versions"
  }
}
```

---

## API Reference

All endpoints require `Authorization: Bearer <token>`.

| Method | Path | Description | Rate limit |
|---|---|---|---|
| `GET` | `/api/v1/offline/snapshot` | Full data snapshot | 5/min |
| `GET` | `/api/v1/offline/sync-state` | Sync state per domain | — |
| `GET` | `/api/v1/offline/delta` | Delta update for a domain | — |
| `POST` | `/api/v1/offline/queue` | Enqueue a single action | — |
| `GET` | `/api/v1/offline/queue` | List queued actions | — |
| `GET` | `/api/v1/offline/queue/status` | Queue status summary | — |
| `POST` | `/api/v1/offline/sync` | Full sync (actions + deltas) | 10/min |
| `POST` | `/api/v1/offline/conflicts/:id/resolve` | Resolve a conflict | — |

---

## Socket.IO Events

The server emits these events to the user's personal room (`user:{userId}`):

| Event | When | Payload |
|---|---|---|
| `offline:sync:complete` | After sync completes | `{ syncedAt, actionsCompleted, actionsFailed, conflictsDetected, domainsUpdated }` |
| `offline:conflict` | When a conflict is detected | `{ clientKey, conflictData }` |

The client should listen for `offline:sync:complete` to know when to apply deltas, and `offline:conflict` to prompt the user for conflict resolution.

**Reconnect handling:** When the Socket.IO client reconnects, the server automatically processes any pending queue items and emits `offline:sync:complete`. The client should then call `GET /api/v1/offline/delta` for each domain to get updated data.

---

## Database Schema

### `offline_action_queue`

Stores actions captured while the client was offline.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Server-assigned action ID |
| `user_id` | UUID | Owner (FK → users) |
| `client_key` | VARCHAR(36) | Client UUID for idempotency |
| `action_type` | VARCHAR(64) | e.g. `booking:cancel` |
| `payload` | JSONB | Action-specific data |
| `status` | VARCHAR(16) | `pending` / `processing` / `completed` / `failed` / `conflict` |
| `client_timestamp` | TIMESTAMPTZ | When captured on device (used for ordering) |
| `result` | JSONB | Server result after processing |
| `error_message` | TEXT | Error details if failed |
| `conflict_data` | JSONB | Conflict details if conflicted |
| `attempt_count` | INT | Number of processing attempts |
| `max_attempts` | INT | Max retries (default 3) |

### `offline_sync_state`

Tracks the last sync checkpoint per user per domain.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | Owner (FK → users) |
| `domain` | VARCHAR(32) | e.g. `bookings` |
| `last_synced_at` | TIMESTAMPTZ | Cursor for delta queries |
| `etag` | VARCHAR(64) | Hash of last snapshot |
| `record_count` | INT | Records in last snapshot |

---

## Mobile Client Integration Guide

### Recommended Flow

```
App startup:
  1. Load local data from SQLite/AsyncStorage
  2. Check network connectivity
  3. If online: GET /offline/snapshot (with If-None-Match)
     - If 304: use local data
     - If 200: update local store with snapshot

Going offline:
  4. Continue using local data
  5. Capture user actions with UUID + timestamp

Coming back online:
  6. POST /offline/sync with { syncState, actions }
  7. Apply deltas to local store
  8. If conflicts: prompt user to resolve
  9. POST /offline/conflicts/:id/resolve for each conflict
```

### Local Storage Schema (suggested)

```typescript
// Local action queue (before sync)
interface LocalAction {
  clientKey: string;      // UUID
  actionType: string;
  payload: object;
  clientTimestamp: string; // ISO 8601
  synced: boolean;
}

// Sync state (persisted locally)
interface LocalSyncState {
  domains: {
    bookings: string;       // ISO 8601 timestamp
    notifications: string;
    profile: string;
    goals: string;
    messages: string;
  };
}
```

### Handling the Sync Response

```typescript
const response = await fetch('/api/v1/offline/sync', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ syncState, actions: pendingActions }),
});

const { data } = await response.json();

// Apply deltas
for (const [domain, delta] of Object.entries(data.deltas)) {
  await localDb.upsertMany(domain, delta.records);
  await localDb.deleteMany(domain, delta.deletedIds);
  syncState.domains[domain] = data.syncedAt;
}

// Handle conflicts
for (const conflict of data.conflicts) {
  await showConflictDialog(conflict);
}

// Mark local actions as synced
for (const result of data.actionResults) {
  if (result.status === 'completed') {
    await localDb.markActionSynced(result.clientKey);
  }
}
```

---

## Maintenance & Cleanup

Completed and failed queue entries older than 7 days are automatically deleted by the daily maintenance job (runs at 04:00 UTC via `runMaintenanceTasks()` in `src/workers/scheduler.ts`).

To manually trigger cleanup:
```typescript
import { OfflineQueueService } from './services/offline-queue.service';
const deleted = await OfflineQueueService.cleanup(7); // older than 7 days
```

---

## Security Considerations

- All endpoints require authentication — users can only access their own queue and sync state
- `clientKey` must be a valid UUID — prevents injection attacks
- `actionType` is validated against an allowlist — unknown types are rejected
- `clientTimestamp` is used for ordering only — the server always uses `NOW()` for actual DB writes
- Rate limiting: snapshot (5/min), sync (10/min) — prevents abuse of expensive operations
- Conflict detection uses server timestamps — clients cannot forge conflict-free submissions
