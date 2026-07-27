# Structured Error Codes - Quick Reference

## One-Pagers for Common Scenarios

### Scenario 1: Booking Conflict (Two Different Cases)

#### Case A: Mentor is busy (reschedule needed)
```typescript
throw AppError.bookingConflict(
  "Mentor is not available at 2:00 PM (has session 2:00–3:00 PM)",
  {
    mentorId,
    requestedTime: scheduledAt,
    conflictingSession: {
      start: existingBooking.scheduled_at,
      end: calculateEndTime(existingBooking)
    }
  }
);

// Response HTTP 409
// Client: Show "Reschedule" UI
```

#### Case B: Booking was already paid (idempotent retry)
```typescript
throw AppError.bookingAlreadyPaid({
  bookingId,
  paidAt: booking.paid_at,
  paymentId: booking.payment_id
});

// Response HTTP 409
// Client: Show "Already paid" confirmation
```

---

### Scenario 2: User Not Found

```typescript
if (!user) {
  throw AppError.notFound("User", { userId });
}

// Response HTTP 404
{
  "code": "RESOURCE_NOT_FOUND",
  "message": "User not found",
  "details": {
    "context": { "userId": "user-123" }
  }
}
```

---

### Scenario 3: Insufficient Funds

```typescript
if (wallet.balance < amount) {
  throw AppError.insufficientFunds(
    `You need $${amount} but have $${wallet.balance}`,
    {
      required: amount,
      available: wallet.balance,
      currency: "USDC"
    }
  );
}

// Response HTTP 422
{
  "code": "INSUFFICIENT_FUNDS",
  "message": "You need $50 but have $30",
  "details": {
    "context": {
      "required": 50,
      "available": 30,
      "currency": "USDC"
    }
  }
}

// Client: Show "Add funds" flow
```

---

### Scenario 4: Access Denied

```typescript
if (booking.mentee_id !== userId) {
  throw AppError.forbidden(
    "You don't have access to this booking",
    { userId, bookingId, owner: booking.mentee_id }
  );
}

// Response HTTP 403
{
  "code": "ACCESS_DENIED",
  "message": "You don't have access to this booking"
}
```

---

### Scenario 5: Account Suspended/Banned

```typescript
if (user.status === "suspended") {
  throw AppError.forbidden(
    "Your account is temporarily suspended",
    { userId, suspendedUntil: user.suspended_until }
  );
}

if (user.status === "banned") {
  throw AppError.forbidden(
    "Your account has been permanently banned",
    { userId }
  );
}

// Response HTTP 403
// Client: Show appropriate message
```

---

### Scenario 6: Input Validation

```typescript
if (duration <= 0) {
  throw AppError.validation(
    "Duration must be greater than 0",
    { provided: duration }
  );
}

// Response HTTP 400
{
  "code": "INVALID_INPUT",
  "message": "Duration must be greater than 0"
}
```

---

### Scenario 7: Invalid State Transition

```typescript
if (booking.status !== "pending") {
  throw new AppError({
    code: ErrorCode.INVALID_STATE_TRANSITION,
    message: `Cannot confirm booking in ${booking.status} status`,
    context: {
      bookingId,
      currentStatus: booking.status,
      requiredStatus: "pending"
    }
  });
}

// Response HTTP 422
```

---

### Scenario 8: Internal Server Error

```typescript
try {
  await stellarService.submitTransaction(tx);
} catch (error) {
  throw AppError.internal(
    "Failed to submit transaction to Stellar",
    error instanceof Error ? error : undefined,
    { txHash, amount }
  );
}

// Response HTTP 500
// Automatically reported to Sentry
```

---

### Scenario 9: Rate Limited

```typescript
if (requestCount > limit) {
  throw AppError.rateLimitExceeded(60, { userId });
}

// Response HTTP 429
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded. Please retry after 60 seconds.",
  "details": {
    "retryable": true,
    "retryAfter": 60
  }
}

// Client: Wait 60s and retry
```

---

### Scenario 10: Service Temporarily Unavailable

```typescript
if (circuitBreakerOpen) {
  throw AppError.internal(
    "Service temporarily unavailable",
    undefined,
    { service: "payment-gateway" }
  );
}

// Response HTTP 503
```

---

## Error Code Decision Tree

```
What went wrong?
├─ User input is invalid? → ErrorCode.INVALID_INPUT
├─ User not authenticated? → ErrorCode.UNAUTHORIZED
├─ User not authorized? → ErrorCode.ACCESS_DENIED
├─ Resource not found?
│  ├─ User? → ErrorCode.USER_NOT_FOUND
│  ├─ Booking? → ErrorCode.BOOKING_NOT_FOUND
│  └─ Other? → ErrorCode.RESOURCE_NOT_FOUND
├─ Conflicting state?
│  ├─ Mentor busy? → ErrorCode.BOOKING_CONFLICT
│  ├─ Already paid? → ErrorCode.BOOKING_ALREADY_PAID
│  └─ Already exists? → ErrorCode.RESOURCE_ALREADY_EXISTS
├─ Operation not allowed in current state?
│  ├─ Invalid booking status? → ErrorCode.INVALID_BOOKING_STATUS
│  └─ General state? → ErrorCode.INVALID_STATE_TRANSITION
├─ Insufficient resources?
│  ├─ Money? → ErrorCode.INSUFFICIENT_FUNDS
│  └─ Other? → ErrorCode.PREREQUISITE_NOT_MET
├─ Too many requests? → ErrorCode.RATE_LIMIT_EXCEEDED
└─ Server error?
   ├─ Database? → ErrorCode.DATABASE_ERROR
   ├─ External service? → ErrorCode.EXTERNAL_SERVICE_ERROR
   └─ Unknown? → ErrorCode.INTERNAL_SERVER_ERROR
```

---

## Client-Side Handling Template

### TypeScript/React
```typescript
try {
  await apiCall();
} catch (error) {
  const { code, details, message } = error.response?.data || {};
  
  switch (code) {
    case 'BOOKING_CONFLICT':
      showRescheduleUI(details.context.conflictingSession);
      break;
    case 'BOOKING_ALREADY_PAID':
      showConfirmation(message);
      break;
    case 'INSUFFICIENT_FUNDS':
      showAddFundsUI(details.context.required - details.context.available);
      break;
    case 'TOKEN_EXPIRED':
      await refreshToken();
      return retryRequest();
    case 'RATE_LIMIT_EXCEEDED':
      showRetryPrompt(details.retryAfter);
      break;
    default:
      showError(message);
  }
}
```

### Swift/iOS
```swift
do {
  try await apiCall()
} catch let error as APIError {
  switch error.code {
  case "BOOKING_CONFLICT":
    presentRescheduleSheet(error.details)
  case "INSUFFICIENT_FUNDS":
    presentAddFundsFlow()
  case "TOKEN_EXPIRED":
    try await refreshToken()
    return try await retryRequest()
  default:
    showAlert(error.message)
  }
}
```

---

## Files to Check/Update

When implementing structured errors in your service:

1. **Import statements**
   ```typescript
   import { AppError } from "../utils/app-error";
   import { ErrorCode } from "../types/errors.types";
   ```

2. **Error throws** (update all `throw createError(...)` calls)
   ```typescript
   // Before
   throw createError("Message", 404);
   
   // After
   throw AppError.notFound("Resource", { id });
   ```

3. **Test files** (verify error codes in responses)
   ```typescript
   expect(response.body.code).toBe('BOOKING_CONFLICT');
   expect(response.body.details.context).toBeDefined();
   ```

---

## Common Mistakes to Avoid

❌ **Don't** use generic error codes for specific errors:
```typescript
throw AppError.validation("Mentor is not available"); // Wrong
throw AppError.bookingConflict("Mentor is not available"); // Right
```

❌ **Don't** forget context:
```typescript
throw AppError.notFound("Booking"); // Missing context
throw AppError.notFound("Booking", { bookingId }); // Good
```

❌ **Don't** use wrong HTTP status:
```typescript
throw new AppError({
  code: ErrorCode.BOOKING_ALREADY_PAID,
  message: "...",
  statusCode: 400 // Wrong, should be 409
}); // Handler will correct this automatically
```

✅ **Do** use specific factory methods:
```typescript
AppError.bookingConflict(...) // Clear intent
AppError.notFound(...) // Clear intent
AppError.insufficientFunds(...) // Clear intent
```

✅ **Do** include relevant context:
```typescript
{
  mentorId,
  requestedTime,
  conflictingSession: { start, end }
}
```

---

## Testing Checklist

For each error scenario:

- [ ] Error has unique ErrorCode
- [ ] Error message is user-friendly
- [ ] Context includes relevant IDs (mentorId, bookingId, etc.)
- [ ] Context includes relevant state (status, balance, etc.)
- [ ] HTTP status matches ErrorCode metadata
- [ ] Client can distinguish different 409 errors via code
- [ ] retryable flag is set correctly
- [ ] retryAfter is set for retryable errors

---

## API Documentation Example

```yaml
components:
  schemas:
    ErrorResponse:
      type: object
      required: [status, code, message, category, requestId, timestamp]
      properties:
        status:
          type: string
          const: "error"
        code:
          type: string
          enum: [BOOKING_CONFLICT, BOOKING_ALREADY_PAID, ...]
          description: Machine-readable error code
        message:
          type: string
          description: User-friendly error message
        category:
          type: string
          enum: [CONFLICT, NOT_FOUND, UNAUTHORIZED, ...]
          description: Error category for quick classification
        requestId:
          type: string
          description: Request ID for support lookup
        timestamp:
          type: string
          format: date-time
        details:
          type: object
          properties:
            context:
              type: object
              description: Error-specific context (mentorId, bookingId, etc.)
            retryable:
              type: boolean
              description: Whether client should retry
            retryAfter:
              type: integer
              description: Seconds to wait before retry (for 429)
```
