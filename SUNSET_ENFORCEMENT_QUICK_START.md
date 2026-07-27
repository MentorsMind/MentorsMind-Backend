# API Sunset Enforcement - Quick Start Guide

## 5-Minute Setup

### 1. Add Middleware to Express App

```typescript
import { apiSunsetEnforcementMiddleware } from './middleware/api-sunset-enforcement.middleware';
import sunsetRoutes from './routes/admin/sunset-status.routes';

const app = express();

// Add enforcement before other middlewares
app.use('/api', apiSunsetEnforcementMiddleware);

// Add admin monitoring dashboard
app.use('/admin/api/sunsets', sunsetRoutes);
```

### 2. Add Validation Script to package.json

```json
{
  "scripts": {
    "validate:api-sunsets": "ts-node scripts/validate-api-sunsets.ts"
  }
}
```

### 3. Set a Sunset Date

Edit `src/config/api-versions.config.ts`:

```typescript
export const API_VERSIONS: Record<string, VersionConfig> = {
  v1: {
    version: 'v1',
    active: true,
    deprecatedAt: '2026-06-01T00:00:00Z',
    sunsetAt: '2026-09-01T00:00:00Z',
    deprecationMessage: 'v1 is deprecated. Migrate to v2.',
  },
  v2: {
    version: 'v2',
    active: true,
  },
};
```

### 4. Test Enforcement

```bash
# Validate configuration (runs in CI/CD)
npm run validate:api-sunsets

# Check sunset status
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:5000/admin/api/sunsets/status

# Test with sunset in past (modify config temporarily)
API_VERSIONS.v1.sunsetAt = new Date().toISOString();

# Request will now return 410 Gone
curl http://localhost:5000/api/v1/users
# → HTTP/1.1 410 Gone
```

## Understanding the Enforcement

### Grace Periods

| Days Until Sunset | Status | Response | Action |
|---|---|---|---|
| 30+ | Deprecated | 200 + headers | Inform clients |
| 7-30 | Warning | 200 + urgent headers | Final call to migrate |
| 0-7 | Critical | 400 Bad Request | Clients must upgrade NOW |
| -N (past) | Sunset | 410 Gone | Service broken |

### Example Timeline

```
June 1: Deprecate v1
  → Set deprecatedAt: '2026-06-01'
  → Set sunsetAt: '2026-09-01' (90 days later)
  → Announce to customers

June 1 - August 1: Soft phase
  → Requests succeed (200 OK)
  → Include Deprecation headers
  → Clients migrate

August 1 - August 25: Warning phase
  → Requests still succeed
  → Headers more urgent
  → Migrate NOW

August 25 - September 1: Critical phase
  → Requests return 400 Bad Request
  → Retry-After: 0 (don't retry)
  → Clients must migrate immediately

September 1+: Hard block
  → All requests return 410 Gone
  → Service broken for non-migrated clients
```

## Admin Commands

```bash
# Check all versions
curl /admin/api/sunsets/status

# Check versions in critical periods
curl /admin/api/sunsets/critical

# Check timeline for planning
curl /admin/api/sunsets/timeline

# Check specific version
curl /admin/api/sunsets/check-version/v1

# Acknowledge critical period (audit trail)
curl -X POST /admin/api/sunsets/acknowledge-critical/v1 \
  -d '{"reason":"Reviewed migration status","plannedAction":"Activate fallback API"}'
```

## Troubleshooting

### Q: Why am I getting 410 Gone?

**A:** The API version has sunset. Check the response for the exact sunset date. You must migrate to a newer version.

### Q: How do I test the enforcement?

**A:** Temporarily set `sunsetAt` to the past:
```typescript
API_VERSIONS.v1.sunsetAt = new Date(Date.now() - 1000).toISOString();
```

### Q: What if we need to extend the sunset date?

**A:** Edit the date in `api-versions.config.ts`. The middleware will recalculate based on the new date. Notify customers of the change.

### Q: Can I bypass the enforcement for testing?

**A:** For testing only, set `active: false`:
```typescript
API_VERSIONS.v1.active = false;
```
Requests will return 404 instead of sunset enforcement.

### Q: How do I add a new version?

**A:** Add to `API_VERSIONS`:
```typescript
v3: {
  version: 'v3',
  active: true,
  // No deprecation/sunset dates initially
}
```

Then migration routes will handle requests to v3.

## Deployment Checklist

- [ ] Updated API_VERSIONS with sunset dates
- [ ] Notified customers with migration timeline
- [ ] Set `deprecatedAt` to current or recent date
- [ ] Set `sunsetAt` to at least 90 days from deprecation
- [ ] Ran `npm run validate:api-sunsets` - all checks pass
- [ ] GitHub Actions validates on every push
- [ ] Deployment proceeds (validation passed)
- [ ] Admin monitoring dashboard accessible at /admin/api/sunsets/status

## Key Files

| File | Purpose |
|------|---------|
| `src/middleware/api-sunset-enforcement.middleware.ts` | Enforcement logic |
| `scripts/validate-api-sunsets.ts` | Pre-deployment validation |
| `src/routes/admin/sunset-status.routes.ts` | Admin dashboard |
| `docs/API_SUNSET_ENFORCEMENT.md` | Complete documentation |
| `src/__tests__/api-sunset-enforcement.test.ts` | Test suite |

## For API Consumers

When you get a `410 Gone` response:

1. Check the response `details.sunsetDate`
2. Call your provider's API to get supported versions
3. Update your client to use a newer version
4. Redeploy your application
5. Retry the request

There is no extension available - sunsets are firm dates.

## References

- Complete Guide: [API_SUNSET_ENFORCEMENT.md](./docs/API_SUNSET_ENFORCEMENT.md)
- Implementation Details: [SUNSET_ENFORCEMENT_IMPLEMENTATION.md](./SUNSET_ENFORCEMENT_IMPLEMENTATION.md)
- RFC 8594: [Sunset HTTP Header](https://tools.ietf.org/html/rfc8594)
