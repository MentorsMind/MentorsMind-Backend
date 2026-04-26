# Export Service Rate Limiting Implementation

## Issue #292: ExportService Has No Rate Limiting

**Severity:** Medium Bug  
**Status:** ✅ Fixed

## Problem
The `ExportService.requestExport` method created a new export job and enqueued it every time it was called with no checks for existing pending/processing jobs. A user could spam the endpoint to create hundreds of export jobs, exhausting the BullMQ queue and disk space.

## Solution Implemented

### 1. **Job Deduplication** (Conflict Prevention)
**File:** `src/services/export.service.ts`

Added check before creating a new export job:
- Queries for existing pending or processing jobs for the user
- Returns `409 Conflict` error if an export is already in progress
- Prevents queue exhaustion from duplicate requests

```typescript
const existing = await ExportJobModel.findPendingByUserId(userId);
if (existing) {
  throw createError(
    "An export is already in progress. Please wait for it to complete or check the status.",
    409,
  );
}
```

### 2. **24-Hour Cooldown Period**
**File:** `src/services/export.service.ts`

Implemented cooldown mechanism after successful export:
- Checks for last completed export job
- Blocks new requests within 24 hours
- Returns `429 Too Many Requests` with remaining time info
- Provides user-friendly error message with hours remaining

```typescript
const lastCompleted = await ExportJobModel.findLastCompletedByUserId(userId);
if (lastCompleted && lastCompleted.created_at) {
  const hoursSinceLastExport =
    (Date.now() - new Date(lastCompleted.created_at).getTime()) /
    (1000 * 60 * 60);
  if (hoursSinceLastExport < 24) {
    const hoursRemaining = Math.ceil(24 - hoursSinceLastExport);
    throw createError(
      `You can request a new export in ${hoursRemaining} hour(s). Please wait before requesting another export.`,
      429,
    );
  }
}
```

### 3. **Database Query Methods**
**File:** `src/models/export-job.model.ts`

Added two new model methods:

#### `findPendingByUserId(userId)`
- Finds pending or processing export jobs for a user
- Returns the most recent active job
- Used for conflict detection

#### `findLastCompletedByUserId(userId)`
- Finds the most recently completed export job
- Used for cooldown period validation
- Returns null if no completed exports exist

### 4. **Rate Limiter Configuration**
**File:** `src/config/rate-limits.config.ts`

Added dedicated export rate limit profile:
```typescript
export: {
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Export rate limit exceeded. Maximum 3 export requests per hour.',
}
```

### 5. **Rate Limiter Middleware**
**File:** `src/middleware/rate-limit.middleware.ts`

Created dedicated `exportLimiter`:
```typescript
export const exportLimiter = createLimiter({
  profile: rateLimitsConfig.export,
  keyStrategy: 'user', // Per-user rate limiting
});
```

### 6. **Route Protection**
**File:** `src/routes/export.routes.ts`

Applied `exportLimiter` to the export request endpoint:
```typescript
router.post('/users/me/export', exportLimiter, asyncHandler(ExportController.requestExport));
```

## Multi-Layer Protection

The implementation provides **three layers of protection**:

### Layer 1: HTTP Rate Limiter
- **Limit:** 3 requests per hour per user
- **Enforcement:** Middleware level
- **Purpose:** Prevents rapid spam/abuse
- **Response:** 429 with retry information

### Layer 2: Job Deduplication
- **Check:** Active jobs (pending/processing)
- **Enforcement:** Service level
- **Purpose:** Prevents duplicate concurrent exports
- **Response:** 409 Conflict

### Layer 3: 24-Hour Cooldown
- **Limit:** 1 export per 24 hours after completion
- **Enforcement:** Service level
- **Purpose:** Prevents resource exhaustion
- **Response:** 429 with remaining time

## Error Responses

### 409 Conflict - Export In Progress
```json
{
  "status": "error",
  "message": "An export is already in progress. Please wait for it to complete or check the status.",
  "statusCode": 409
}
```

### 429 Too Many Requests - Cooldown Active
```json
{
  "status": "error",
  "message": "You can request a new export in 4 hour(s). Please wait before requesting another export.",
  "statusCode": 429
}
```

### 429 Too Many Requests - Rate Limit
```json
{
  "status": "error",
  "message": "Export rate limit exceeded. Maximum 3 export requests per hour.",
  "retryAfter": "2026-04-26T15:30:00.000Z",
  "timestamp": "2026-04-26T14:30:00.000Z"
}
```

## Testing

Comprehensive unit tests added in `src/services/__tests__/export.service.test.ts`:

1. ✅ Test 409 error for pending export job
2. ✅ Test 409 error for processing export job
3. ✅ Test 429 error within 24-hour cooldown
4. ✅ Test successful export after cooldown period
5. ✅ Test first-time export (no previous exports)

## Security Benefits

1. **Prevents Queue Exhaustion:** Users cannot flood BullMQ with hundreds of jobs
2. **Prevents Disk Space Abuse:** Limits temp file creation during export processing
3. **Prevents S3 Storage Abuse:** Limits uploaded export files
4. **Prevents Database Load:** Limits export job record creation
5. **Fair Resource Usage:** Ensures all users get fair access to export functionality
6. **Audit Trail:** All export requests are logged with appropriate metadata

## Backward Compatibility

✅ No breaking changes  
✅ Existing completed exports remain accessible  
✅ Export status checking unaffected  
✅ Export download functionality unaffected  
✅ Earnings export (CSV) unaffected (separate endpoint)

## Performance Impact

- **Minimal:** Two additional database queries per export request
- **Optimized:** Uses indexed queries on `user_id` and `status` columns
- **Efficient:** LIMIT 1 on all queries ensures fast response
- **Cached:** Rate limiter uses Redis for sub-millisecond checks

## Monitoring Recommendations

Monitor the following metrics:
1. **409 responses:** Indicates users trying to create duplicate exports
2. **429 responses:** Indicates rate limit violations
3. **Export job queue depth:** Should remain low with new limits
4. **Failed exports:** Track for legitimate vs. abusive patterns

## Future Enhancements

Potential improvements for future iterations:
1. Configurable cooldown period via environment variables
2. Different limits for premium vs. free users
3. Export job priority queue for faster processing
4. Email notification when export is ready for download
5. Automatic cleanup of expired export files from S3
