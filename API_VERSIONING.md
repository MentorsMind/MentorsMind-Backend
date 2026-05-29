# MentorsMind API Versioning Policy

This document defines how the MentorsMind backend introduces, maintains, and retires API versions so that clients can depend on a stable contract.

---

## Table of Contents

1. [Versioning Scheme](#versioning-scheme)
2. [URL Structure](#url-structure)
3. [Version Discovery](#version-discovery)
4. [Stability Guarantee](#stability-guarantee)
5. [Deprecation and Sunset Process](#deprecation-and-sunset-process)
6. [Response Headers](#response-headers)
7. [Adding a New Version](#adding-a-new-version)
8. [Modifying v1 Routes — PR Requirements](#modifying-v1-routes--pr-requirements)
9. [Version Registry](#version-registry)

---

## Versioning Scheme

MentorsMind uses **integer path versioning** (`v1`, `v2`, …). A version number is incremented only when a **breaking change** is introduced. Non-breaking additions (new endpoints, new optional fields, new query parameters) are released in the current version without a bump.

### Breaking vs. non-breaking changes

| Change | Breaking? | Version bump required? |
|--------|-----------|----------------------|
| Remove or rename an endpoint | Yes | Yes |
| Remove or rename a required field | Yes | Yes |
| Change the type of an existing field | Yes | Yes |
| Add a new **required** request field | Yes | Yes |
| Add a new **optional** request field | No | No |
| Add a new response field | No | No |
| Add a new endpoint | No | No |
| Change an HTTP status code | Yes | Yes |
| Change authentication requirements | Yes | Yes |

---

## URL Structure

All API endpoints are prefixed with `/api/<version>/`:

```
https://api.mentorminds.io/api/v1/auth/login
https://api.mentorminds.io/api/v1/bookings
https://api.mentorminds.io/api/v2/bookings   ← future
```

Header-based version negotiation (`Accept-Version`) is supported as a **fallback only** for clients that cannot control URL paths. URL versioning always takes precedence.

---

## Version Discovery

`GET /api/versions` returns the full catalogue of known versions:

```jsonc
// GET /api/versions
{
  "status": "success",
  "data": {
    "current": "v1",
    "supported": ["v1"],
    "versions": [
      {
        "version": "v1",
        "active": true,
        "current": true,
        "links": { "docs": "/api/v1/docs" }
      },
      {
        "version": "v2",
        "active": false,
        "current": false,
        "links": { "docs": null }
      }
    ]
  }
}
```

Once v2 is released, a deprecated v1 entry looks like:

```jsonc
{
  "version": "v1",
  "active": true,
  "current": false,
  "deprecatedAt": "2026-06-01T00:00:00Z",
  "sunsetAt":     "2026-12-01T00:00:00Z",
  "deprecationMessage": "v1 is deprecated. Please migrate to v2 before 2026-12-01.",
  "links": { "docs": "/api/v1/docs" }
}
```

---

## Stability Guarantee

| Period | Commitment |
|--------|-----------|
| **Active** (not deprecated) | No breaking changes. Only additive, backwards-compatible updates. |
| **Deprecated** | Continues to function. Breaking changes will not be backported. New features will not be added. |
| **Sunset** | Version is decommissioned and all requests return `410 Gone`. |

**Minimum support window**: v1 will be maintained for at least **6 months** after v2 is released and marked stable. The exact sunset date is published in the `sunsetAt` field of `GET /api/versions` and in `Sunset` response headers.

---

## Deprecation and Sunset Process

1. **Announce** — Update `src/config/api-versions.config.ts`:
   ```ts
   v1: {
     version: 'v1',
     active: true,
     deprecatedAt: '2026-06-01T00:00:00Z',   // ← add this
     sunsetAt:     '2026-12-01T00:00:00Z',    // ← and this (≥ 6 months after v2 stable)
     deprecationMessage: 'v1 is deprecated. Please migrate to v2.',
   },
   ```
   This automatically injects `Deprecation` and `Sunset` HTTP headers on every v1 response (via `versioningMiddleware`).

2. **Notify** — Post a changelog entry, email affected API consumers, and update the developer portal.

3. **Monitor** — Track v1 usage via `http_requests_total{path=~"/api/v1/.*"}` in Grafana. Do not sunset while traffic is material.

4. **Sunset** — On the sunset date, set `active: false` for v1 in `api-versions.config.ts`. The router stops mounting v1; all requests return `410 Gone` from the not-found handler.

---

## Response Headers

Every API response includes versioning headers set by `src/middleware/versioning.middleware.ts`:

| Header | Example | Description |
|--------|---------|-------------|
| `X-API-Version` | `v1` | The version that served this request |
| `X-Supported-Versions` | `v1` | Comma-separated list of active versions |
| `Deprecation` | `2026-06-01T00:00:00Z` | ISO 8601 date the version was deprecated (only when deprecated) |
| `Sunset` | `2026-12-01T00:00:00Z` | ISO 8601 date the version will be removed (only when deprecated) |
| `X-Deprecation-Message` | `v1 is deprecated…` | Human-readable migration note (only when deprecated) |

Clients should:
- Check for a `Deprecation` header on every response.
- Log or alert when it appears so engineers are notified to schedule migration work.

---

## Adding a New Version

1. **Create the route aggregator**

   ```
   src/routes/v2/index.ts
   ```

   Copy the pattern from `src/routes/v1/index.ts` and add/remove routes as needed.

2. **Register the version in `src/config/api-versions.config.ts`**

   ```ts
   v2: {
     version: 'v2',
     active: true,   // ← flip to true when ready
   },
   ```

3. **Mount the router in `src/app.ts`**

   The router is already conditionally mounted:
   ```ts
   if (API_VERSIONS.v2?.active) {
     app.use('/api/v2', v2Router);
   }
   ```
   Setting `active: true` above is sufficient.

4. **Update Swagger** — point `swaggerOptions.definition.info.version` at the new version and ensure route JSDoc comments are present.

5. **Mark v1 as deprecated** — follow the [Deprecation and Sunset Process](#deprecation-and-sunset-process) above.

6. **Open a PR** — include a migration guide in the PR description explaining what changed and how consumers should update.

---

## Modifying v1 Routes — PR Requirements

Because v1 is under a stability guarantee, **any pull request that touches files inside `src/routes/v1/`** must include one of the following in the PR description:

### Non-breaking change (additive)

```
<!-- migration: non-breaking — added optional field `timezone` to GET /api/v1/users/:id response -->
```

### Breaking change (requires v2)

Breaking changes must **not** be made to v1. Introduce them in `src/routes/v2/` instead:

```
<!-- migration: breaking — removed `legacyId` field; available in v2 without the field -->
```

A GitHub Actions workflow (`.github/workflows/v1-route-check.yml`) will fail the CI check if a PR modifies `src/routes/v1/` without a `<!-- migration: … -->` tag in the PR body.

---

## Version Registry

| Version | Status | Released | Deprecated | Sunset |
|---------|--------|----------|------------|--------|
| v1 | **Active** | 2025-01-01 | — | — |
| v2 | Scaffold | — | — | — |

_This table is updated as versions move through their lifecycle._
