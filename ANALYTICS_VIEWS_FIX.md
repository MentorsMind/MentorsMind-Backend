# Analytics Materialized Views Fix

## Issue Summary

All analytics queries (getRevenue, getUserGrowth, getSessions, getTopMentors, getAssetDistribution) query materialized views created by migration `015_analytics_views.sql`. If the migration hasn't run or views haven't been refreshed, every analytics endpoint throws a PostgreSQL "relation does not exist" error, propagating as an unhandled 500.

## Changes Implemented

### 1. AnalyticsService Enhancements (`src/services/analytics.service.ts`)

#### Added View Availability Tracking
- Introduced `viewsAvailable` flag and `lastViewCheck` timestamp
- Caches view existence checks for 60 seconds to reduce database queries

#### New Methods
- **`checkViewsExist()`**: Verifies all 5 required materialized views exist
  - Queries `information_schema.tables` for materialized views
  - Returns boolean and logs missing views
  - Caches result for performance

- **`ensureViewsAvailable()`**: Pre-flight check before executing queries
  - Throws `AnalyticsViewsUnavailableError` if views are missing
  - Provides clear error message with remediation steps

- **`initialize()`**: Startup check called when application starts
  - Verifies views on startup
  - Logs warning if views are missing

#### New Error Class
- **`AnalyticsViewsUnavailableError`**: Custom error for missing views
  - Extends Error with descriptive name
  - Used to differentiate from other database errors

#### Updated Query Methods
All analytics methods now:
1. Call `ensureViewsAvailable()` before querying
2. Wrap queries in try/catch blocks
3. Handle `AnalyticsViewsUnavailableError` specifically
4. Log warnings for unavailable views
5. Re-throw other errors for global error handler

### 2. AnalyticsController Updates (`src/controllers/analytics.controller.ts`)

#### Error Handling
- All controller methods now use `asyncHandler` wrapper
- Catch `AnalyticsViewsUnavailableError` and return 503 status
- Return clear error message: "Analytics views not yet available..."
- Other errors propagate to global error handler

#### Affected Endpoints
- `GET /api/v1/admin/analytics/revenue`
- `GET /api/v1/admin/analytics/users`
- `GET /api/v1/admin/analytics/sessions`
- `GET /api/v1/admin/analytics/top-mentors`
- `GET /api/v1/admin/analytics/asset-distribution`

### 3. Health Check Integration (`src/services/health.service.ts`)

#### New Health Component
- Added `analyticsViews` to health check components
- Status: `healthy` (all views exist) or `degraded` (views missing)
- Provides details about missing views and remediation steps

#### New Method
- **`checkAnalyticsViews()`**: Checks all 5 materialized views
  - Returns healthy if all views exist
  - Returns degraded with missing view names if any are missing
  - Includes helpful message about running migration

#### Health Endpoint Response
```json
{
  "components": {
    "analyticsViews": {
      "status": "healthy|degraded",
      "responseTimeMs": 15,
      "details": {
        "totalViews": 5,
        "missingViews": [],
        "message": "Run migration 015_analytics_views.sql to create views"
      }
    }
  }
}
```

### 4. Application Initialization (`src/app.ts`)

#### Added Analytics Service Initialization
- Import `AnalyticsService` at top of file
- Call `AnalyticsService.initialize()` after `HealthService.initialize()`
- Logs initialization status and any errors

### 5. CI/CD Pipeline Updates (`.github/workflows/ci.yml`)

#### New Steps
1. **Run database migrations**: Executes migration script before tests
2. **Refresh analytics views**: Calls `refresh_analytics_views()` function
3. Both steps use `continue-on-error: true` to not block CI if not configured

### 6. Documentation (`DEPLOYMENT_NOTES.md`)

#### New Analytics System Section
Comprehensive documentation including:

- **Required Actions**: Step-by-step migration and refresh instructions
- **View Descriptions**: Details about each of the 5 materialized views
- **Refresh Strategy**: Manual, API, and cron job options
- **Health Check Integration**: How to monitor view status
- **Error Handling**: Expected behavior when views are unavailable
- **Troubleshooting**: Common problems and solutions
- **CI/CD Integration**: How to integrate into deployment pipelines

## Materialized Views

The following views must exist for analytics to work:

1. **mv_daily_revenue** - Daily revenue aggregation by currency
2. **mv_daily_users** - Daily user registration statistics by role
3. **mv_session_stats** - Session completion and duration statistics
4. **mv_top_mentors** - Top performing mentors by revenue and sessions
5. **mv_asset_distribution** - Payment asset distribution (XLM, USDC, PYUSD)

## Error Behavior

### Before Fix
- **Status**: 500 Internal Server Error
- **Message**: Generic PostgreSQL error about missing relation
- **User Experience**: Unclear what went wrong

### After Fix
- **Status**: 503 Service Unavailable
- **Message**: "Analytics views not yet available. Please run migration 015_analytics_views.sql and refresh the views."
- **User Experience**: Clear indication that analytics is temporarily unavailable with remediation steps

## Testing

### Verify Views Exist
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'MATERIALIZED VIEW'
  AND table_name LIKE 'mv_%';
```

### Check Health Endpoint
```bash
curl https://your-api.com/health/detailed
```

### Test Analytics Endpoint
```bash
curl -H "Authorization: Bearer <token>" \
     https://your-api.com/api/v1/admin/analytics/revenue
```

### Expected Responses

**Views Missing (503)**:
```json
{
  "status": "error",
  "message": "Analytics views not yet available. Please run migration 015_analytics_views.sql and refresh the views."
}
```

**Views Available (200)**:
```json
{
  "status": "success",
  "data": [
    {
      "date": "2026-04-29",
      "currency": "XLM",
      "transaction_count": 42,
      "total_amount": "1250.50",
      ...
    }
  ]
}
```

## Deployment Checklist

- [ ] Run migration `015_analytics_views.sql`
- [ ] Execute `SELECT refresh_analytics_views();`
- [ ] Verify all 5 views exist
- [ ] Check health endpoint shows `analyticsViews: healthy`
- [ ] Test analytics endpoints return 200
- [ ] Set up cron job for periodic view refresh (recommended: every 15-30 minutes)
- [ ] Update CI/CD pipeline to refresh views after migrations
- [ ] Monitor application logs for analytics initialization messages

## Rollback

If issues occur, the changes are backward compatible:
- Analytics endpoints will return 503 instead of 500
- Health check will show degraded status
- Application will continue to function normally
- No database schema changes required to rollback code

## Performance Impact

- **Startup**: +1 database query to check views (cached for 60 seconds)
- **Runtime**: Minimal - view check is cached and only runs every 60 seconds
- **Health Checks**: +1 query per health check (already cached at 5 seconds)
- **Analytics Queries**: No change - same queries as before, just with error handling

## Security Considerations

- No new security vulnerabilities introduced
- Error messages don't expose sensitive information
- Admin-only endpoints remain protected
- View refresh function requires database permissions (already required)

## Future Improvements

1. Add metrics for view refresh success/failure
2. Implement automatic view refresh on application startup
3. Add alerting when views are stale (last refresh > threshold)
4. Consider incremental refresh strategies for large datasets
5. Add view refresh to deployment automation

---

**Fixed By**: Kiro AI Assistant  
**Date**: 2026-04-29  
**Issue**: Analytics materialized views causing 500 errors  
**Status**: ✅ Resolved
