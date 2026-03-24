# API Versioning Strategy

## Overview

All API routes are prefixed with `/api/v1/`. Versioning is managed via URL path segments and optionally via the `Accept-Version` request header.

## URL Structure

```
https://api.mentorminds.com/api/v1/<resource>
```

## Specifying a Version

Two mechanisms are supported:

| Method | Example |
|---|---|
| URL path (preferred) | `GET /api/v1/users` |
| `Accept-Version` header | `Accept-Version: v1` |

URL path takes priority when both are present.

## Response Headers

Every response includes:

| Header | Description |
|---|---|
| `X-API-Version` | The resolved API version for this request |
| `X-Supported-Versions` | Comma-separated list of currently active versions |

Deprecated endpoints additionally include:

| Header | Description |
|---|---|
| `Deprecation` | ISO 8601 date when the version was deprecated |
| `Sunset` | ISO 8601 date when the version will be removed |
| `X-Deprecation-Message` | Human-readable migration guidance |

## Deprecation Policy

- A minimum of **3 months** notice is given before any version is removed.
- The `Deprecation` and `Sunset` headers are set on all responses from a deprecated version.
- Deprecation schedules are configured in `src/config/api-versions.config.ts`.

### Lifecycle

```
Active → Deprecated (Deprecation + Sunset headers added) → Removed (after Sunset date)
```

## Current Versions

| Version | Status | Deprecated | Sunset |
|---|---|---|---|
| v1 | Active | — | — |
| v2 | Scaffold (inactive) | — | — |

## Migration Guide for API Consumers

1. Watch for `Deprecation` and `Sunset` response headers in your HTTP client.
2. When a `Sunset` date is announced, plan your migration before that date.
3. New versions will be documented in this file and announced via changelog.
4. The `X-Supported-Versions` header always reflects the currently active versions.

### Example: Detecting Deprecation

```http
HTTP/1.1 200 OK
X-API-Version: v1
Deprecation: 2026-06-01T00:00:00Z
Sunset: 2026-09-01T00:00:00Z
X-Deprecation-Message: v1 is deprecated. Please migrate to v2.
```

## Adding a New Version (v2 example)

1. Implement routes in `src/routes/v2/`.
2. Set `active: true` for `v2` in `src/config/api-versions.config.ts`.
3. Mount v2 in `src/app.ts` under `/api/v2`.
4. Update this document.
