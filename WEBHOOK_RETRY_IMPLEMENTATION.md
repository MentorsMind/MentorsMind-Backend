# Webhook Retry Logic Implementation

**Issue:** #443  
**Description:** Implement exponential backoff retry for failed webhook deliveries.

## Overview

This implementation provides a robust webhook retry mechanism with exponential backoff, alerting, and manual retry capabilities to improve webhook delivery reliability.

## Acceptance Criteria

- ✅ Retry failed webhooks with exponential backoff
- ✅ Max 5 retries over ~11 hours
- ✅ Backoff: 1m, 5m, 30m, 2h, 8h
- ✅ Log all retry attempts
- ✅ Alert after 3 consecutive failures
- ✅ Allow manual retry from admin panel

## Architecture

### Retry Strategy

**Retry Delays:**
- Attempt 1: Immediate
- Attempt 2: +1 minute (60,000ms)
- Attempt 3: +5 minutes (300,000ms)
- Attempt 4: +30 minutes (1,800,000ms)
- Attempt 5: +2 hours (7,200,000ms)
- Attempt 6: +8 hours (28,800,000ms)

**Total:** 5 retries over approximately 11 hours

### Alerting Strategy

- **After 3 consecutive failures:** Send in-app notification to webhook owner
- **After 10 consecutive failures:** Auto-disable webhook and send notification

### Database Changes

**Migration:** `database/migrations/060_add_webhook_alert_tracking.sql`

Added columns to `webhooks` table:
- `alert_sent_at` - Timestamp when alert was sent for consecutive failures
- `last_alert_type` - Type of last alert sent (e.g., "3_consecutive_failures", "webhook_disabled")

## Implementation Details

### 1. Webhook Service Updates

**File:** `src/services/webhook.service.ts`

**Changes:**
- Updated `RETRY_DELAYS_MS` from `[60_000, 300_000, 1_800_000]` to `[60_000, 300_000, 1_800_000, 7_200_000, 28_800_000]`
- Added `ALERT_AFTER_FAILURES = 3` constant
- Added `sendFailureAlert()` method to send notifications after 3 consecutive failures
- Added `retryDelivery()` method for manual retry from admin panel
- Updated `executeDelivery()` to check for alerting after 3 failures
- Updated `disableWebhook()` to track alert type

### 2. Admin Controller Updates

**File:** `src/controllers/admin.controller.ts`

**Changes:**
- Added `WebhookService` import
- Added `retryWebhookDelivery()` endpoint method

### 3. Admin Routes Updates

**File:** `src/routes/admin.routes.ts`

**Changes:**
- Added route: `POST /admin/webhooks/:deliveryId/retry`
- Includes audit logging middleware
- Swagger documentation added

### 4. Unit Tests

**File:** `src/__tests__/services/webhook-retry.service.unit.test.ts`

**Test Coverage:**
- Retry delay verification
- Alert sending after 3 failures
- Manual retry scheduling
- Retry validation (already succeeded, already retrying, max exceeded)
- Delivery not found handling

## API Endpoints

### Manual Retry (Admin Only)

```http
POST /admin/webhooks/:deliveryId/retry
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Retry scheduled for attempt 3"
}
```

**Error Responses:**
- `400` - Cannot retry (already succeeded, max retries exceeded, etc.)
- `404` - Delivery not found

## Retry Flow

1. **Initial Delivery Attempt**
   - Webhook dispatched immediately
   - Status: `pending` → `success` or `failed`

2. **First Failure**
   - Status: `failed` → `retrying`
   - `attempt_number`: 1 → 2
   - `next_retry_at`: Now + 1 minute
   - Job enqueued with 1 minute delay

3. **Subsequent Failures**
   - Each failure increments `attempt_number`
   - Retry delay follows exponential backoff schedule
   - After 3 consecutive failures: Alert sent to owner

4. **Final Failure**
   - After 5 retries (attempt 6): Status: `failed` (permanently)
   - Webhook `failure_count` incremented
   - If `failure_count >= 10`: Webhook auto-disabled

5. **Manual Retry**
   - Admin can trigger manual retry via API
   - Validates delivery status and attempt count
   - Schedules retry with appropriate delay
   - Logs action in audit trail

## Logging

All retry attempts are logged with:
- Delivery ID
- Webhook ID
- Attempt number
- Delay duration
- Response status
- Error message

Example log:
```json
{
  "level": "warn",
  "message": "Webhook delivery failed, scheduled retry",
  "deliveryId": "delivery-123",
  "webhookId": "webhook-123",
  "attempt": 2,
  "nextAttempt": 3,
  "delayMs": 300000,
  "responseStatus": 500,
  "errorMessage": "Connection timeout"
}
```

## Alerting

### After 3 Consecutive Failures

**Notification:**
- Type: `system_alert`
- Title: "Webhook Delivery Failures"
- Message: "Your webhook has experienced 3 consecutive delivery failures. Please check your endpoint. After 10 failures, the webhook will be automatically disabled."
- Data: `{ webhookId, failureCount }`

### After 10 Consecutive Failures (Webhook Disabled)

**Notification:**
- Type: `system_alert`
- Title: "Webhook Disabled"
- Message: "Your webhook has been automatically disabled after 10 consecutive delivery failures. Please check your endpoint and re-enable it."
- Data: `{ webhookId }`

## Deployment Steps

1. **Run Database Migration**
   ```bash
   npm run migrate:up
   ```

2. **Restart Webhook Worker**
   - The updated retry logic will take effect immediately
   - Existing `retrying` deliveries will continue with old delays
   - New failures will use new retry schedule

3. **Verify Alerting**
   - Test webhook endpoint that returns errors
   - Verify notification after 3 failures
   - Verify webhook disable after 10 failures

## Monitoring

### Key Metrics to Monitor

- Webhook delivery success rate
- Average retry attempts before success
- Webhook disable rate (should be low)
- Alert notification delivery rate

### Queries

**Webhooks with high failure rates:**
```sql
SELECT 
  id, 
  url, 
  failure_count, 
  is_active, 
  disabled_at
FROM webhooks
WHERE failure_count > 0
ORDER BY failure_count DESC;
```

**Recent retry attempts:**
```sql
SELECT 
  wd.id,
  wd.webhook_id,
  wd.event_type,
  wd.attempt_number,
  wd.status,
  wd.next_retry_at,
  wd.error_message
FROM webhook_deliveries wd
WHERE wd.status = 'retrying'
ORDER BY wd.next_retry_at ASC;
```

**Alerts sent:**
```sql
SELECT 
  id,
  user_id,
  failure_count,
  alert_sent_at,
  last_alert_type
FROM webhooks
WHERE alert_sent_at IS NOT NULL
ORDER BY alert_sent_at DESC;
```

## Security Considerations

1. **Authentication:** Manual retry endpoint requires admin authentication
2. **Authorization:** Only admins can trigger manual retries
3. **Audit Logging:** All manual retries are logged in audit trail
4. **Rate Limiting:** Consider adding rate limiting to manual retry endpoint

## Future Enhancements

- Configurable retry delays per webhook
- Webhook-specific retry policies
- Retry with exponential backoff with jitter
- Dead letter queue for permanently failed webhooks
- Webhook health dashboard
- Automatic webhook re-enablement after successful delivery
