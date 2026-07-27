# Structured Error Handling Implementation

## Problem Statement

The original error handling system returned only human-readable strings, forcing API consumers to parse error messages to determine specific error conditions. This created critical usability issues:

### Real-World Problem Example

**Scenario**: Mobile app booking a session

```
POST /bookings
409 Conflict

Response Body (Old):
{
  "status": "error",
  "message": "Booking conflict" ← What kind of conflict?
}
```

The mobile app receives a 409 conflict but has **no way to distinguish**:
- **"Mentor is not available at the requested time"** → Need reschedule UI
- **"Booking is already paid"** → Need idempotency retry/confirmation

Without error codes, the only options were:
1. ❌ String matching: `if (error.message.includes("paid"))` (fragile)
2. ❌ Trial and error: Try different UIs until one works
3. ❌ Support escalation: User messages Kiro when confused

---

## Solution: Machine-Readable Error Codes

The new error handling system includes:

### 1. **Unique Error Codes** (Enum)
```typescript
ErrorCode.BOOKING_CONFLICT        // 409: Mentor time not available
ErrorCode.BOOKING_ALREADY_PAID    // 409: Duplicate payment attempt
ErrorCode.INSUFFICIENT_FUNDS      // 422: Balance too low
ErrorCode.TOKEN_EXPIRED           // 401: Refresh needed
ErrorCode.ACCOUNT_SUSPENDED       // 403: Temporary restriction
```

### 2. **Error Categories** (Classification)
```
4xx Client Errors
├─ VALIDATION (400)
├─ UNAUTHORIZED (401)
├─ FORBIDDEN (403)
├─ NOT_FOUND (404)
├─ CONFLICT (409)
├─ UNPROCESSABLE (422)
└─ RATE_LIMIT (429)

5xx Server Errors
├─ INTERNAL (500)
└─ SERVICE_UNAVAILABLE (503)
```

### 3. **Rich Context** (Debugging)
```json
{
  "code": "BOOKING_CONFLICT",
  "message": "Mentor is not available at 2:00 PM",
  "details": {
    "context": {
      "mentorId": "mentor-123",
      "requestedTime": "2026-08-01T14:00:00Z",
      "conflictingSession": {
        "start": "2026-08-01T14:00:00Z",
        "end": "2026-08-01T15:00:00Z"
      }
    }
  }
}
```

### 4. **Retryable Flag** (Client Logic)
```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "details": {
    "retryable": true,
    "retryAfter": 60
  }
}
```

---

## File Overview

### Core Implementation

| File | Purpose | Size |
|------|---------|------|
| `src/types/errors.types.ts` | Error enums, metadata, response types | 365 lines |
| `src/utils/app-error.ts` | AppError class with factory methods | 228 lines |
| `src/middleware/errorHandler.ts` | Global error handler (updated) | 180 lines |

### Documentation

| File | Purpose | Size |
|------|---------|------|
| `docs/ERROR_HANDLING.md` | **Complete reference guide** (START HERE) | 628 lines |
| `docs/ERROR_CODES_QUICK_REF.md` | Quick lookup for developers | 434 lines |
| `docs/ERROR_MIGRATION.md` | Step-by-step migration guide | 549 lines |
| `docs/ERROR_IMPLEMENTATION_EXAMPLE.md` | Before/after example | 569 lines |

---

## Quick Start

### For Backend Developers

#### 1. Throw Errors with Codes
```typescript
import { AppError } from "../utils/app-error";

// Before
throw createError("Mentor is not available", 409);

// After
throw AppError.bookingConflict(
  "Mentor is not available at 2:00 PM",
  { mentorId, conflictingSession: { start, end } }
);
```

#### 2. Error Handler Does the Rest
```typescript
// errorHandler automatically:
// ✓ Generates correct HTTP status from code
// ✓ Includes error code in response
// ✓ Logs with code + context
// ✓ Reports to Sentry with code
// ✓ Returns structured response
```

### For Frontend Developers

#### 1. Switch on Error Code
```typescript
try {
  await api.createBooking(data);
} catch (error) {
  switch (error.response.data.code) {
    case 'BOOKING_CONFLICT':
      showRescheduleUI(error.response.data.details.context);
      break;
    case 'BOOKING_ALREADY_PAID':
      showConfirmation('Already paid');
      break;
  }
}
```

#### 2. Use Context for Details
```typescript
const context = error.response.data.details.context;
const conflictingTime = context.conflictingSession.start;
const mentorId = context.mentorId;
// Use these to show rich UI
```

---

## Error Codes at a Glance

### 40X Errors (Client Error)

| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_INPUT` | 400 | Input validation failed |
| `INVALID_EMAIL` | 400 | Bad email format |
| `INVALID_CURRENCY` | 400 | Unknown currency |
| `UNAUTHORIZED` | 401 | Auth required |
| `INVALID_CREDENTIALS` | 401 | Wrong password |
| `TOKEN_EXPIRED` | 401 | Refresh token needed |
| `ACCESS_DENIED` | 403 | No permission |
| `ACCOUNT_SUSPENDED` | 403 | Temporarily disabled |
| `ACCOUNT_BANNED` | 403 | Permanently disabled |
| `USER_NOT_FOUND` | 404 | User doesn't exist |
| `BOOKING_NOT_FOUND` | 404 | Booking doesn't exist |
| `BOOKING_CONFLICT` | 409 | Time not available |
| `BOOKING_ALREADY_PAID` | 409 | Duplicate payment |
| `INSUFFICIENT_FUNDS` | 422 | Balance too low |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |

### 50X Errors (Server Error)

| Code | Status | Meaning |
|------|--------|---------|
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected error |
| `DATABASE_ERROR` | 500 | DB failure |
| `SERVICE_UNAVAILABLE` | 503 | Temporarily down |

---

## Key Differences: 409 Conflicts

This is where the new system shines—different 409s require different client handling:

### BOOKING_CONFLICT
```json
{
  "code": "BOOKING_CONFLICT",
  "message": "Mentor is not available at 2:00 PM",
  "details": {
    "context": {
      "conflictingSession": { "start": "...", "end": "..." }
    },
    "retryable": false
  }
}
```
**Client Action**: Show reschedule UI with available times

### BOOKING_ALREADY_PAID
```json
{
  "code": "BOOKING_ALREADY_PAID",
  "message": "Booking has already been paid",
  "details": {
    "context": {
      "paidAt": "2026-07-27T10:15:00Z",
      "paymentId": "payment-789"
    },
    "retryable": false
  }
}
```
**Client Action**: Show confirmation screen (idempotent operation)

### CONCURRENT_MODIFICATION
```json
{
  "code": "CONCURRENT_MODIFICATION",
  "message": "Resource was modified by another user",
  "details": {
    "retryable": true
  }
}
```
**Client Action**: Fetch latest data and retry

---

## Implementation Checklist

### Phase 1: Core Setup (✓ Complete)
- [x] Error type definitions (`errors.types.ts`)
- [x] AppError class (`app-error.ts`)
- [x] Updated error handler middleware
- [x] Documentation

### Phase 2: Gradual Migration
- [ ] Update core services (BookingsService, PaymentsService)
- [ ] Update auth services
- [ ] Update remaining services
- [ ] Add integration tests

### Phase 3: Monitoring
- [ ] Verify error codes in production logs
- [ ] Monitor Sentry with structured codes
- [ ] Gather client feedback

---

## Usage Examples

### Booking Service
```typescript
// Check mentor availability
const conflict = await BookingModel.checkConflict(mentorId, time, duration);
if (conflict) {
  throw AppError.bookingConflict(
    "Mentor is not available at the requested time",
    { mentorId, conflictingSession: conflict }
  );
}
```

### Payment Service
```typescript
// Check if already paid
if (booking.payment_status === 'paid') {
  throw AppError.bookingAlreadyPaid({
    bookingId,
    paidAt: booking.paid_at
  });
}
```

### Auth Service
```typescript
// Token expired
if (isTokenExpired(token)) {
  throw AppError.unauthorized("Token has expired", { reason: "expiry" });
}
```

---

## Response Structure

### Success Response
```json
{
  "status": "success",
  "data": { /* ... */ },
  "requestId": "req-12345",
  "timestamp": "2026-07-27T10:30:00Z"
}
```

### Error Response
```json
{
  "status": "error",
  "code": "BOOKING_CONFLICT",           ← Machine-readable
  "message": "Mentor is not available", ← User-facing
  "category": "CONFLICT",              ← Classification
  "requestId": "req-12345",            ← Debugging
  "timestamp": "2026-07-27T10:30:00Z",
  "details": {
    "context": {                       ← Error-specific data
      "mentorId": "mentor-123",
      "conflictingSession": { "start": "...", "end": "..." }
    },
    "retryable": false,                ← Client logic
    "retryAfter": 60                   ← Rate limit
  }
}
```

---

## Testing

### Unit Test Example
```typescript
it('should throw BOOKING_CONFLICT', async () => {
  try {
    await BookingsService.createBooking(conflictingData);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorCode.BOOKING_CONFLICT);
    expect(error.context.conflictingSession).toBeDefined();
  }
});
```

### Integration Test Example
```typescript
it('should return BOOKING_CONFLICT with details', async () => {
  const response = await request(app)
    .post('/bookings')
    .send(data)
    .expect(409);

  expect(response.body.code).toBe('BOOKING_CONFLICT');
  expect(response.body.details.context.conflictingSession).toBeDefined();
});
```

---

## Migration Path

### Step 1: Core Services
```
BookingsService → PaymentsService → AuthService
```

### Step 2: Supporting Services
```
EnrollmentService → ReviewsService → CalendarService
```

### Step 3: Utility Services
```
All remaining services
```

### Estimated Timeline
- Phase 1 (Core): 2-3 days
- Phase 2 (Supporting): 1 week
- Phase 3 (Utils): 1 week
- Testing & refinement: 1 week

---

## Backward Compatibility

✓ Old code still works during migration:
```typescript
// This still works (but less useful)
throw createError("Something failed", 500);

// Response will have generic INTERNAL_SERVER_ERROR code
```

✓ Old clients still get responses (with added `code` field):
```json
{
  "status": "error",
  "message": "Booking not found",  ← Old clients use this
  "code": "BOOKING_NOT_FOUND",     ← New clients use this
  "requestId": "..."
}
```

---

## Frequently Asked Questions

### Q: Do I need to migrate all services immediately?
**A**: No. Migrate gradually. New code uses structured errors, old code still works.

### Q: What about existing error handling?
**A**: The `createError()` function still works but returns a generic error code. Update it to use specific codes.

### Q: How do I test error codes?
**A**: Check `response.body.code` instead of parsing `response.body.message`.

### Q: What if I need a custom error code?
**A**: Add it to the `ErrorCode` enum and `ERROR_METADATA` object.

### Q: How do I localize error messages?
**A**: Keep `code` and `category` in English, localize `message` based on user language.

### Q: What about errors from third-party libraries?
**A**: Catch and convert to AppError:
```typescript
try {
  await externalAPI.call();
} catch (error) {
  throw AppError.internal(
    "External service error",
    error,
    { service: "payment-gateway" }
  );
}
```

---

## Documentation Map

1. **START HERE**: `/docs/ERROR_HANDLING.md` (628 lines)
   - Complete reference of all error codes
   - Client handling examples
   - Testing patterns

2. **For Quick Lookup**: `/docs/ERROR_CODES_QUICK_REF.md` (434 lines)
   - One-pagers for common scenarios
   - Error code decision tree
   - Common mistakes to avoid

3. **For Migration**: `/docs/ERROR_MIGRATION.md` (549 lines)
   - Step-by-step guide
   - Before/after patterns
   - Service-by-service checklist

4. **For Examples**: `/docs/ERROR_IMPLEMENTATION_EXAMPLE.md` (569 lines)
   - Real before/after code
   - API response comparisons
   - Complete working examples

---

## Summary

| Aspect | Old | New |
|--------|-----|-----|
| Error Identification | String message | Unique code + category |
| HTTP Status | Sometimes inconsistent | Always correct |
| Context | None | Rich, error-specific |
| Client Logic | String parsing (fragile) | Switch on code (robust) |
| Testing | Message assertions | Code assertions |
| Localization | Impossible | Simple i18n |
| Debugging | Guess what failed | Context shows exact state |
| Rate Limiting | Client guesses | retryable + retryAfter |
| Different 409s | Can't distinguish | All distinguishable by code |

---

## Next Steps

1. **Read** `/docs/ERROR_HANDLING.md` for complete reference
2. **Understand** the error code categorization
3. **Start migrating** core services using `/docs/ERROR_MIGRATION.md`
4. **Test** that error codes appear in responses
5. **Update clients** to use error codes instead of string parsing

---

## Support

- **Questions about error codes?** See `/docs/ERROR_CODES_QUICK_REF.md`
- **How to migrate?** See `/docs/ERROR_MIGRATION.md`
- **Complete examples?** See `/docs/ERROR_IMPLEMENTATION_EXAMPLE.md`
- **All details?** See `/docs/ERROR_HANDLING.md`

**Built for**: Mobile apps, third-party integrations, and any client that needs to handle errors programmatically without string parsing.

**Status**: ✓ Ready for integration. Core implementation complete. Gradual service migration in progress.
