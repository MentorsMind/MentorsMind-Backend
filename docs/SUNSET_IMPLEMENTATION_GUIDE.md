# Implementing API Sunset Enforcement

## Overview

This guide walks through implementing hard enforcement of API sunset dates so that deprecated versions are actually blocked from serving requests after their `sunsetAt` date.

## Problem: Why Enforcement Matters

**Without enforcement:**
- v1 API marked to sunset 2026-12-01
- After 2026-12-01, clients can still access it (indefinitely!)
- Maintenance burden grows
- Clients have zero migration pressure

**With enforcement:**
- v1 API marked to sunset 2026-12-01
- After 2026-12-01, all requests get 410 Gone
- Clients must migrate or lose access
- Hard deadline creates urgency

## Architecture

### 1. Configuration Layer (api-versions.config.ts)

Define which versions are deprecated and when they sunset:

```typescript
export const API_VERSIONS = {
  v1: {
    version: 'v1',
    active: true,
    deprecatedAt: '2026-06-01T00:00:00Z',    // When deprecation began
    sunsetAt: '2026-12-01T00:00:00Z',        // Hard enforcement date
    migrationGuide: 'https://docs/migration/v1-to-v2',
  },
};
```

### 2. Enforcement Layer (sunset-enforcement.middleware.ts)

Three middleware functions handle enforcement:

```
sunsetEnforcementMiddleware
  ├─ 30+ days before: Add warning headers
  ├─ 7-30 days before: Strict warnings
  └─ 0+ days after: 410 Gone

strictSunsetEnforcementMiddleware
  ├─ 7-0 days before: 410 Gone
  └─ 0+ days after: 410 Gone

getSunsetVersions()
  └─ Returns all sunset versions with metadata
```

### 3. Validation Layer (scripts/validate-migrations.ts)

Before deployment, check:
- ✅ All API table changes have deprecation plans
- ✅ sunsetDate is 6+ months in future
- ✅ Deprecation references exist

### 4. Integration Layer (.github/workflows/deploy.yml)

CI checks before deployment:
```bash
npm run validate:migrations     # Check migration plans
npm run check:sunsets          # Check no past-sunset versions
```

## Step-by-Step Implementation

### Step 1: Add Middleware to Express App

In `src/server.ts` or `src/app.ts`:

```typescript
import { 
  sunsetEnforcementMiddleware,
  strictSunsetEnforcementMiddleware 
} from './middleware/sunset-enforcement.middleware';

// Apply to all versioned API routes
app.use('/api/v1', sunsetEnforcementMiddleware);
app.use('/api/v2', sunsetEnforcementMiddleware);

// Optional: strict enforcement for final week
app.use('/api/v1', strictSunsetEnforcementMiddleware);
app.use('/api/v2', strictSunsetEnforcementMiddleware);
```

### Step 2: Configure Deprecated Versions

In `src/config/api-versions.config.ts`:

```typescript
export const API_VERSIONS = {
  v1: {
    version: 'v1',
    active: true,                                    // Still active for now
    deprecatedAt: '2026-06-01T00:00:00Z',          // When clients got warning
    sunsetAt: '2026-12-01T00:00:00Z',              // Hard cutoff date
    migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2',
    deprecationMessage: 'v1 is deprecated. Please migrate to v2.',
  },
  v2: {
    version: 'v2',
    active: true,
  },
};
```

### Step 3: Document Migration Paths

In `database/migrations/.deprecation-metadata.json`:

```json
{
  "migrations": {
    "100_add_profile_picture_to_users.sql": {
      "description": "Add profile_picture field to users table",
      "deprecatedVersions": ["v1"],
      "deprecationPlan": {
        "v1": {
          "oldEndpoint": "GET /api/v1/users/:id",
          "newEndpoint": "GET /api/v2/users/:id",
          "reason": "User schema changed - profile_picture field added",
          "sunsetDate": "2026-12-01T00:00:00Z",
          "migrationGuide": "https://docs.mentorminds.com/migration/v1-to-v2-users"
        }
      }
    }
  }
}
```

### Step 4: Create Migration Guide

Create `docs/migration-guides/v1-to-v2-users.md`:

```markdown
# Migrating from v1 to v2: Users Endpoint

## What Changed

The user profile now includes a `profile_picture` field.

## v1 Response
```json
{
  "id": "user-123",
  "name": "John Doe",
  "email": "john@example.com"
}
```

## v2 Response
```json
{
  "id": "user-123",
  "name": "John Doe",
  "email": "john@example.com",
  "profile_picture": "https://..."
}
```

## Migration Steps

1. Change endpoint from `/api/v1/users/:id` to `/api/v2/users/:id`
2. Handle new `profile_picture` field in your code
3. Test thoroughly
4. Deploy before 2026-12-01

## Questions?

See [API Migration Guide](../API_VERSIONING.md)
```

### Step 5: Update CI Workflow

In `.github/workflows/deploy.yml`:

```yaml
- name: Validate migrations
  run: pnpm run migrate:validate

- name: Validate migration deprecation plans
  run: pnpm run validate:migrations

- name: Check API sunset enforcement readiness
  run: pnpm run check:sunsets
```

## How It Works at Runtime

### Before sunsetAt (Deprecation Phase)

```
GET /api/v1/users/123
↓
sunsetEnforcementMiddleware checks if version sunset
↓
Version v1: sunsetAt=2026-12-01, now=2026-06-15
↓
Days until sunset: 168 (> 30)
↓
Add warning headers
Response: 200 OK + Deprecation + Sunset headers
```

**Response:**
```
HTTP/1.1 200 OK
Deprecation: true
Sunset: Tue, 01 Dec 2026 00:00:00 GMT
Warning: 299 - "API version v1 will be removed in 168 days"

{...user data...}
```

### 30 Days Before sunsetAt

```
GET /api/v1/users/123
↓
sunsetEnforcementMiddleware checks days
↓
Days until sunset: 30 (== 30)
↓
Strict warning headers
Response: 200 OK + Enhanced warnings
```

**Response:**
```
HTTP/1.1 200 OK
Deprecation: true
Sunset: Tue, 01 Dec 2026 00:00:00 GMT
Warning: 299 - "API version v1 will be removed in 30 days"

{...user data...}
```

### 7 Days Before sunsetAt

```
GET /api/v1/users/123
↓
strictSunsetEnforcementMiddleware checks days
↓
Days until sunset: 7 (<= 7)
↓
Block with 410 Gone
```

**Response:**
```
HTTP/1.1 410 Gone

{
  "status": "error",
  "code": "SERVICE_UNAVAILABLE",
  "message": "API version v1 will be removed on 2026-12-01 - MIGRATE IMMEDIATELY",
  "category": "SERVICE_UNAVAILABLE",
  "details": {
    "context": {
      "version": "v1",
      "sunsetDate": "2026-12-01T00:00:00Z",
      "daysUntilRemoval": 7,
      "replacementVersion": "v2",
      "migrationGuide": "https://docs.mentorminds.com/migration/v1-to-v2"
    },
    "retryable": false
  }
}
```

### After sunsetAt

```
GET /api/v1/users/123
↓
sunsetEnforcementMiddleware checks if sunset
↓
Version v1: sunsetAt=2026-12-01, now=2026-12-02
↓
isVersionSunset() returns true
↓
Block with 410 Gone
```

**Response:**
```
HTTP/1.1 410 Gone

{
  "status": "error",
  "code": "SERVICE_UNAVAILABLE",
  "message": "API version v1 is no longer supported",
  "category": "SERVICE_UNAVAILABLE",
  "details": {
    "context": {
      "version": "v1",
      "sunsetDate": "2026-12-01T00:00:00Z",
      "replacementVersion": "v2",
      "migrationGuide": "https://docs.mentorminds.com/migration/v1-to-v2"
    },
    "retryable": false
  }
}
```

## Testing

### Unit Test: Sunset Enforcement

```typescript
import { isVersionSunset, getDaysUntilSunset } from '../src/middleware/sunset-enforcement.middleware';

describe('Sunset Enforcement', () => {
  it('should detect sunset version', () => {
    // API_VERSIONS.v1.sunsetAt = 2026-12-01
    // today = 2026-12-02
    expect(isVersionSunset('v1')).toBe(true);
  });

  it('should calculate days until sunset', () => {
    // API_VERSIONS.v1.sunsetAt = 2026-12-01
    // today = 2026-11-01
    expect(getDaysUntilSunset('v1')).toBe(30);
  });
});
```

### Integration Test: 410 Response

```typescript
describe('GET /api/v1/users (sunset)', () => {
  it('should return 410 Gone after sunset', async () => {
    // Mock sunsetAt to be in the past
    jest.spyOn(api-versions, 'API_VERSIONS', 'get').mockReturnValue({
      v1: {
        version: 'v1',
        active: true,
        sunsetAt: '2020-01-01T00:00:00Z', // In past
      }
    });

    const response = await request(app).get('/api/v1/users');
    
    expect(response.status).toBe(410);
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.details.context.replacementVersion).toBe('v2');
  });
});
```

## Deployment Checklist

When deprecating an API version:

- [ ] Set `deprecatedAt` to today in api-versions.config.ts
- [ ] Set `sunsetAt` to 6+ months from today
- [ ] Create migration guide document
- [ ] Update `.deprecation-metadata.json` with all affected endpoints
- [ ] Add `migrationGuide` and `deprecationMessage` to API version config
- [ ] Update API documentation with migration instructions
- [ ] Notify customers 6 months in advance
- [ ] Run `npm run validate:migrations` to check configuration
- [ ] Run `npm run check:sunsets` to verify enforcement
- [ ] Deploy
- [ ] Monitor logs for deprecated endpoint usage
- [ ] After sunsetAt: verify 410 responses working

## Monitoring

### Check Current Status

```bash
npm run check:sunsets
```

### View Sunset Metrics

```bash
# Count v1 requests in last 24h
grep "deprecated_endpoint_accessed" logs/* | grep v1 | wc -l

# Find which endpoints are getting requests
grep "deprecated_endpoint_accessed" logs/* | jq '.endpoint' | sort | uniq -c
```

### Admin API (if available)

```
GET /api/v1/admin/sunsets
→ Get all sunset versions and remaining days
```

## Common Issues

### Issue: CI Validation Fails

**Problem:** `npm run validate:migrations` fails

**Solution:**
1. Check that all API-visible table changes have deprecation plans
2. Verify sunsetDate is 6+ months in future
3. Ensure all migrations reference valid API versions

### Issue: 410 Returned Too Early

**Problem:** Version getting 410 before sunsetAt

**Solution:**
- Check `sunsetAt` date in api-versions.config.ts
- Verify system time is correct
- Check if `strictSunsetEnforcementMiddleware` is active (returns 410 at 7 days)

### Issue: Clients Not Seeing Deprecation Headers

**Problem:** 30+ days before sunset but no headers

**Solution:**
- Verify `sunsetEnforcementMiddleware` is applied to route
- Check `deprecatedAt` and `sunsetAt` are set correctly
- Confirm middleware order - it must run before handlers

## Performance Impact

- **Before sunsetAt (30+ days):** No impact, only adds headers to response
- **7 days before:** Very minimal, just checks date
- **After sunsetAt:** Fast rejection (no DB lookup), immediate 410

## FAQ

### Q: Can we keep v1 running after sunsetAt?

**A**: You can remove the middleware, but it defeats the purpose of enforcement. Once sunset, clients should migrate.

### Q: What if customers complain after sunsetAt?

**A**: They had 6 months notice. Point them to the migration guide and migration deadline.

### Q: Can we shorten the 6-month notice period?

**A**: Not recommended. Enterprise customers need time. Set sunsetAt 6+ months in future.

### Q: How do we handle new versions?

**A**: No `deprecatedAt` or `sunsetAt` means the version is active and will keep running indefinitely (until you deprecate it).

### Q: What about backward compatibility?

**A**: These mechanisms force forward compatibility. After sunset, you must migrate.

## Related Files

- **Configuration:** `src/config/api-versions.config.ts`
- **Enforcement:** `src/middleware/sunset-enforcement.middleware.ts`
- **Validation:** `scripts/validate-migrations.ts`
- **CI Check:** `scripts/check-sunset-readiness.ts`
- **Metadata:** `database/migrations/.deprecation-metadata.json`
- **Workflow:** `.github/workflows/deploy.yml`

## Next Steps

1. Add middleware to Express app
2. Configure v1 deprecation (if planning to deprecate)
3. Update CI workflow
4. Test with manual sunsetAt date in past
5. Deploy to staging
6. Verify 410 responses working
7. Document migration guides for clients
8. Deploy to production

---

**Status:** ✅ Ready for implementation

All enforcement mechanisms are in place and documented. Add the middleware and configure your first deprecation to test.
