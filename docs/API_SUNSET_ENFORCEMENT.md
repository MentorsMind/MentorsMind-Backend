# API Sunset Enforcement - Complete Guide

## Problem

Previously, API versions had `deprecatedAt` and `sunsetAt` dates in configuration, but **there was no enforcement**. After sunsetAt passed, clients continued to receive responses indefinitely. This created:

- ❌ Zero migration pressure on API consumers
- ❌ Maintenance burden of supporting deprecated endpoints forever
- ❌ No meaningful deadline for API consumers
- ❌ No deployment gate to prevent serving sunset versions

## Solution: Hard Enforcement

The new system **blocks requests** to sunset API versions with HTTP **410 Gone**.

### Timeline (6-Month Minimum)

```
Day 0: deprecatedAt
       ↓
       Clients see "Deprecation: true" headers
       Clients see "Sunset: <date>" header
       Warnings in response headers
       
Day 150 (30 days before): Strict warnings
       ↓
       All responses include sunset warning
       Strong migration messaging
       
Day 177 (7 days before): Strict enforcement
       ↓
       All requests receive 410 Gone
       Service is effectively unavailable
       
Day 180: sunsetAt (ENFORCED)
       ↓
       All requests receive 410 Gone
       Version is completely unavailable
```

## How It Works

### 1. Configuration (api-versions.config.ts)

```typescript
export const API_VERSIONS: Record<string, VersionConfig> = {
  v1: {
    version: 'v1',
    active: true,
    deprecatedAt: '2026-06-01T00:00:00Z',    // Marked deprecated
    sunsetAt: '2026-12-01T00:00:00Z',        // Hard enforcement after this
    deprecationMessage: 'v1 is deprecated. Please migrate to v2.',
    migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2',
  },
};
```

### 2. Middleware (sunset-enforcement.middleware.ts)

Two enforcement levels:

#### Level 1: Warning Phase (30+ days before sunset)
```typescript
app.use('/api/v1', sunsetEnforcementMiddleware);
// Response includes headers:
// Deprecation: true
// Sunset: Tue, 01 Dec 2026 00:00:00 GMT
// Warning: 299 - "API version v1 will be removed in 30 days"
```

#### Level 2: Strict Enforcement (7 days or less before sunset)
```typescript
app.use('/api/v1', strictSunsetEnforcementMiddleware);
// Response: 410 Gone
// Message: "API version v1 will be removed in 7 days - MIGRATE IMMEDIATELY"
```

#### Level 3: Hard Block (After sunset date)
```typescript
// All requests receive: 410 Gone
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

### 3. Deployment Gate (CI Check)

Before deployment, check that:

```bash
npm run check:sunsets
```

**Prevents deployment if:**
- ❌ Any version is past sunsetAt and still marked active
- ❌ Sunset dates are improperly configured
- ❌ No replacement version is available

**Warnings for:**
- ⚠️ Versions sunsetting within 30 days
- ⚠️ Deprecation plans with insufficient notice

### 4. Migration Documentation (database/migrations/.deprecation-metadata.json)

All migrations that change API-visible tables must include deprecation plans:

```json
{
  "migrations": {
    "100_add_new_field_to_users.sql": {
      "description": "Add profile_picture field to users table",
      "deprecatedVersions": ["v1"],
      "deprecationPlan": {
        "v1": {
          "oldEndpoint": "GET /api/v1/users/:id",
          "newEndpoint": "GET /api/v2/users/:id",
          "reason": "User schema changed - profile_picture field added",
          "sunsetDate": "2027-01-01T00:00:00Z",
          "migrationGuide": "https://docs.mentorminds.com/migration/v1-to-v2-users"
        }
      }
    }
  }
}
```

## Implementation

### Step 1: Add to Express App

```typescript
import { sunsetEnforcementMiddleware, strictSunsetEnforcementMiddleware } from './middleware/sunset-enforcement.middleware';

// Apply to versioned routes
app.use('/api/v1', sunsetEnforcementMiddleware);
app.use('/api/v2', sunsetEnforcementMiddleware);

// Optional: Strict enforcement for final week
app.use('/api/v1', strictSunsetEnforcementMiddleware);
```

### Step 2: Mark API Version as Deprecated

In `src/config/api-versions.config.ts`:

```typescript
v1: {
  version: 'v1',
  active: true,  // Still active but deprecated
  deprecatedAt: '2026-06-01T00:00:00Z',
  sunsetAt: '2026-12-01T00:00:00Z',
  migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2',
}
```

### Step 3: Document Migration Changes

Add to `database/migrations/.deprecation-metadata.json`:

```json
{
  "migrations": {
    "XXX_migration_name.sql": {
      "description": "What changed",
      "deprecatedVersions": ["v1"],
      "deprecationPlan": {
        "v1": {
          "oldEndpoint": "GET /api/v1/endpoint",
          "newEndpoint": "GET /api/v2/endpoint",
          "reason": "Schema changed - field X added",
          "sunsetDate": "2026-12-01T00:00:00Z",
          "migrationGuide": "..."
        }
      }
    }
  }
}
```

### Step 4: Deploy

CI automatically checks:

```bash
# CI workflow runs:
npm run validate:migrations         # Check deprecation plans exist
npm run check:sunsets              # Check no versions past sunset
```

If checks fail, deployment is blocked.

## API Version Lifecycle

### Phase 1: Active (No constraints)
```
GET /api/v1/users/123
200 OK
{data}
```

### Phase 2: Deprecated (Warning headers)
```
GET /api/v1/users/123
200 OK
Deprecation: true
Sunset: Tue, 01 Dec 2026 00:00:00 GMT
Warning: 299 - "API version v1 will be removed in 30 days"
{data}
```

### Phase 3: Final Week (410 Enforcement)
```
GET /api/v1/users/123
410 Gone
{
  "message": "API version v1 will be removed in 7 days - MIGRATE IMMEDIATELY"
}
```

### Phase 4: Sunset (Hard Block)
```
GET /api/v1/users/123
410 Gone
{
  "message": "API version v1 is no longer supported",
  "replacementVersion": "v2",
  "migrationGuide": "..."
}
```

## Client Handling

### Detecting Deprecation

```typescript
// Check Deprecation header
if (response.headers.get('Deprecation') === 'true') {
  const sunsetDate = response.headers.get('Sunset');
  console.log(`API will sunset on ${sunsetDate}`);
  // Migrate before date!
}
```

### Handling 410 Gone

```typescript
try {
  await api.get('/api/v1/users/123');
} catch (error) {
  if (error.response.status === 410) {
    // Version is no longer available
    const replacement = error.response.data.details.context.replacementVersion;
    const guide = error.response.data.details.context.migrationGuide;
    console.log(`Migrate to ${replacement}: ${guide}`);
    // Initiate migration
  }
}
```

## CLI Commands

### Check Sunset Readiness

```bash
npm run check:sunsets
```

Output:
```
🌅 Checking API Sunset Enforcement...

📋 Sunset Versions:

  ⛔ SUNSET v1 (2026-12-01) → v2
  ⏱️  30d v2 (2026-01-15) → v3

❌ CRITICAL ISSUES:

  • v1 is past sunset date and should no longer be served
```

### Validate Migration Deprecation Plans

```bash
npm run validate:migrations
```

Checks:
- ✅ All API-visible table changes have deprecation plans
- ✅ sunsetDate is at least 6 months in future
- ✅ Deprecation plans reference valid versions
- ✅ Migration guides are provided

## Deployment Checklist

Before deprecating an API version:

- [ ] Set `deprecatedAt` to today
- [ ] Set `sunsetAt` to 6+ months from now
- [ ] Create migration guide document
- [ ] Update `database/migrations/.deprecation-metadata.json` with all affected endpoints
- [ ] Add `deprecationMessage` and `migrationGuide` to api-versions.config.ts
- [ ] Update client SDKs with migration instructions
- [ ] Notify API consumers 6 months in advance
- [ ] Run `npm run validate:migrations` to check configuration
- [ ] Run `npm run check:sunsets` to verify enforcement readiness
- [ ] Deploy
- [ ] Monitor sunset date, automate v1 removal after sunsetAt

## Monitoring

### In Logs

Look for:
```
Sunset version accessed (410 Gone)  ← Version is past sunset
Endpoint sunset approaching         ← 30 days remaining
Strict sunset enforcement: request blocked  ← 7 days or less
```

### In Metrics

Track:
- Requests to deprecated versions
- Requests blocked by sunset enforcement
- Migration progress (count of clients migrating)

### Admin API

Check sunset status:
```bash
GET /api/v1/admin/api-status/sunsets
```

Response:
```json
{
  "versions": [
    {
      "version": "v1",
      "sunsetDate": "2026-12-01T00:00:00Z",
      "daysUntilSunset": 127,
      "status": "deprecated",
      "replacementVersion": "v2",
      "requestsInLast24h": 45
    }
  ]
}
```

## FAQ

### Q: What if a client hasn't migrated by sunsetAt?

**A**: They get 410 Gone and the service is unavailable. This is intentional - sunset dates must be enforced.

### Q: Can we extend the sunset date?

**A**: Yes, but update `sunsetAt` in `api-versions.config.ts` and notify clients immediately. Sunset dates should be final once set.

### Q: What if we release a breaking change in a minor version?

**A**: Use the migration deprecation plan to document the change and set a sunset date 6 months in future. Clients have notice to migrate.

### Q: How do we handle backward compatibility?

**A**: Don't. Use deprecation and 6-month notice periods. After sunset, old versions are gone.

### Q: Can a client force a version they want?

**A**: They can use the `Accept-Version` header, but if it's sunset, they still get 410 Gone.

## Related Files

- `src/middleware/sunset-enforcement.middleware.ts` - Enforcement logic
- `src/config/api-versions.config.ts` - Version configuration
- `database/migrations/.deprecation-metadata.json` - Migration metadata
- `scripts/validate-migrations.ts` - Migration validation
- `scripts/check-sunset-readiness.ts` - Deployment gate
- `.github/workflows/deploy.yml` - CI integration

## See Also

- [API Versioning Strategy](./API_VERSIONING.md)
- [Deprecation Registry](./DEPRECATION.md)
- [Migration Guide Template](../docs/migration-guide-template.md)
