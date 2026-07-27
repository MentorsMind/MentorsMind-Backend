# Error Handling Migration Guide

This guide helps you migrate existing code to use structured error codes.

## What Changed

### Before
```typescript
// Old way: Only message and status code
throw createError("Mentor is not available at the requested time", 409);
throw createError("Booking not found", 404);
throw createError("Access denied", 403);

// Error response:
{
  "status": "error",
  "message": "Mentor is not available at the requested time",
  "requestId": "req-123"
}

// Client: Must parse string to determine action
if (error.message.includes("not available")) {
  showRescheduleUI();
}
```

### After
```typescript
// New way: Specific error code with context
throw AppError.bookingConflict(
  "Mentor is not available at the requested time",
  { mentorId, conflictingSession }
);
throw AppError.notFound("Booking", { bookingId });
throw AppError.forbidden("Access denied to this booking", { userId, bookingId });

// Error response:
{
  "status": "error",
  "code": "BOOKING_CONFLICT",
  "message": "Mentor is not available at the requested time",
  "category": "CONFLICT",
  "requestId": "req-123",
  "details": {
    "context": {
      "mentorId": "mentor-123",
      "conflictingSession": { "start": "...", "end": "..." }
    }
  }
}

// Client: Can switch on error code
switch (error.code) {
  case 'BOOKING_CONFLICT':
    showRescheduleUI(error.details.context.conflictingSession);
    break;
}
```

## Migration Steps

### Step 1: Update Imports

Change from:
```typescript
import { createError } from "../middleware/errorHandler";
```

To:
```typescript
import { AppError } from "../utils/app-error";
import { ErrorCode } from "../types/errors.types";
```

### Step 2: Replace Error Throws

#### Pattern 1: Not Found Errors (404)

**Before:**
```typescript
if (!booking) {
  throw createError("Booking not found", 404);
}

if (!mentor) {
  throw createError("Mentor not found", 404);
}
```

**After:**
```typescript
if (!booking) {
  throw AppError.notFound("Booking", { bookingId });
}

if (!mentor) {
  throw AppError.notFound("Mentor", { mentorId });
}
```

#### Pattern 2: Conflict Errors (409)

**Before:**
```typescript
if (hasConflict) {
  throw createError("Mentor is not available at the requested time", 409);
}

if (booking.status === 'paid') {
  throw createError("Booking is already paid", 409);
}
```

**After:**
```typescript
if (hasConflict) {
  throw AppError.bookingConflict(
    "Mentor is not available at the requested time",
    { 
      mentorId,
      requestedTime: scheduledAt,
      conflictingSession: { start, end }
    }
  );
}

if (booking.status === 'paid') {
  throw AppError.bookingAlreadyPaid({
    bookingId,
    paidAt: booking.paid_at
  });
}
```

#### Pattern 3: Authorization Errors (403)

**Before:**
```typescript
if (mentee.status === "suspended") {
  throw createError(
    "Your account is suspended. You cannot create bookings at this time.",
    403,
  );
}

if (booking.mentee_id !== userId) {
  throw createError("Access denied", 403);
}
```

**After:**
```typescript
if (mentee.status === "suspended") {
  throw AppError.forbidden(
    "Your account is suspended. You cannot create bookings at this time.",
    { userId, status: mentee.status }
  );
}

if (booking.mentee_id !== userId) {
  throw AppError.forbidden(
    "You don't have access to this booking",
    { userId, bookingId, ownerId: booking.mentee_id }
  );
}
```

#### Pattern 4: Validation Errors (400)

**Before:**
```typescript
if (mentee.status === "suspended" || mentee.status === "banned") {
  throw createError(
    "This mentor is not currently available for bookings.",
    400,
  );
}

if (mentor.role !== "mentor") {
  throw createError("User is not a mentor", 400);
}
```

**After:**
```typescript
if (mentee.status === "suspended" || mentee.status === "banned") {
  throw new AppError({
    code: ErrorCode.MENTOR_UNAVAILABLE,
    message: "This mentor is not currently available for bookings.",
    context: { mentorId, status: mentee.status }
  });
}

if (mentor.role !== "mentor") {
  throw AppError.validation(
    "This user is not a mentor",
    { userId: mentorId, role: mentor.role }
  );
}
```

#### Pattern 5: Insufficient Funds (422)

**Before:**
```typescript
if (wallet.balance < amount) {
  throw createError("Insufficient funds", 400);
}
```

**After:**
```typescript
if (wallet.balance < amount) {
  throw AppError.insufficientFunds(
    `Insufficient balance. You need $${amount} but have $${wallet.balance}.`,
    {
      required: amount,
      available: wallet.balance,
      currency: "USDC"
    }
  );
}
```

#### Pattern 6: Generic Errors

**Before:**
```typescript
try {
  await processPayment(booking);
} catch (error) {
  throw createError("Failed to process payment", 500);
}
```

**After:**
```typescript
try {
  await processPayment(booking);
} catch (error) {
  throw AppError.internal(
    "Failed to process payment",
    error instanceof Error ? error : undefined,
    { bookingId }
  );
}
```

### Step 3: Update Error Constants Usage

If you use custom status codes, map them to ErrorCode:

**Before:**
```typescript
const ERROR_CODES = {
  BOOKING_NOT_FOUND: 404,
  MENTOR_UNAVAILABLE: 409,
  INSUFFICIENT_FUNDS: 400,
};

throw createError("Mentor not available", 409);
```

**After:**
```typescript
// Use ErrorCode enum directly
throw AppError.bookingConflict(
  "Mentor not available",
  { mentorId }
);
```

### Step 4: Handle Optional Legacy Code

For backward compatibility during migration, you can keep `createError` working:

```typescript
// In errorHandler.ts, we already support both:
export const createError = (
  message: string,
  errorCode: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
  context?: Record<string, any>,
): AppError => {
  return new AppError({
    code: errorCode,
    message,
    context,
  });
};
```

Usage:
```typescript
// Old style still works (uses generic error code)
throw createError("Something failed", 500);

// Better: Use specific error code
throw createError("Booking not found", ErrorCode.BOOKING_NOT_FOUND);
```

## Common Migration Patterns

### Pattern: Mentor Availability Check

**File:** `src/services/bookings.service.ts`

**Before:**
```typescript
const hasConflict = await BookingModel.checkConflict(
  data.mentorId,
  data.scheduledAt,
  data.durationMinutes,
);

if (hasConflict) {
  throw createError("Mentor is not available at the requested time", 409);
}
```

**After:**
```typescript
const conflict = await BookingModel.checkConflict(
  data.mentorId,
  data.scheduledAt,
  data.durationMinutes,
);

if (conflict) {
  throw AppError.bookingConflict(
    "Mentor is not available at the requested time",
    {
      mentorId: data.mentorId,
      requestedTime: data.scheduledAt,
      requestedDuration: data.durationMinutes,
      conflictingSession: {
        start: conflict.start,
        end: conflict.end
      }
    }
  );
}
```

### Pattern: Access Control

**Before:**
```typescript
if (booking.mentee_id !== userId) {
  throw createError("Access denied", 403);
}
```

**After:**
```typescript
if (booking.mentee_id !== userId) {
  throw AppError.forbidden(
    "You don't have permission to access this booking",
    {
      userId,
      bookingId,
      owner: booking.mentee_id
    }
  );
}
```

### Pattern: Resource Not Found

**Before:**
```typescript
const user = await User.findById(userId);
if (!user) {
  throw createError("User not found", 404);
}
```

**After:**
```typescript
const user = await User.findById(userId);
if (!user) {
  throw AppError.notFound("User", { userId });
}
```

### Pattern: State Validation

**Before:**
```typescript
if (booking.status !== "pending") {
  throw createError("Cannot cancel a booking in this status", 400);
}
```

**After:**
```typescript
if (booking.status !== "pending") {
  throw new AppError({
    code: ErrorCode.INVALID_BOOKING_STATUS,
    message: `Cannot cancel booking in ${booking.status} status`,
    context: {
      bookingId,
      currentStatus: booking.status,
      expectedStatus: "pending"
    }
  });
}
```

## Service-by-Service Migration

### bookings.service.ts

Lines to update:
- 104-107: User not found → `AppError.notFound()`
- 112-121: Account status → `AppError.forbidden()`
- 130: Mentor role check → `AppError.validation()`
- 135: Conflict check → `AppError.bookingConflict()`
- 170: Booking not found → `AppError.notFound()`
- 174: Access denied → `AppError.forbidden()`

### payments.service.ts

Lines to update:
- All "not found" checks → `AppError.notFound()`
- "Access denied" → `AppError.forbidden()`
- 107: "Booking is already paid" → `AppError.bookingAlreadyPaid()`
- "Unsupported currency" → `AppError.validation()`

### enrollment.service.ts

Lines to update:
- "Learning path not found" → `AppError.notFound()`
- "Student is already enrolled" → `AppError.conflict()`
- Account status checks → `AppError.forbidden()`

## Testing the Migration

### Unit Tests

```typescript
import { AppError, ErrorCode } from '../utils/app-error';

describe('BookingsService', () => {
  it('should throw BOOKING_CONFLICT when mentor has conflict', async () => {
    try {
      await BookingsService.createBooking(conflictingData);
      fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe(ErrorCode.BOOKING_CONFLICT);
      expect(error.context?.mentorId).toBeDefined();
    }
  });

  it('should throw BOOKING_ALREADY_PAID when booking is paid', async () => {
    try {
      await BookingsService.payForBooking(paidBooking);
      fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe(ErrorCode.BOOKING_ALREADY_PAID);
      expect(error.message).toContain('already paid');
    }
  });
});
```

### Integration Tests

```typescript
describe('POST /bookings', () => {
  it('should return BOOKING_CONFLICT with details', async () => {
    const response = await request(app)
      .post('/bookings')
      .send(conflictingBookingData)
      .expect(409);

    expect(response.body.code).toBe('BOOKING_CONFLICT');
    expect(response.body.details.context.conflictingSession).toBeDefined();
  });

  it('should return BOOKING_ALREADY_PAID on duplicate payment', async () => {
    const response = await request(app)
      .post(`/bookings/${booking.id}/payments`)
      .send({ amount })
      .expect(409);

    expect(response.body.code).toBe('BOOKING_ALREADY_PAID');
    expect(response.body.details.retryable).toBe(false);
  });
});
```

## Gradual Migration Strategy

If migrating a large codebase, use this approach:

1. **Phase 1**: Migrate core error flows
   - BookingsService (priority: HIGH)
   - PaymentsService (priority: HIGH)
   - AuthService (priority: HIGH)

2. **Phase 2**: Migrate supporting services
   - EnrollmentService
   - ReviewsService
   - CalendarService

3. **Phase 3**: Migrate utility services
   - All other services
   - Ensure backward compatibility during transition

4. **Phase 4**: Remove legacy error handling
   - Deprecate old `createError` function
   - Add linting rules to catch old patterns

## Backward Compatibility

The updated `errorHandler` automatically converts old-style errors:

```typescript
// Old code still works (will have generic error code)
throw createError("Something failed", 500);

// Error response will use INTERNAL_SERVER_ERROR
{
  "status": "error",
  "code": "INTERNAL_SERVER_ERROR",
  "message": "Something failed"
}
```

However, specific error codes won't be available, so clients can't distinguish between different error types. This is why migration is important.

## Rollback Plan

If you need to rollback:

1. The error handler gracefully handles both old and new errors
2. Old clients expecting `{ status, message }` will still work
3. New clients expecting `{ status, code, message }` will get the enhanced response
4. No breaking changes to the API

## Questions?

See `/docs/ERROR_HANDLING.md` for:
- Complete error code reference
- Client implementation examples
- Error handling best practices
- Testing examples
