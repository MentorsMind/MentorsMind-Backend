# Structured Error Handling Guide

## Overview

The MentorMinds API uses **machine-readable error codes** in structured responses, enabling API consumers (mobile apps, third-party integrations) to handle errors programmatically without parsing error messages.

Each error response includes:
- **`code`** (machine-readable): Unique identifier for the error condition
- **`message`** (human-readable): User-friendly description (can be localized)
- **`category`** (error classification): Type of error for quick routing
- **`requestId`** (tracking): Links error to logs for debugging
- **`timestamp`**: When the error occurred
- **`details`** (optional): Additional context (retryability, retry-after, etc.)

## Error Response Format

### Successful Response Structure
```json
{
  "status": "success",
  "data": { /* ... */ },
  "requestId": "req-12345678",
  "timestamp": "2026-07-27T10:30:00Z"
}
```

### Error Response Structure
```json
{
  "status": "error",
  "code": "BOOKING_CONFLICT",
  "message": "Mentor is not available at the requested time",
  "category": "CONFLICT",
  "requestId": "req-12345678",
  "timestamp": "2026-07-27T10:30:00Z",
  "details": {
    "context": {
      "mentorId": "mentor-123",
      "requestedTime": "2026-08-01T14:00:00Z"
    },
    "retryable": false
  }
}
```

## Error Codes Reference

### Validation Errors (400)

| Code | Message | Use Case |
|------|---------|----------|
| `INVALID_INPUT` | Input validation failed | Generic validation error |
| `INVALID_EMAIL` | Invalid email format | Email format validation |
| `INVALID_PHONE` | Invalid phone number format | Phone validation |
| `INVALID_CURRENCY` | Unsupported currency | Unknown currency code |
| `INVALID_TIMEZONE` | Invalid timezone identifier | Unknown timezone |
| `INVALID_DURATION` | Invalid duration value | Duration <= 0 |
| `MISSING_REQUIRED_FIELD` | Required field is missing | Missing required parameter |

**Example**: User provides `duration: -30`
```json
{
  "status": "error",
  "code": "INVALID_DURATION",
  "message": "Duration must be greater than 0 minutes",
  "category": "VALIDATION",
  "requestId": "req-abc123"
}
```

### Authentication Errors (401)

| Code | Message | Use Case |
|------|---------|----------|
| `UNAUTHORIZED` | Authentication required | Missing/no token |
| `INVALID_CREDENTIALS` | Invalid username or password | Wrong password |
| `INVALID_TOKEN` | Invalid or malformed token | Corrupted token |
| `TOKEN_EXPIRED` | Token has expired | Refresh token needed |
| `TOKEN_REVOKED` | Token has been revoked | Logout/password change |
| `MFA_REQUIRED` | Multi-factor authentication required | MFA challenge |

**Example**: Expired token
```json
{
  "status": "error",
  "code": "TOKEN_EXPIRED",
  "message": "Your session has expired. Please log in again.",
  "category": "UNAUTHORIZED",
  "requestId": "req-xyz789",
  "details": {
    "retryable": true
  }
}
```

**Client Handling**:
```typescript
if (response.code === 'TOKEN_EXPIRED') {
  // Refresh token and retry
  const newToken = await refreshToken();
  return retryRequest(newToken);
}
```

### Authorization Errors (403)

| Code | Message | Use Case |
|------|---------|----------|
| `ACCESS_DENIED` | Access denied to this resource | Permission check failed |
| `INSUFFICIENT_PERMISSIONS` | Insufficient permissions for this action | Missing role/scope |
| `ACCOUNT_SUSPENDED` | Account is suspended | Account temporarily disabled |
| `ACCOUNT_BANNED` | Account has been permanently banned | Account permanently disabled |
| `MENTOR_UNAVAILABLE` | Mentor is not available | Mentor status check |

**Example**: Suspended account
```json
{
  "status": "error",
  "code": "ACCOUNT_SUSPENDED",
  "message": "Your account is suspended. Please contact support.",
  "category": "FORBIDDEN",
  "requestId": "req-123xyz"
}
```

### Not Found Errors (404)

| Code | Message | Use Case |
|------|---------|----------|
| `USER_NOT_FOUND` | User not found | User ID doesn't exist |
| `MENTOR_NOT_FOUND` | Mentor not found | Mentor ID doesn't exist |
| `MENTEE_NOT_FOUND` | Mentee not found | Mentee ID doesn't exist |
| `BOOKING_NOT_FOUND` | Booking not found | Booking ID doesn't exist |
| `SESSION_NOT_FOUND` | Session not found | Session ID doesn't exist |
| `PAYMENT_NOT_FOUND` | Payment not found | Payment ID doesn't exist |
| `WALLET_NOT_FOUND` | Wallet not found | Wallet doesn't exist |
| `RESOURCE_NOT_FOUND` | Resource not found | Generic not found |

**Example**: Booking not found
```json
{
  "status": "error",
  "code": "BOOKING_NOT_FOUND",
  "message": "Booking ABC123 not found",
  "category": "NOT_FOUND",
  "requestId": "req-456def"
}
```

### Conflict Errors (409)

These errors require **different handling logic** based on the specific conflict type:

| Code | Message | Handling Logic | Retryable |
|------|---------|----------------|-----------|
| `BOOKING_CONFLICT` | Booking conflict with existing booking | Mentor time unavailable, reschedule needed | No |
| `DUPLICATE_BOOKING` | Duplicate booking already exists | Idempotency check, may retry | Yes |
| `BOOKING_ALREADY_PAID` | Booking has already been paid | Duplicate payment attempt, abort | No |
| `RESOURCE_ALREADY_EXISTS` | Resource already exists | Duplicate resource, show existing | No |
| `MENTOR_TIME_SLOT_TAKEN` | Mentor time slot is already taken | Time unavailable, reschedule needed | No |
| `CONCURRENT_MODIFICATION` | Resource was modified concurrently | Optimistic lock, retry with new data | Yes |

**Example 1: Mentor not available (reschedule flow)**
```json
{
  "status": "error",
  "code": "BOOKING_CONFLICT",
  "message": "Mentor is not available at the requested time (conflict with session 2:00–3:00 PM)",
  "category": "CONFLICT",
  "requestId": "req-789abc",
  "details": {
    "context": {
      "mentorId": "mentor-123",
      "requestedTime": "2026-08-01T14:00:00Z",
      "conflictingSession": {
        "start": "2026-08-01T14:00:00Z",
        "end": "2026-08-01T15:00:00Z"
      }
    },
    "retryable": false
  }
}
```

**Client Handling**:
```typescript
if (response.code === 'BOOKING_CONFLICT') {
  // Show reschedule UI with available time slots
  showRescheduleDialog(response.details.context.conflictingSession);
}
```

**Example 2: Already paid (idempotency failure)**
```json
{
  "status": "error",
  "code": "BOOKING_ALREADY_PAID",
  "message": "Booking has already been paid",
  "category": "CONFLICT",
  "requestId": "req-def456",
  "details": {
    "context": {
      "bookingId": "booking-123",
      "paidAt": "2026-07-27T10:15:00Z",
      "paymentId": "payment-789"
    },
    "retryable": false
  }
}
```

**Client Handling**:
```typescript
if (response.code === 'BOOKING_ALREADY_PAID') {
  // Show confirmation screen - booking is already paid
  showConfirmation(`Booking confirmed (Payment: ${response.details.context.paymentId})`);
}
```

### Unprocessable Entity Errors (422)

| Code | Message | Use Case |
|------|---------|----------|
| `INSUFFICIENT_FUNDS` | Insufficient funds for this operation | Balance check failed |
| `INVALID_STATE_TRANSITION` | Invalid state transition | Invalid workflow state |
| `PREREQUISITE_NOT_MET` | Prerequisites not met for this operation | Dependencies not satisfied |
| `INVALID_BOOKING_STATUS` | Invalid booking status for this operation | Operation invalid for status |

**Example**: Insufficient funds
```json
{
  "status": "error",
  "code": "INSUFFICIENT_FUNDS",
  "message": "Insufficient balance. You need $50 but have $30.",
  "category": "UNPROCESSABLE",
  "requestId": "req-ghi789",
  "details": {
    "context": {
      "required": 50,
      "available": 30,
      "currency": "USD"
    }
  }
}
```

**Client Handling**:
```typescript
if (response.code === 'INSUFFICIENT_FUNDS') {
  const shortfall = response.details.context.required - response.details.context.available;
  showPaymentFailure(`Add $${shortfall} to proceed with booking`);
}
```

### Rate Limit Errors (429)

| Code | Message | Use Case |
|------|---------|----------|
| `RATE_LIMIT_EXCEEDED` | Rate limit exceeded | Too many requests |

**Example**: Rate limited
```json
{
  "status": "error",
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded. Please retry after 60 seconds.",
  "category": "RATE_LIMIT",
  "requestId": "req-jkl012",
  "details": {
    "retryable": true,
    "retryAfter": 60
  }
}
```

**Client Handling**:
```typescript
if (response.code === 'RATE_LIMIT_EXCEEDED') {
  const retryAfter = response.details.retryAfter || 60;
  setTimeout(() => retryRequest(), retryAfter * 1000);
}
```

### Server Errors (5xx)

| Code | Status | Message | Handling |
|------|--------|---------|----------|
| `INTERNAL_SERVER_ERROR` | 500 | Internal server error | Unexpected condition, report to Sentry |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable | Dependency down, retry with backoff |
| `DATABASE_ERROR` | 500 | Database error occurred | Infrastructure issue |
| `PAYMENT_GATEWAY_ERROR` | 502 | Payment gateway error | External service error |
| `STELLAR_ERROR` | 502 | Stellar blockchain error | Blockchain service error |
| `EXTERNAL_SERVICE_ERROR` | 502 | External service error | Third-party service error |

**Example**: Service unavailable
```json
{
  "status": "error",
  "code": "SERVICE_UNAVAILABLE",
  "message": "Service temporarily unavailable. Please try again in 30 seconds.",
  "category": "SERVICE_UNAVAILABLE",
  "requestId": "req-mno345",
  "details": {
    "retryable": true,
    "retryAfter": 30
  }
}
```

## Using Error Codes in Implementation

### Server-Side: Throwing Errors

```typescript
import { AppError, ErrorCode } from '../types/errors.types';

// Using factory methods (recommended)
throw AppError.bookingConflict(
  'Mentor is not available at 2:00 PM (conflict with session 2:00–3:00 PM)',
  {
    mentorId: mentorId,
    requestedTime: scheduledAt,
    conflictingSession: { start, end }
  }
);

// Using constructor
throw new AppError({
  code: ErrorCode.BOOKING_ALREADY_PAID,
  message: 'This booking has already been paid',
  context: { bookingId, paidAt },
});

// For specific resources
throw AppError.notFound('Booking', { bookingId: 'ABC123' });

// For insufficient funds
throw AppError.insufficientFunds(
  `Insufficient balance. You need $${required} but have $${available}`,
  { required, available, currency: 'USD' }
);
```

### Client-Side: Handling Errors

#### JavaScript/TypeScript
```typescript
try {
  const response = await api.post('/bookings', bookingData);
  showSuccess('Booking created');
} catch (error) {
  if (error.response?.data?.code === 'BOOKING_CONFLICT') {
    // Mentor not available - show reschedule UI
    const conflict = error.response.data.details.context.conflictingSession;
    showRescheduleDialog(conflict);
  } else if (error.response?.data?.code === 'BOOKING_ALREADY_PAID') {
    // Already paid - show confirmation
    showConfirmation('Booking already confirmed');
  } else if (error.response?.data?.code === 'TOKEN_EXPIRED') {
    // Refresh token and retry
    await refreshToken();
    return retryRequest();
  } else if (error.response?.status === 429) {
    // Rate limited - wait and retry
    const retryAfter = error.response.data.details?.retryAfter || 60;
    showMessage(`Please wait ${retryAfter}s`);
  } else {
    // Generic error handling
    showError(error.response?.data?.message || 'An error occurred');
  }
}
```

#### Swift (iOS)
```swift
do {
  let booking = try await api.createBooking(data)
} catch let error as APIError {
  switch error.code {
  case "BOOKING_CONFLICT":
    // Reschedule flow
    showRescheduleSheet(error.details.context)
  case "BOOKING_ALREADY_PAID":
    // Show confirmation
    showAlert("Booking already paid")
  case "TOKEN_EXPIRED":
    // Refresh and retry
    try await auth.refreshToken()
    return try await api.createBooking(data)
  case "RATE_LIMIT_EXCEEDED":
    let retryAfter = error.details?.retryAfter ?? 60
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(retryAfter)) {
      retry()
    }
  default:
    showError(error.message)
  }
}
```

#### React
```typescript
const createBooking = async (data) => {
  try {
    const response = await api.post('/bookings', data);
    setSuccess('Booking created');
  } catch (error) {
    const errorCode = error.response?.data?.code;
    
    if (errorCode === 'BOOKING_CONFLICT') {
      setShowReschedule(true);
      setConflictInfo(error.response.data.details.context);
    } else if (errorCode === 'INSUFFICIENT_FUNDS') {
      const shortfall = error.response.data.details.context.required - 
                        error.response.data.details.context.available;
      setError(`Add $${shortfall} to your wallet`);
    } else if (shouldRetry(error)) {
      handleRetry(error.response.data.details?.retryAfter);
    }
  }
};
```

## Migration Guide

### Before (Old Style)
```typescript
// Service layer
if (hasConflict) {
  throw createError("Mentor is not available at the requested time", 409);
}
if (booking.status === 'paid') {
  throw createError("Booking is already paid", 409);
}

// Client must parse message string to distinguish errors
if (error.message.includes("already paid")) {
  // Idempotency retry
} else if (error.message.includes("not available")) {
  // Reschedule flow
}
```

### After (New Style)
```typescript
// Service layer
if (hasConflict) {
  throw AppError.bookingConflict(
    "Mentor is not available at the requested time",
    { mentorId, requestedTime, conflictingSession }
  );
}
if (booking.status === 'paid') {
  throw AppError.bookingAlreadyPaid({ bookingId, paidAt });
}

// Client can switch on error code
switch (error.code) {
  case 'BOOKING_CONFLICT':
    // Reschedule flow
    break;
  case 'BOOKING_ALREADY_PAID':
    // Idempotency retry
    break;
}
```

## Best Practices

### 1. Always Include Context
```typescript
// ❌ Bad: No context
throw AppError.notFound('Booking');

// ✅ Good: Include relevant IDs and state
throw AppError.notFound('Booking', {
  bookingId: bookingId,
  userId: userId,
  requestedTime: scheduledAt
});
```

### 2. Choose Specific Error Codes
```typescript
// ❌ Bad: Too generic
throw new AppError({
  code: ErrorCode.INVALID_INPUT,
  message: "Something is wrong"
});

// ✅ Good: Specific code and message
throw new AppError({
  code: ErrorCode.BOOKING_CONFLICT,
  message: "Mentor is not available at 2:00 PM"
});
```

### 3. Set Retryable Flag Correctly
```typescript
// ❌ Bad: All errors marked retryable
throw AppError.bookingAlreadyPaid({ retryable: true });

// ✅ Good: Only truly retryable errors
if (networkFailure) {
  throw new AppError({
    code: ErrorCode.SERVICE_UNAVAILABLE,
    message: "Service temporarily unavailable",
    retryable: true,
    retryAfter: 30
  });
}
```

### 4. Distinguish Client vs Server Logic Errors
```typescript
// Client error: Wrong input, no retry
throw AppError.bookingConflict(
  "Mentor is not available at 2:00 PM",
  { conflictingSession }
);

// Server error: Transient failure, retry
throw AppError.internal(
  "Failed to lock escrow contract",
  originalError,
  { bookingId }
);
```

## Documentation for API Consumers

When publishing your API documentation (Swagger, OpenAPI), include:

```yaml
responses:
  '409':
    description: Conflict
    content:
      application/json:
        schema:
          oneOf:
            - $ref: '#/components/schemas/BookingConflictError'
            - $ref: '#/components/schemas/BookingAlreadyPaidError'
  
components:
  schemas:
    BookingConflictError:
      type: object
      properties:
        status:
          type: string
          enum: ['error']
        code:
          type: string
          enum: ['BOOKING_CONFLICT']
        message:
          type: string
          example: "Mentor is not available at 2:00 PM"
        category:
          type: string
          enum: ['CONFLICT']
        requestId:
          type: string
        details:
          type: object
          properties:
            context:
              type: object
              properties:
                conflictingSession:
                  type: object
```

## Testing Error Responses

```typescript
describe('POST /bookings', () => {
  it('should return BOOKING_CONFLICT when mentor has conflict', async () => {
    // Create existing booking
    await createBooking(mentor, '2:00 PM');
    
    // Try to create overlapping booking
    const response = await api.post('/bookings', {
      mentorId: mentor.id,
      scheduledAt: '2:00 PM',
      durationMinutes: 60
    });
    
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('BOOKING_CONFLICT');
    expect(response.body.details.context.conflictingSession).toBeDefined();
  });

  it('should return BOOKING_ALREADY_PAID on duplicate payment', async () => {
    const booking = await createBooking(mentor, '2:00 PM');
    await payForBooking(booking);
    
    const response = await api.post(`/bookings/${booking.id}/payments`, {
      amount: booking.amount
    });
    
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('BOOKING_ALREADY_PAID');
    expect(response.body.details.retryable).toBe(false);
  });
});
```

## Localization

The `message` field is user-facing and can be localized. The `code` and `category` are machine-readable and should NOT be localized:

```typescript
// Server sends neutral message
{
  "code": "BOOKING_CONFLICT",
  "message": "Mentor is not available at the requested time"
}

// Client translates if needed
const translations = {
  en: { BOOKING_CONFLICT: "Time slot is not available" },
  es: { BOOKING_CONFLICT: "El horario no está disponible" },
  fr: { BOOKING_CONFLICT: "Le créneau n'est pas disponible" }
};

const localizedMessage = translations[locale][errorCode] || message;
```
