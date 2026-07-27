# Error Handling Migration Guide

This guide helps you migrate existing services from the old error handling approach to the new structured error system with machine-readable codes.

## Quick Reference

| Old Pattern | New Pattern | Error Code |
|------------|-----------|-----------|
| `throw createError("User not found", 404)` | `throw new NotFoundError("User", userId, NOT_FOUND_CODES.USER_NOT_FOUND)` | `NOT_FOUND_USER` |
| `throw createError("Mentor unavailable", 409)` | `throw new ConflictError(BOOKING_CODES.MENTOR_UNAVAILABLE, "...")` | `BOOKING_MENTOR_UNAVAILABLE` |
| `throw new Error("Invalid input")` | `throw new AppError(VALIDATION_CODES.INVALID_INPUT, "...")` | `VALIDATION_INVALID_INPUT` |
| `throw createError("Access denied", 403)` | `throw new AppError(AUTH_CODES.FORBIDDEN, "...")` | `AUTH_FORBIDDEN` |

## Step-by-Step Migration

### Step 1: Import Required Classes and Codes

```typescript
// Before
import { createError } from "../middleware/errorHandler";

// After
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  AuthenticationError,
  BusinessLogicError,
  ExternalServiceError,
} from "../types/error.types";
import {
  BOOKING_CODES,
  NOT_FOUND_CODES,
  PAYMENT_CODES,
  AUTH_CODES,
  BUSINESS_CODES,
  SERVICE_CODES,
  VALIDATION_CODES,
} from "../constants/error-codes";
```

### Step 2: Replace Simple 404 Errors

```typescript
// Before
if (!user) {
  throw createError("User not found", 404);
}

// After
if (!user) {
  throw new NotFoundError(
    "User",
    userId,
    NOT_FOUND_CODES.USER_NOT_FOUND
  );
}
```

### Step 3: Replace Conflict Errors (409)

```typescript
// Before
if (booking.status === "PAID") {
  throw createError("Booking is already paid", 409);
}

// After
if (booking.status === "PAID") {
  throw new ConflictError(
    BOOKING_CODES.ALREADY_PAID,
    "Booking is already paid",
    {
      bookingId,
      paidAt: booking.paidAt,
    }
  );
}
```

### Step 4: Replace Authorization Errors

```typescript
// Before
if (user.role !== "mentor") {
  throw createError("Access denied", 403);
}

// After
if (user.role !== "mentor") {
  throw new AppError(
    AUTH_CODES.FORBIDDEN,
    "Only mentors can perform this action"
  );
}
```

### Step 5: Replace Validation Errors

```typescript
// Before
throw createError("Invalid email", 400);

// After
throw new AppError(
  VALIDATION_CODES.INVALID_EMAIL,
  "Email format is invalid",
  { providedEmail: email }
);

// For multiple validation errors:
throw new ValidationError(
  {
    email: ["Invalid format"],
    password: ["Too short", "Must contain uppercase"],
  },
  "Validation failed"
);
```

### Step 6: Add Context Details

The new system allows you to include contextual information that helps clients make decisions:

```typescript
// Before: String only
throw createError("Mentor is not available", 409);

// After: Include helpful context
throw new ConflictError(
  BOOKING_CODES.MENTOR_UNAVAILABLE,
  "Mentor is not available at the requested time",
  {
    mentorId: booking.mentorId,
    requestedTime: booking.scheduledAt,
    availableSlots: ["2026-07-28T10:00:00Z", "2026-07-28T14:00:00Z"],
    nextAvailableDate: "2026-07-28",
  }
);
```

## Common Migration Patterns

### Pattern 1: 404 Resource Not Found

```typescript
// Before
async getSession(sessionId: string): Promise<Session> {
  const session = await db.query("SELECT * FROM sessions WHERE id = $1", [sessionId]);
  if (!session) {
    throw createError("Session not found", 404);
  }
  return session;
}

// After
async getSession(sessionId: string): Promise<Session> {
  const session = await db.query("SELECT * FROM sessions WHERE id = $1", [sessionId]);
  if (!session) {
    throw new NotFoundError(
      "Session",
      sessionId,
      NOT_FOUND_CODES.SESSION_NOT_FOUND
    );
  }
  return session;
}
```

### Pattern 2: 409 Conflict/Duplicate Entry

```typescript
// Before
async createReview(sessionId: string, reviewData: ReviewData) {
  const existing = await db.query("SELECT id FROM reviews WHERE session_id = $1", [sessionId]);
  if (existing) {
    throw createError("A review already exists for this session", 409);
  }
}

// After
async createReview(sessionId: string, reviewData: ReviewData) {
  const existing = await db.query("SELECT id FROM reviews WHERE session_id = $1", [sessionId]);
  if (existing) {
    throw new ConflictError(
      BUSINESS_CODES.DUPLICATE_REVIEW,
      "A review already exists for this session",
      {
        sessionId,
        existingReviewId: existing.id,
        createdAt: existing.created_at,
      }
    );
  }
}
```

### Pattern 3: 400 Validation Error

```typescript
// Before
if (isNaN(amount) || amount <= 0) {
  throw createError("Invalid send amount", 400);
}

// After
if (isNaN(amount) || amount <= 0) {
  throw new AppError(
    VALIDATION_CODES.INVALID_INPUT,
    "Amount must be a positive number",
    {
      providedAmount: amount,
      minimumAmount: 0.01,
    }
  );
}

// Or for field-level validation:
const fieldErrors: Record<string, string[]> = {};
if (!email || !isValidEmail(email)) {
  fieldErrors.email = ["Email is required and must be valid"];
}
if (!password || password.length < 8) {
  fieldErrors.password = ["Password must be at least 8 characters"];
}
if (Object.keys(fieldErrors).length > 0) {
  throw new ValidationError(fieldErrors, "Registration validation failed");
}
```

### Pattern 4: 500 External Service Error

```typescript
// Before
try {
  const result = await stellarSDK.submitTransaction(tx);
  return result;
} catch (err: any) {
  throw createError("Failed to submit transaction", 500);
}

// After
try {
  const result = await stellarSDK.submitTransaction(tx);
  return result;
} catch (err: any) {
  throw new ExternalServiceError(
    "Stellar",
    SERVICE_CODES.EXTERNAL_API_ERROR,
    "Failed to submit transaction to Stellar network",
    err,
    {
      transactionHash: tx.hash(),
      retryable: err.statusCode >= 500,
      errorDetail: err.message,
    }
  );
}
```

### Pattern 5: 403 Business Logic Authorization

```typescript
// Before
if (booking.userId !== currentUserId) {
  throw createError("Access denied", 403);
}

// After
if (booking.userId !== currentUserId) {
  throw new AppError(
    BUSINESS_CODES.ACCESS_DENIED,
    "You do not have permission to access this booking",
    {
      requestedBookingId: booking.id,
      ownerId: booking.userId,
      requestingUserId: currentUserId,
    }
  );
}
```

## Checking for Old Patterns

### Search for Deprecated `createError` Usage

```bash
# Find all uses of createError
grep -r "createError(" src/ --include="*.ts" | grep -v "node_modules"

# Find all uses of plain Error throws that should use AppError
grep -r "throw new Error(" src/services --include="*.ts" | head -20
```

### Common 404 Patterns

```bash
# Find "not found" errors (404s)
grep -r "not found" src/services --include="*.ts" -i | grep createError
```

### Common 409 Patterns

```bash
# Find conflict/already patterns (409s)
grep -r "already\|duplicate\|conflict" src/services --include="*.ts" -i | grep createError
```

## Service Migration Checklist

For each service file, follow this checklist:

- [ ] Import error classes: `AppError`, `NotFoundError`, `ConflictError`, etc.
- [ ] Import error codes: `BOOKING_CODES`, `NOT_FOUND_CODES`, etc.
- [ ] Replace all `createError()` calls with appropriate error classes
- [ ] Replace all `throw new Error()` with `AppError` or subclasses
- [ ] Add context details to error instances where helpful
- [ ] Review error messages for clarity
- [ ] Update unit tests to verify error codes
- [ ] Run `npm run lint` and `npm run build`
- [ ] Test error responses manually or with integration tests

## High-Priority Services to Migrate

Based on current error usage, prioritize these services:

1. **bookings.service.ts** - Most critical (booking flow errors)
2. **payments.service.ts** - High impact (payment flow errors)
3. **enrollments.service.ts** - Important (learning path errors)
4. **reviews.service.ts** - Important (review creation conflicts)
5. **learning-path.service.ts** - Important (path validation)
6. **collaboration-learning.service.ts** - Medium priority
7. **verification.service.ts** - Medium priority
8. **session-milestone.service.ts** - Medium priority
9. **webhook.service.ts** - Medium priority (uses custom error assignment)

## Testing After Migration

### Unit Test Example

```typescript
describe("BookingService", () => {
  it("should throw BOOKING_NOT_FOUND for missing booking", async () => {
    const service = new BookingService(mockDb);

    await expect(
      service.getBooking("nonexistent")
    ).rejects.toThrow(NotFoundError);

    try {
      await service.getBooking("nonexistent");
    } catch (err: any) {
      expect(err.code).toBe(NOT_FOUND_CODES.BOOKING_NOT_FOUND);
      expect(err.statusCode).toBe(404);
    }
  });

  it("should include context in conflict error", async () => {
    const service = new BookingService(mockDb);

    try {
      await service.confirmBooking(alreadyPaidBookingId);
    } catch (err: any) {
      expect(err.code).toBe(BOOKING_CODES.ALREADY_PAID);
      expect(err.details).toHaveProperty("paidAt");
      expect(err.details).toHaveProperty("paymentId");
    }
  });
});
```

### Integration Test Example

```typescript
describe("POST /bookings/:id/confirm", () => {
  it("should return 409 with BOOKING_ALREADY_PAID code", async () => {
    const response = await request(app)
      .post(`/bookings/${alreadyPaidId}/confirm`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: "error",
        code: "BOOKING_ALREADY_PAID",
        message: expect.any(String),
        requestId: expect.any(String),
      })
    );
  });

  it("should return 409 with BOOKING_MENTOR_UNAVAILABLE code", async () => {
    const response = await request(app)
      .post(`/bookings/${unavailableId}/confirm`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("BOOKING_MENTOR_UNAVAILABLE");
    expect(response.body.details).toHaveProperty("availableSlots");
  });
});
```

## Backwards Compatibility

### Handling Older Code

If you encounter code that still uses `createError()`:

```typescript
// The old createError still works for now (deprecated)
export const createError = (
  message: string,
  statusCode: number = 500,
): Error => {
  const error = new Error(message);
  (error as any).statusCode = statusCode;
  (error as any).isOperational = true;
  return error;
};
```

However, **new code should not use it**. It will be removed in a future version.

### Gradual Migration Strategy

1. **Phase 1**: Update high-priority services (bookings, payments)
2. **Phase 2**: Update medium-priority services
3. **Phase 3**: Remove deprecated `createError()` function
4. **Phase 4**: Enforce error code usage in linting rules

## Documentation Updates

After migrating a service, update or create:

1. **Swagger documentation** - Document error codes and details per endpoint
2. **Error codes catalog** - Add any new error codes to `error-codes.ts`
3. **API docs** - Update error response examples
4. **Client guides** - Help mobile/frontend teams handle new error codes

## Troubleshooting

### Issue: TypeScript errors after migration

**Solution**: Ensure error types are imported correctly:

```typescript
// Verify imports exist
import { AppError } from "../types/error.types";
import { BOOKING_CODES } from "../constants/error-codes";
```

### Issue: Tests failing after migration

**Solution**: Update test error assertions to check for error codes:

```typescript
// Before
expect(error.message).toContain("not found");

// After
expect(error.code).toBe(NOT_FOUND_CODES.BOOKING_NOT_FOUND);
```

### Issue: Circular dependency errors

**Solution**: If you see circular imports, ensure imports follow this order:
1. Types and interfaces
2. Constants
3. Error classes
4. Services

## Questions?

Refer to:
- [Error Handling Guide](./ERROR_HANDLING.md)
- [Error Code Catalog](../src/constants/error-codes.ts)
- [Implementation Examples](./ERROR_HANDLING_EXAMPLES.md)
- [Error Types](../src/types/error.types.ts)
