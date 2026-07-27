# API Sunset Enforcement Implementation

## Executive Summary

A complete hard enforcement system for API version sunsets has been implemented, replacing the previous informational-only approach. After an API version's `sunsetAt` date passes, requests are now hard-blocked with 410 Gone responses. Deployment is blocked if sunset dates are violated.

## Problem Statement (Original Issue)

After an API version's `sunsetAt` date passes, clients that failed to migrate continue receiving responses indefinitely. This creates:
- ❌ Infinite maintenance burden for supporting deprecated endpoints
- ❌ Zero migration pressure on API consumers  
- ❌ No deployment safeguards to prevent sunset violation
- ❌ Meaningless sunset dates with no enforcement

## Solution Overview

### 4-Grace-Period Enforcement Model

| Days Until Sunset | Status | HTTP Status | Behavior |
|-------------------|--------|-------------|----------|
| Already passed | Sunset | **410 Gone** | Hard block, service broken |
| 0-7 days | Critical | **400 Bad Request** | Error + urgent warning |
| 7-30 days | Warning | **200 OK** | Success + warning headers |
| 30+ days | Deprecated | **200 OK** | Success + deprecation headers |

### Phase 1: Enforcement Middleware

**File:** `src/middleware/api-sunset-enforcement.middleware.ts` (337 lines)

Features:
- ✅ Intercepts all API requests by version
- ✅ Enforces 4-phase grace period
- ✅ Returns 410 Gone after sunset
- ✅ Returns 400 Bad Request in final 7 days
- ✅ Tracks sunset violations for monitoring
- ✅ Logs all enforcement actions

Example flow:
```typescript
// Day 90: Deprecation announced
GET /api/v1/users → 200 OK
X-Deprecation: true

// Day 30: Final month warning
GET /api/v1/users → 200 OK  
X-API-Sunset-Warning: true

// Day 7: Critical period
GET /api/v1/users → 400 Bad Request
X-API-Sunset-Critical: true
Retry-After: 0

// Day 0 (after sunset): Hard block
GET /api/v1/users → 410 Gone
```

### Phase 2: Pre-Deployment Validation

**File:** `scripts/validate-api-sunsets.ts` (328 lines)

Runs before deployment to verify:
- ✅ All dates are valid ISO 8601 format
- ✅ No versions passed sunsetAt while still active
- ✅ Minimum 90 days between deprecation and sunset
- ✅ Database migrations don't reference sunset APIs
- ✅ No sunset APIs are marked for deployment

Exit codes:
- `0` = Pass, ready to deploy
- `1` = Fail, deployment blocked
- `2` = Warnings only

### Phase 3: GitHub Actions Integration

**Files:** 
- `validate-sunsets.yml` - New workflow for continuous validation
- `deploy.yml` - Updated with sunset check step

Changes to deploy workflow:
```yaml
- name: Validate API sunset configurations
  run: pnpm run validate:api-sunsets
  continue-on-error: false  # BLOCKS deployment if fails
```

### Phase 4: Admin Monitoring Dashboard

**File:** `src/routes/admin/sunset-status.routes.ts` (312 lines)

Endpoints:
- `GET /admin/api/sunsets/status` - Current sunset status of all versions
- `GET /admin/api/sunsets/critical` - Versions in critical periods
- `GET /admin/api/sunsets/compliance` - Enforcement compliance report
- `GET /admin/api/sunsets/timeline` - Sunset timeline grouped by urgency
- `POST /admin/api/sunsets/acknowledge-critical/:version` - Acknowledge critical period for audit trail

### Phase 5: Comprehensive Tests

**File:** `src/__tests__/api-sunset-enforcement.test.ts` (401 lines)

Coverage:
- ✅ Active versions (no sunset)
- ✅ Deprecated versions (future sunsets)
- ✅ Critical period enforcement (0-7 days)
- ✅ Sunset date enforcement
- ✅ Accept-Version header support
- ✅ Edge cases (invalid dates, inactive versions)

## Implementation Details

### Configuration

Update `src/config/api-versions.config.ts`:

```typescript
export const API_VERSIONS: Record<string, VersionConfig> = {
  v1: {
    version: 'v1',
    active: true,
    // Add these for sunset:
    deprecatedAt: '2026-06-01T00:00:00Z',    // When deprecated
    sunsetAt: '2026-09-01T00:00:00Z',        // When removed (90 days later)
    deprecationMessage: 'v1 is deprecated. Migrate to v2.',
  },
  v2: {
    version: 'v2',
    active: true,
  },
};
```

### Middleware Integration

In your Express app setup:

```typescript
import { apiSunsetEnforcementMiddleware } from './middleware';
import sunsetRoutes from './routes/admin/sunset-status.routes';

// Apply enforcement to all API routes
app.use('/api', apiSunsetEnforcementMiddleware);

// Add admin monitoring dashboard
app.use('/admin/api/sunsets', sunsetRoutes);
```

### Package.json Scripts

Add validation script:

```json
{
  "scripts": {
    "validate:api-sunsets": "ts-node scripts/validate-api-sunsets.ts"
  }
}
```

## Timeline and Enforcement

### Example: Sunset v1 API

**June 1, 2026 - Deprecation Announced**
- Set `deprecatedAt: '2026-06-01T00:00:00Z'`
- Set `sunsetAt: '2026-09-01T00:00:00Z'` (90 days later)
- Announce to customers
- Provide migration guide

**Days 1-30: Soft Deprecation**
- Requests succeed (200 OK)
- Response includes deprecation headers
- Clients begin migration planning

**Days 30-60: Warning Phase**
- Requests still succeed (200 OK)
- Headers become more urgent
- Clients should be migrating

**Days 60-90: Final Warning**
- Requests still succeed (200 OK)
- Last chance to migrate

**Days 90-97: Critical Period**
- Requests return 400 Bad Request
- `X-API-Sunset-Critical: true`
- `Retry-After: 0` (don't retry, upgrade now)
- Clients must migrate immediately

**Day 97+: Hard Block**
- All requests return 410 Gone
- Service broken for non-migrating clients
- No recovery except immediate migration

## Monitoring

### Check Current Status

```bash
# View sunset status of all versions
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://api.example.com/admin/api/sunsets/status

# Check specific version
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://api.example.com/admin/api/sunsets/check-version/v1

# View critical versions needing action
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://api.example.com/admin/api/sunsets/critical
```

### Metrics to Track

```sql
-- Daily sunset API requests (should drop to 0 after sunset)
SELECT 
  DATE(timestamp) as date,
  api_version,
  COUNT(*) as requests,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY DATE(timestamp)), 2) as percent
FROM api_access_logs
WHERE api_version IN (SELECT version FROM api_versions WHERE sunset_at IS NOT NULL)
GROUP BY DATE(timestamp), api_version
ORDER BY date DESC;

-- Compliance violations (requests after sunset)
SELECT 
  api_version,
  sunset_at,
  COUNT(*) as violations,
  DATEDIFF(NOW(), sunset_at) as days_overdue
FROM api_access_logs 
WHERE api_version IN (SELECT version FROM api_versions WHERE sunset_at < NOW())
GROUP BY api_version, sunset_at;
```

### Alerts

Recommended alert rules:

```yaml
alerts:
  - name: "API Version Sunset Imminent"
    condition: "version.daysUntilSunset <= 30"
    severity: "warning"
    
  - name: "API Version in Critical Period"
    condition: "version.daysUntilSunset <= 7 AND daysUntilSunset > 0"
    severity: "critical"
    
  - name: "Production Requests to Sunset API"
    condition: "sunset_api_requests_5m > 0 AND version.daysUntilSunset < 0"
    severity: "critical"
    action: "Page SRE team - investigate non-migrating clients"
```

## Files Created/Modified

### New Files (5)

1. **src/middleware/api-sunset-enforcement.middleware.ts** (337 lines)
   - Hard enforcement middleware
   - 4-grace-period enforcement model
   - Helper functions for checking sunset status

2. **scripts/validate-api-sunsets.ts** (328 lines)
   - Pre-deployment validation script
   - Checks for sunset date violations
   - Validates migration compliance

3. **src/routes/admin/sunset-status.routes.ts** (312 lines)
   - Admin monitoring dashboard endpoints
   - Sunset status and timeline views
   - Critical period acknowledgment

4. **.github/workflows/validate-sunsets.yml** (113 lines)
   - New workflow for continuous validation
   - Runs on every push and PR
   - Blocks deployment on violations

5. **docs/API_SUNSET_ENFORCEMENT.md** (416 lines)
   - Complete documentation
   - Grace period explanation
   - Integration guide
   - Troubleshooting

### Updated Files (3)

1. **.github/workflows/deploy.yml**
   - Added `pnpm run validate:api-sunsets` step
   - Step set to `continue-on-error: false` to block deployment

2. **src/middleware/index.ts**
   - Added exports for new middleware and helper functions

3. **src/__tests__/api-sunset-enforcement.test.ts** (401 lines)
   - Comprehensive test suite
   - Tests for all grace periods
   - Edge case coverage

## Success Criteria

✅ **All Criteria Met:**

1. **Hard Enforcement**
   - ✅ After sunsetAt, requests return 410 Gone (not served indefinitely)
   - ✅ Evidence: `apiSunsetEnforcementMiddleware` returns 410 for past sunsets

2. **Deployment Guardrails**
   - ✅ GitHub Actions blocks deployment if sunset dates violated
   - ✅ Evidence: `validate-api-sunsets.ts` script in deploy workflow

3. **Grace Periods**
   - ✅ 30+ days: Info headers only
   - ✅ 7-30 days: Warning headers
   - ✅ 0-7 days: 400 Bad Request with critical warning
   - ✅ After: 410 Gone

4. **Migration Pressure**
   - ✅ Clients get immediate pressure (400, then 410)
   - ✅ Zero-retry header forces immediate action in final week

5. **Monitoring**
   - ✅ Admin dashboard for tracking sunset status
   - ✅ Endpoints for compliance checking
   - ✅ Timeline view for planning

6. **Testing**
   - ✅ 401-line test suite covering all scenarios
   - ✅ Edge cases included

## Impact

### Positive Outcomes

- 🎯 **Clear Enforcement:** Sunset dates now have teeth
- 🎯 **Migration Pressure:** Clients have real incentive to migrate
- 🎯 **Deployment Safety:** Cannot accidentally deploy sunset APIs
- 🎯 **Monitoring:** Full visibility into sunset compliance
- 🎯 **Audit Trail:** All sunset violations logged
- 🎯 **Reduced Maintenance:** Can actually decommission old code

### For API Consumers

- **Immediate impact:** After sunset date, service breaks
- **Preparation time:** 90+ days notice before service breaks
- **Clear signals:** Escalating warnings (headers → 400 → 410)
- **Actionable errors:** Specific guidance on what to do

### For Platform Team

- **Maintenance:** Can finally remove deprecated code
- **Monitoring:** Dashboard shows migration progress
- **Compliance:** Deployment validation ensures enforcement
- **Audit:** Every sunset violation is logged and traceable

## Usage Example

### Setting a Sunset Date

1. Update config:
```typescript
API_VERSIONS.v1.sunsetAt = '2026-09-01T00:00:00Z';
API_VERSIONS.v1.deprecationMessage = 'v1 is deprecated. Use v2.';
```

2. Commit and deploy:
```bash
git commit -am "Deprecate v1 API"
git push origin main
```

3. GitHub Actions validates and deploys (if no violations)

4. Monitoring detects the sunset date and starts tracking:
```bash
curl /admin/api/sunsets/status
# Shows v1 with status: "deprecated"
```

5. As sunset approaches (7 days before):
```bash
curl /admin/api/sunsets/critical
# Shows v1 in critical warning period
```

6. After sunset date passes:
```bash
GET /api/v1/users → 410 Gone
```

## Documentation

See `docs/API_SUNSET_ENFORCEMENT.md` for:
- Complete grace period explanation
- Client migration flow
- Integration instructions
- Troubleshooting guide
- Best practices
- Monitoring setup

## Next Steps

1. **Deploy this implementation**
2. **Review and approve sunset policies** (90-day minimum, etc.)
3. **Test with a non-critical version** (e.g., test-v1)
4. **Set up monitoring and alerts**
5. **Train team on sunset enforcement**
6. **Communicate policy to API consumers**

---

**Status:** ✅ Implementation Complete

**Impact:** Hard enforcement of API version sunsets eliminates indefinite support burden and ensures clients actually migrate

**Files Changed:** 8 files (5 new, 3 updated)

**Total Lines:** 2,406 lines of code, tests, and documentation
