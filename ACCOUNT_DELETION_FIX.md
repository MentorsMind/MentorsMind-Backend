# Account Deletion Service Fix

## Issue Summary
The account deletion service had critical issues with error handling and batch processing:

1. **Email failure swallowed**: If the deletion confirmation email failed to send, the error was only logged but the user received no notification despite their data being erased.
2. **No error isolation**: In `processDueDeletions`, if one user's erasure threw an error, the entire batch stopped and subsequent users were never processed.
3. **No retry mechanism**: Failed deletions had no way to be retried or tracked.
4. **Poor admin visibility**: Admins couldn't see which deletions failed or why.

## Changes Made

### 1. Database Migration (`database/migrations/054_add_deletion_error_tracking.sql`)
Added columns to track deletion failures:
- `deletion_failed_at`: Timestamp of last failed deletion attempt
- `deletion_error`: Error message from last failed attempt
- `deletion_retry_count`: Number of retry attempts
- Index on `deletion_failed_at` for efficient querying

### 2. Service Layer (`src/services/accountDeletion.service.ts`)

#### Enhanced `processDueDeletions()`
- Wrapped each `eraseUser` call in try-catch for error isolation
- One user's failure no longer stops the batch
- Returns detailed results: `{ total, successful, failed, results }`
- Logs each failure with context
- Automatically marks failed deletions in database

#### New `markDeletionFailed()` method
- Records failure timestamp, error message, and increments retry count
- Limits error message to 1000 characters

#### New `retryFailedDeletions()` method
- Retries deletions that previously failed
- Respects max retry limit (default: 3)
- Returns detailed results like `processDueDeletions()`

#### Enhanced `listDeletionRequests()` method
- Now includes failed deletion information
- Orders results to prioritize failed deletions
- Optional parameter to include completed deletions

#### Improved `eraseUser()` documentation
- Added comprehensive JSDoc explaining email behavior
- Clarified that original email is used for notification (not anonymized email)
- Documented that email failures don't roll back the deletion

### 3. Job Layer (`src/jobs/accountDeletion.job.ts`)
- Updated to handle new return type from `processDueDeletions()`
- Added warning logging when deletions fail
- New `retryFailed()` method for manual retry jobs

### 4. Scheduler (`src/workers/scheduler.ts`)
- Updated logging to show successful vs failed counts

### 5. Admin API (`src/controllers/admin.controller.ts` & `src/routes/admin.routes.ts`)

#### New endpoint: `POST /admin/deletion-requests/retry`
- Allows admins to manually retry failed deletions
- Accepts optional `maxRetries` parameter
- Returns detailed results of retry attempt

#### Enhanced `GET /admin/deletion-requests`
- Now returns failed deletion information via updated `listDeletionRequests()`

## Migration Instructions

1. Run the migration:
   ```bash
   npm run migrate
   ```

2. Deploy the updated service code

3. Monitor logs for any failed deletions

4. Use the new admin endpoint to retry failed deletions:
   ```bash
   POST /admin/deletion-requests/retry
   {
     "maxRetries": 3
   }
   ```

## Behavior Changes

### Before
- One deletion failure stopped all subsequent deletions in batch
- Failed deletions were lost - no tracking or retry
- Email failures were silently logged
- Admins had no visibility into failures

### After
- Each deletion is isolated - failures don't affect others
- Failed deletions are tracked with error details
- Automatic retry mechanism available
- Admins can view and manually retry failed deletions
- Detailed logging for troubleshooting

## Testing Recommendations

1. Test batch processing with intentional failures
2. Verify email failures don't prevent deletion
3. Test retry mechanism with various error scenarios
4. Verify admin endpoints return correct failure information
5. Test max retry limit enforcement
