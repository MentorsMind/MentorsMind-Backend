# Structured Error Implementation - Complete Example

This document shows a full before/after migration of a service method using structured error codes.

## Example: Booking Service - Create Booking

### BEFORE (Old Implementation)

```typescript
// src/services/bookings.service.ts
import { createError } from "../middleware/errorHandler";
import { db } from "../config/database";

export const BookingsService = {
  async createBooking(data: CreateBookingData): Promise<BookingRecord> {
    // Validate users exist
    const { rows: users } = await db.query(
      `SELECT id, role, status FROM users WHERE id = ANY($1) AND is_active = true`,
      [[data.menteeId, data.mentorId]],
    );

    const mentee = users.find((u: any) => u.id === data.menteeId);
    const mentor = users.find((u: any) => u.id === data.mentorId);

    // Errors are indistinguishable by message
    if (!mentee) {
      throw createError("Mentee not found", 404);
    }
    if (!mentor) {
      throw createError("Mentor not found", 404);
    }

    // Status checks don't distinguish between different restrictions
    if (mentee.status === "suspended") {
      throw createError(
        "Your account is suspended. You cannot create bookings at this time.",
        403,
      );
    }
    if (mentee.status === "banned") {
      throw createError("Your account has been permanently banned.", 403);
    }
    if (mentor.status === "suspended" || mentor.status === "banned") {
      throw createError(
        "This mentor is not currently available for bookings.",
        400, // Wrong status code!
      );
    }

    if (mentor.role !== "mentor") {
      throw createError("User is not a mentor", 400);
    }

    // Availability check - but what if there's a conflict vs duplicate?
    const hasConflict = await BookingModel.checkConflict(
      data.mentorId,
      data.scheduledAt,
      data.durationMinutes,
    );

    if (hasConflict) {
      throw createError("Mentor is not available at the requested time", 409);
      // Client has no way to distinguish from: "Booking already paid"
    }

    // Success
    const booking = await BookingModel.create({...});
    return booking;
  }
};
```

**Problems with this approach:**

1. **No machine-readable codes**: Client must parse strings
   - `"Mentor not found"` vs `"Booking not found"` → same logic?
   - `"not available at the requested time"` vs `"already paid"` → both 409!

2. **Inconsistent status codes**: 400 vs 403 vs 404 for similar errors

3. **Client code is fragile**:
   ```typescript
   if (error.message.includes("not available")) {
     // Reschedule
   } else if (error.message.includes("already paid")) {
     // Confirm
   }
   ```

4. **Internationalization impossible**: Message IS the identifier

5. **No context for debugging**: Why wasn't mentor available?

---

### AFTER (New Implementation)

```typescript
// src/services/bookings.service.ts
import { AppError } from "../utils/app-error";
import { ErrorCode } from "../types/errors.types";
import { db } from "../config/database";

export const BookingsService = {
  async createBooking(data: CreateBookingData): Promise<BookingRecord> {
    // Validate users exist with specific error codes
    const { rows: users } = await db.query(
      `SELECT id, role, status FROM users WHERE id = ANY($1) AND is_active = true`,
      [[data.menteeId, data.mentorId]],
    );

    const mentee = users.find((u: any) => u.id === data.menteeId);
    const mentor = users.find((u: any) => u.id === data.mentorId);

    // Clear, distinct error codes
    if (!mentee) {
      throw AppError.notFound("Mentee", { menteeId: data.menteeId });
    }
    if (!mentor) {
      throw AppError.notFound("Mentor", { mentorId: data.mentorId });
    }

    // Status checks are now semantically correct
    if (mentee.status === "suspended") {
      throw AppError.forbidden(
        "Your account is temporarily suspended. You cannot create bookings.",
        {
          userId: data.menteeId,
          status: "suspended",
          suspendedUntil: mentee.suspended_until,
        }
      );
    }
    if (mentee.status === "banned") {
      throw AppError.forbidden(
        "Your account has been permanently banned.",
        {
          userId: data.menteeId,
          status: "banned",
        }
      );
    }
    if (mentor.status === "suspended" || mentor.status === "banned") {
      throw AppError.forbidden(
        "This mentor is not currently available for bookings.",
        {
          mentorId: data.mentorId,
          status: mentor.status,
        }
      );
    }

    if (mentor.role !== "mentor") {
      throw AppError.validation(
        "This user is not a mentor",
        {
          userId: data.mentorId,
          role: mentor.role,
        }
      );
    }

    // Availability check with rich context
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
            end: conflict.end,
            otherbookingId: conflict.bookingId,
          },
        }
      );
    }

    // Success
    const booking = await BookingModel.create({...});
    return booking;
  }
};
```

---

## API Response Comparison

### BEFORE

```json
// Mentee not found
{
  "status": "error",
  "message": "Mentee not found",
  "requestId": "req-abc123",
  "timestamp": "2026-07-27T10:30:00Z"
}

// Mentor not available
{
  "status": "error",
  "message": "Mentor is not available at the requested time",
  "requestId": "req-def456",
  "timestamp": "2026-07-27T10:30:00Z"
}

// Account suspended
{
  "status": "error",
  "message": "Your account is suspended. You cannot create bookings at this time.",
  "requestId": "req-ghi789",
  "timestamp": "2026-07-27T10:30:00Z"
}
```

**Problems:**
- Client cannot distinguish error types
- No retry information
- No error context for debugging
- Cannot localize messages without breaking logic

### AFTER

```json
// Mentee not found
{
  "status": "error",
  "code": "RESOURCE_NOT_FOUND",
  "message": "Mentee not found",
  "category": "NOT_FOUND",
  "requestId": "req-abc123",
  "timestamp": "2026-07-27T10:30:00Z",
  "details": {
    "context": {
      "menteeId": "mentee-123"
    }
  }
}

// Mentor not available (time conflict)
{
  "status": "error",
  "code": "BOOKING_CONFLICT",
  "message": "Mentor is not available at the requested time",
  "category": "CONFLICT",
  "requestId": "req-def456",
  "timestamp": "2026-07-27T10:30:00Z",
  "details": {
    "context": {
      "mentorId": "mentor-456",
      "requestedTime": "2026-08-01T14:00:00Z",
      "requestedDuration": 60,
      "conflictingSession": {
        "start": "2026-08-01T14:00:00Z",
        "end": "2026-08-01T15:00:00Z",
        "bookingId": "booking-789"
      }
    },
    "retryable": false
  }
}

// Account suspended
{
  "status": "error",
  "code": "ACCOUNT_SUSPENDED",
  "message": "Your account is temporarily suspended. You cannot create bookings.",
  "category": "FORBIDDEN",
  "requestId": "req-ghi789",
  "timestamp": "2026-07-27T10:30:00Z",
  "details": {
    "context": {
      "userId": "user-999",
      "status": "suspended",
      "suspendedUntil": "2026-08-03T00:00:00Z"
    }
  }
}
```

**Benefits:**
- ✅ Machine-readable error codes
- ✅ Error context for debugging
- ✅ Client can implement specific handling
- ✅ Messages can be localized
- ✅ Clear error categories
- ✅ Debugging support (booking details, affected users, etc.)

---

## Client-Side Usage Comparison

### BEFORE (Fragile String Matching)

```typescript
// React Component
const createBooking = async (mentorId, time) => {
  try {
    const booking = await api.post('/bookings', {
      mentorId,
      scheduledAt: time,
      durationMinutes: 60
    });
    showSuccess('Booking created');
  } catch (error) {
    // Fragile: Parsing error message strings
    if (error.message.includes("not found")) {
      // What didn't we find? Mentee? Mentor? Booking?
      showError("User not found");
    } else if (error.message.includes("not available")) {
      // Is it already booked? Or user banned? Can't tell!
      showError("Mentor is not available");
    } else if (error.message.includes("suspended")) {
      // Have to check if it's mentee or mentor
      if (error.message.includes("Your")) {
        showError("Your account is suspended");
      } else {
        showError("Mentor account is suspended");
      }
    } else {
      // Catch-all
      showError(error.message);
    }
  }
};
```

### AFTER (Structured Error Handling)

```typescript
// React Component
const createBooking = async (mentorId, time) => {
  try {
    const booking = await api.post('/bookings', {
      mentorId,
      scheduledAt: time,
      durationMinutes: 60
    });
    showSuccess('Booking created');
  } catch (error) {
    const { code, message, details } = error.response?.data || {};
    
    // Clear, switch-based handling
    switch (code) {
      case 'RESOURCE_NOT_FOUND':
        if (details.context.menteeId) {
          showError('Mentee not found');
        } else if (details.context.mentorId) {
          showError('Mentor not found');
        }
        break;

      case 'BOOKING_CONFLICT':
        // Mentor time conflict - offer reschedule
        const { conflictingSession } = details.context;
        showRescheduleUI(conflictingSession);
        break;

      case 'ACCOUNT_SUSPENDED':
        const { suspendedUntil } = details.context;
        showError(`Account suspended until ${suspendedUntil}`);
        break;

      case 'ACCOUNT_BANNED':
        showError('Account permanently banned. Contact support.');
        break;

      case 'MENTOR_UNAVAILABLE':
        showError('This mentor is not accepting bookings');
        break;

      default:
        showError(message);
    }
  }
};
```

---

## Test Cases Comparison

### BEFORE (Testing Error Messages)

```typescript
describe('createBooking', () => {
  it('should handle mentee not found', async () => {
    const response = await api.post('/bookings', {
      menteeId: 'nonexistent',
      mentorId: mentor.id,
      scheduledAt: futureDate,
      durationMinutes: 60
    });
    
    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Mentee not found");
    // Can't test specific error type
  });

  it('should handle mentor not available', async () => {
    // Create existing booking
    await createBooking(mentor, existingTime);
    
    const response = await api.post('/bookings', {
      menteeId: user.id,
      mentorId: mentor.id,
      scheduledAt: existingTime,
      durationMinutes: 60
    });
    
    expect(response.status).toBe(409);
    expect(response.body.message).toContain("not available");
    // Can't distinguish from "already paid"!
  });
});
```

### AFTER (Testing Error Codes)

```typescript
describe('createBooking', () => {
  it('should return RESOURCE_NOT_FOUND for nonexistent mentee', async () => {
    const response = await api.post('/bookings', {
      menteeId: 'nonexistent',
      mentorId: mentor.id,
      scheduledAt: futureDate,
      durationMinutes: 60
    }).expect(404);
    
    expect(response.body.code).toBe('RESOURCE_NOT_FOUND');
    expect(response.body.details.context.menteeId).toBe('nonexistent');
  });

  it('should return BOOKING_CONFLICT with session details', async () => {
    // Create existing booking
    const existing = await createBooking(mentor, existingTime);
    
    const response = await api.post('/bookings', {
      menteeId: user.id,
      mentorId: mentor.id,
      scheduledAt: existingTime,
      durationMinutes: 60
    }).expect(409);
    
    expect(response.body.code).toBe('BOOKING_CONFLICT');
    expect(response.body.details.context.conflictingSession).toEqual({
      start: existingTime,
      end: calculateEndTime(existing),
      bookingId: existing.id
    });
  });

  it('should distinguish BOOKING_CONFLICT from BOOKING_ALREADY_PAID', async () => {
    const booking = await createBooking(mentor, time);
    await payForBooking(booking); // Mark as paid
    
    // Try to pay again
    const response = await api.post(`/bookings/${booking.id}/payments`, {
      amount: booking.amount
    }).expect(409);
    
    expect(response.body.code).toBe('BOOKING_ALREADY_PAID');
    expect(response.body.details.context.paidAt).toBeDefined();
  });

  it('should return ACCOUNT_SUSPENDED for suspended user', async () => {
    const suspendedUser = await createUser({ status: 'suspended' });
    
    const response = await api.post('/bookings', {
      menteeId: suspendedUser.id,
      mentorId: mentor.id,
      scheduledAt: futureDate,
      durationMinutes: 60
    }).expect(403);
    
    expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
    expect(response.body.details.context.suspendedUntil).toBeDefined();
  });
});
```

---

## Summary of Changes

| Aspect | Before | After |
|--------|--------|-------|
| **Error Identification** | String message | Unique error code |
| **HTTP Status** | Sometimes inconsistent | Always matches ErrorCode metadata |
| **Context** | None | Rich, error-specific context |
| **Client Logic** | String parsing | Switch statement on code |
| **Testing** | Message assertions | Code assertions |
| **Localization** | Impossible | Simple i18n on message |
| **API Documentation** | Error list with messages | Documented error codes with context schema |
| **Debugging** | Guess why it failed | Context shows exact state |
| **Retry Logic** | Clients guess | retryable + retryAfter flags |

---

## Complete Working Example

### Step 1: Service Method
```typescript
// src/services/bookings.service.ts
import { AppError } from "../utils/app-error";

async createBooking(data: CreateBookingData) {
  // Validation with specific errors
  if (!mentee) throw AppError.notFound("Mentee", { menteeId: data.menteeId });
  if (!mentor) throw AppError.notFound("Mentor", { mentorId: data.mentorId });
  
  // Status checks with context
  if (mentee.status === "suspended") {
    throw AppError.forbidden("Account suspended", { 
      userId: data.menteeId,
      suspendedUntil: mentee.suspended_until 
    });
  }
  
  // Conflicts with details
  if (hasConflict) {
    throw AppError.bookingConflict("Time not available", {
      conflictingSession: { start, end }
    });
  }
  
  return await BookingModel.create(data);
}
```

### Step 2: Error Response
```json
{
  "status": "error",
  "code": "BOOKING_CONFLICT",
  "message": "Time not available",
  "category": "CONFLICT",
  "requestId": "req-abc",
  "timestamp": "2026-07-27T10:30:00Z",
  "details": {
    "context": {
      "conflictingSession": {
        "start": "2026-08-01T14:00:00Z",
        "end": "2026-08-01T15:00:00Z"
      }
    }
  }
}
```

### Step 3: Client Handling
```typescript
switch (error.code) {
  case 'BOOKING_CONFLICT':
    showRescheduleUI(error.details.context.conflictingSession);
    break;
}
```

Done! Clear, maintainable, machine-readable errors.
