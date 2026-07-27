# API Sunset Enforcement System

## Overview

This document describes the API sunset enforcement system that ensures deprecated API versions are actually removed after their sunset dates pass. This solves the problem where sunset dates were merely informational with no hard enforcement.

## Problem Statement

Previously, the system had deprecation headers (RFC 8594) but no enforcement:
- After a sunsetAt date passes, the old API version continues serving requests indefinitely
- Clients have zero migration pressure
- Supporting deprecated endpoints creates permanent maintenance burden
- Database migrations continue supporting sunset APIs
- GitHub Actions has no check to prevent deploying sunset APIs

## Solution Architecture

### 1. Hard Enforcement Middleware (`api-sunset-enforcement.middleware.ts`)

The enforcement middleware intercepts requests to API versions and enforces sunset dates through grace periods:

#### Grace Period 1: Sunset Date Passed
**Status:** 410 Gone
**Behavior:** Hard block - no requests served
**Message:** "API version {version} has been permanently removed"

```
GET /api/v1/users  →  410 Gone
```

#### Grace Period 2: 0-7 Days Until Sunset
**Status:** 400 Bad Request
**Behavior:** Returns error but indicates urgency
**Message:** "API version {version} is being removed in {N} day(s)"
**Headers:** 
- `X-API-Sunset-Critical: true`
- `Sunset: {date}`
- `Retry-After: 0` (don't retry, upgrade immediately)

```
GET /api/v1/users  →  400 Bad Request
X-API-Sunset-Critical: true
Sunset: Wed, 01 Sep 2026 00:00:00 GMT
```

#### Grace Period 3: 7-30 Days Until Sunset
**Status:** 200 OK (request succeeds)
**Behavior:** Request succeeds but includes deprecation headers
**Headers:**
- `X-API-Sunset-Warning: true`
- `X-Deprecation: true`
- `Deprecation: {deprecatedAt}`
- `Sunset: {sunsetAt}`
- `X-Deprecation-Message: {message}`

#### Grace Period 4: 30+ Days Until Sunset
**Status:** 200 OK (request succeeds)
**Behavior:** Request succeeds with standard deprecation headers
**Headers:**
- `X-Deprecation: true`
- `Deprecation: {deprecatedAt}`
- `Sunset: {sunsetAt}`

### 2. Deployment Validation (`validate-api-sunsets.ts`)

Pre-deployment validation script that runs in CI/CD pipeline:

**Checks performed:**
1. ✅ All dates are valid ISO 8601 format
2. ✅ No versions have passed sunsetAt while still marked `active: true`
3. ✅ deprecatedAt is before sunsetAt
4. ✅ Minimum 90 days between deprecation and sunset
5. ✅ Database migrations don't reference sunset APIs
6. ✅ No sunset APIs deployed in production

**Exit codes:**
- `0` = Success, ready to deploy
- `1` = Critical errors found, deployment blocked
- `2` = Warnings only, deployment allowed with review

### 3. GitHub Actions Integration

#### New Workflow: `validate-sunsets.yml`
Runs on every push and PR to catch sunset violations early.

#### Updated Workflow: `deploy.yml`
Added validation step that:
- Runs before deployment
- Blocks deployment if sunset dates are violated
- Prevents serving permanently removed APIs

### 4. Admin Monitoring Dashboard

REST API endpoints for real-time sunset monitoring:

**GET /admin/api/sunsets/status**
```json
{
  "versions": [
    {
      "version": "v1",
      "active": true,
      "deprecatedAt": "2026-06-01T00:00:00Z",
      "sunsetAt": "2026-09-01T00:00:00Z",
      "daysUntilSunset": 25,
      "status": "deprecated"
    }
  ],
  "summary": {
    "total": 2,
    "active": 1,
    "deprecated": 1,
    "critical": 0,
    "sunset": 0
  }
}
```

**GET /admin/api/sunsets/critical**
Returns only versions in critical periods for alerting.

**GET /admin/api/sunsets/timeline**
Returns sunset timeline grouped by urgency for planning.

**POST /admin/api/sunsets/acknowledge-critical/:version**
Acknowledge critical sunset period for audit trail.

## Configuration

API versions are configured in `src/config/api-versions.config.ts`:

```typescript
export const API_VERSIONS: Record<string, VersionConfig> = {
  v1: {
    version: 'v1',
    active: true,
    // Optional deprecation info
    deprecatedAt: '2026-06-01T00:00:00Z',    // When deprecated
    sunsetAt: '2026-09-01T00:00:00Z',        // When it will be removed
    deprecationMessage: 'v1 is deprecated. Migrate to v2.', // Client message
  },
  v2: {
    version: 'v2',
    active: true,
  },
};
```

### Setting a Sunset Date

When marking an API version for sunset:

1. **Set `deprecatedAt`** to current date (or a recent date)
   ```typescript
   deprecatedAt: '2026-06-01T00:00:00Z'
   ```

2. **Set `sunsetAt`** to at least 90 days later
   ```typescript
   sunsetAt: '2026-09-01T00:00:00Z'  // 90 days later
   ```

3. **Notify API consumers** - Send deprecation announcement
   - Include migration guide URL
   - Publish timeline
   - Provide support contact

4. **Monitor migration progress** - Use admin endpoints to track:
   - Are clients migrating?
   - How many old API requests?
   - How many versions behind are users?

5. **When sunsetAt approaches (30 days before)**:
   - Review migration metrics
   - Prepare for harder enforcement
   - Add monitoring alerts
   - Ensure logs track sunset access

6. **When sunsetAt is reached (0 days)**:
   - Change `active: false` in API_VERSIONS
   - Monitor for compliance
   - Block any remaining requests with 410 Gone

7. **After sunset date passes**:
   - Consider removing from config entirely
   - Archive documentation
   - Remove associated code/features

## Client Migration Flow

### Day 1-30: Soft Deprecation Phase

Client receives 200 OK with deprecation headers:

```http
GET /api/v1/users/123
X-Deprecation: true
Deprecation: 2026-06-01T00:00:00Z
Sunset: 2026-09-01T00:00:00Z
X-Deprecation-Message: v1 is deprecated. Migrate to v2.
```

**Client action:** Start migration planning

### Day 60-30 Before Sunset: Warning Phase

Client still receives 200 OK but with urgent warnings:

```http
GET /api/v1/users/123
X-API-Sunset-Warning: true
X-Deprecation-Message: v1 will be removed in 30 days
```

**Client action:** Begin active migration

### Day 7-0 Before Sunset: Critical Phase

Client receives **400 Bad Request** with 0 retry:

```http
GET /api/v1/users/123
HTTP/1.1 400 Bad Request
X-API-Sunset-Critical: true
Retry-After: 0

{
  "status": "error",
  "code": "VALIDATION_INVALID_INPUT",
  "message": "API version v1 is being removed in 3 day(s)",
  "details": {
    "action": "URGENT: Upgrade to a newer API version immediately"
  }
}
```

**Client action:** Complete migration immediately or service breaks

### After Sunset Date: Hard Block

All requests get **410 Gone**:

```http
GET /api/v1/users/123
HTTP/1.1 410 Gone

{
  "status": "error",
  "code": "SERVER_NOT_FOUND",
  "message": "API version v1 has been permanently removed",
  "details": {
    "sunsetDate": "2026-09-01T00:00:00Z",
    "daysOverdue": 5,
    "action": "Upgrade to v2 immediately"
  }
}
```

**Client impact:** Service breaks until migration complete

## Integration in Express

### 1. Add middleware to Express app

```typescript
import { apiSunsetEnforcementMiddleware } from './middleware';

app.use('/api', apiSunsetEnforcementMiddleware);
```

### 2. Add admin routes

```typescript
import sunsetRoutes from './routes/admin/sunset-status.routes';

app.use('/admin/api/sunsets', sunsetRoutes);
```

### 3. Add validation script to package.json

```json
{
  "scripts": {
    "validate:api-sunsets": "ts-node scripts/validate-api-sunsets.ts"
  }
}
```

## GitHub Actions Integration

### Pre-deployment Validation

The `.github/workflows/deploy.yml` now includes:

```yaml
- name: Validate API sunset configurations
  run: pnpm run validate:api-sunsets
  continue-on-error: false  # BLOCKS deployment if fails
```

This prevents deploying code with sunset API violations.

## Monitoring and Alerting

### Metrics to Track

1. **Sunset API request volume**
   - How many requests to sunset APIs?
   - Trend over time?
   - Which clients?

2. **Migration progress**
   - What % of clients have migrated?
   - How long until they all do?

3. **Compliance violations**
   - How many 410 responses?
   - How many days past sunset?

### Recommended Alerts

```yaml
alerts:
  - name: "API Version Sunset Approaching"
    condition: "version.sunsetAt < now + 30 days"
    severity: "warning"
    action: "Notify engineering team to review migration progress"

  - name: "API Version Sunset Date Passed"
    condition: "version.sunsetAt < now"
    severity: "critical"
    action: "Page on-call engineer. Version must be deactivated."

  - name: "Production Requests to Sunset API"
    condition: "sunset_api_requests_5m > threshold"
    severity: "warning"
    action: "Investigate clients not migrating"
```

## Troubleshooting

### Q: Why am I getting 410 Gone for my requests?

**A:** Your API version has been sunset. Check the response `details.sunsetDate` to see when it was removed. You must migrate to a newer version immediately.

### Q: How do I know which version to migrate to?

**A:** Check the Sunset response headers or call `GET /admin/api/sunsets/status` for supported versions.

### Q: Can I get a 30-day extension on sunset?

**A:** No. Sunset dates are firm to ensure platform maintainability. Plan your migration accordingly during the deprecation period.

### Q: How do I test sunset behavior?

**A:** Temporarily modify `api-versions.config.ts` to test:
```typescript
sunsetAt: new Date().toISOString()  // Sunset today
```

Then request the version and confirm you get 410.

## Best Practices

### For Platform Teams

1. **Minimum deprecation windows**
   - 90 days minimum between deprecation and sunset
   - 30+ day warning period before hard enforcement
   - Consider holidays/freezes

2. **Communication**
   - Announce deprecations on API blog/changelog
   - Email API users with timeline
   - Provide migration guides BEFORE deprecation
   - Support during migration window

3. **Monitoring**
   - Track which clients use deprecated versions
   - Reach out proactively to non-migrating clients
   - Use admin dashboard to track progress

4. **Gradual enforcement**
   - Day 1-60: Headers only (informational)
   - Day 60-30: Warning headers (urgent)
   - Day 30-0: 400 responses (critical)
   - After: 410 responses (hard block)

### For API Consumers

1. **Monitor deprecation headers**
   - Check `X-Deprecation` and `Sunset` headers
   - Subscribe to API changelog
   - Set up alerts for `Deprecation: true`

2. **Plan early**
   - Start migration as soon as you see `Deprecation` header
   - Don't wait until critical period
   - Test against new version in staging

3. **Complete before sunset**
   - Don't rely on grace periods
   - Expect hard blocks on sunset date
   - Plan for emergency rollback if migration fails

## Related Documentation

- [API Versioning](./API_VERSIONING.md)
- [Deprecation Policy](./DEPRECATION_POLICY.md)
- [Migration Guides](./API_MIGRATION_GUIDES.md)

## References

- [RFC 8594: The Sunset HTTP Header Field](https://tools.ietf.org/html/rfc8594)
- [RFC 7234: HTTP Caching - Warning Header](https://tools.ietf.org/html/rfc7234)
- [HTTP Status Code 410 Gone](https://httpwg.org/specs/rfc7231.html#status.410)
