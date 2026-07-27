# Error Handling Guide

## Overview

This guide explains the structured error handling system for the MentorMinds API. All errors returned to clients include machine-readable error codes alongside human-readable messages, enabling robust client-side error handling without fragile string parsing.

## Error Response Format

All error responses follow this structure:

```json
{
  "status": "error",
  "code": "BOOKING_MENTOR_UNAVAILABLE",
  "message": "Mentor is not available at the requested time",
  "requestId": "req_abc123xyz",
  "timestamp": "2026-07-27T13:11:24.952Z",
  "details": {
    "mentorId": "mentor_456",
    "requestedTime": "2026-07-28T14:00:00Z"
  }
}
```

### Response Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | ✓ | Always `"error"` for error responses |
| `code` | string | ✓ | Machine-readable error code (e.g., `BOOKING_MENTOR_UNAVAILABLE`) |
| `message` | string | ✓ | Human-readable error message (English by default) |
| `requestId` | string | ✓ | Unique request identifier for debugging |
| `timestamp` | ISO 8601 | ✓ | Server timestamp when error occurred |
| `details` | object | ✗ | Context-specific error details (optional) |

## Error Codes

Error codes are organized by domain and use the pattern: `[DOMAIN]_[RESOURCE]_[CONDITION]`

### Authentication & Authorization (`AUTH_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `AUTH_INVALID_CREDENTIALS` | 401 | Invalid email or password |
| `AUTH_TOKEN_EXPIRED` | 401 | JWT token has expired |
| `AUTH_TOKEN_INVALID` | 401 | JWT token is malformed or invalid |
| `AUTH_UNAUTHORIZED` | 401 | Request requires authentication |
| `AUTH_FORBIDDEN` | 403 | User lacks required permissions |
| `AUTH_ACCOUNT_BANNED` | 403 | User account permanently banned |
| `AUTH_ACCOUNT_SUSPENDED` | 403 | User account temporarily suspended |

### Resource Not Found (`NOT_FOUND_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `NOT_FOUND_USER` | 404 | User not found |
| `NOT_FOUND_MENTOR` | 404 | Mentor not found |
| `NOT_FOUND_BOOKING` | 404 | Booking not found |
| `NOT_FOUND_SESSION` | 404 | Session not found |
| `NOT_FOUND_PAYMENT` | 404 | Payment not found |
| `NOT_FOUND_WALLET` | 404 | Wallet not found |
| (see `src/constants/error-codes.ts` for complete list) | 404 | ... |

### Booking Errors (`BOOKING_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `BOOKING_CONFLICT` | 409 | Mentor unavailable at requested time |
| `BOOKING_CONFLICT_TIME_OVERLAP` | 409 | Time slot overlaps with existing booking |
| `BOOKING_ALREADY_PAID` | 409 | Booking already paid (use for idempotency retry detection) |
| `BOOKING_ALREADY_CONFIRMED` | 409 | Booking already confirmed |
| `BOOKING_ALREADY_CANCELLED` | 409 | Booking already cancelled |
| `BOOKING_INVALID_STATE_TRANSITION` | 409 | Invalid booking state change |
| `BOOKING_INSUFFICIENT_BALANCE` | 500 | User's wallet balance too low |

### Payment Errors (`PAYMENT_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `PAYMENT_FAILED` | 500 | Payment processing failed |
| `PAYMENT_ALREADY_PROCESSED` | 409 | Payment already completed |
| `PAYMENT_INSUFFICIENT_FUNDS` | 500 | Insufficient funds available |
| `PAYMENT_UNSUPPORTED_CURRENCY` | 500 | Currency not supported |
| `PAYMENT_QUOTE_EXPIRED` | 500 | Exchange rate quote expired |
| `PAYMENT_TRANSACTION_FAILED` | 500 | Blockchain transaction failed |

### Validation Errors (`VALIDATION_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_INVALID_INPUT` | 400 | Invalid input data |
| `VALIDATION_INVALID_EMAIL` | 400 | Invalid email format |
| `VALIDATION_INVALID_PASSWORD` | 400 | Password doesn't meet requirements |
| `VALIDATION_INVALID_TIMEZONE` | 400 | Invalid IANA timezone identifier |
| `VALIDATION_MISSING_REQUIRED_FIELD` | 400 | Required field missing from request |

### Business Logic Errors (`BUSINESS_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `BUSINESS_DUPLICATE_ENTRY` | 409 | Duplicate entry (e.g., already enrolled) |
| `BUSINESS_DUPLICATE_REVIEW` | 409 | Review already exists for session |
| `BUSINESS_ACCESS_DENIED` | 403 | User lacks access to resource |
| `BUSINESS_PREREQUISITES_NOT_MET` | 403 | Prerequisite conditions not satisfied |
| `BUSINESS_NOT_PUBLISHED` | 400 | Learning path not yet published |

### Rate Limiting (`RATE_LIMIT_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded |
| `RATE_LIMIT_TOO_MANY_REQUESTS` | 429 | Too many requests (alias) |

### Service Errors (`SERVICE_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `SERVICE_UNAVAILABLE` | 502 | External service unavailable |
| `SERVICE_CIRCUIT_BREAKER_OPEN` | 502 | Circuit breaker open, retrying later |
| `SERVICE_TIMEOUT` | 503 | Request timeout |
| `SERVICE_DATABASE_ERROR` | 500 | Database operation failed |
| `SERVICE_EXTERNAL_API_ERROR` | 500 | Third-party API error |

See `src/constants/error-codes.ts` for the complete error code catalog.

## Using Error Classes in Services

### Basic Error Throwing

```typescript
import { AppError } from "../types/error.types";
import { BOOKING_CODES } from "../constants/error-codes";

// Simple error with code and message
throw new AppError(BOOKING_CODES.MENTOR_UNAVAILABLE);

// With custom message
throw new AppError(
  BOOKING_CODES.MENTOR_UNAVAILABLE,
  "Mentor is not available between 2-5 PM"
);

// With additional context
throw new AppError(
  BOOKING_CODES.MENTOR_UNAVAILABLE,
  "Mentor is not available at the requested time",
  {
    mentorId: "mentor_456",
    requestedTime: "2026-07-28T14:00:00Z",
    availableSlots: ["2026-07-28T10:00:00Z", "2026-07-28T16:00:00Z"],
  }
);
```

### Specialized Error Classes

```typescript
import {
  NotFoundError,
  ConflictError,
  AuthenticationError,
  BusinessLogicError,
  ExternalServiceError,
} from "../types/error.types";
import { NOT_FOUND_CODES, BOOKING_CODES, AUTH_CODES } from "../constants/error-codes";

// Not Found errors
throw new NotFoundError("Booking", bookingId, NOT_FOUND_CODES.BOOKING_NOT_FOUND);

// Conflict errors
throw new ConflictError(
  BOOKING_CODES.ALREADY_PAID,
  "Booking is already paid",
  { bookingId, paidAt: new Date() }
);

// Authentication errors
throw new AuthenticationError(
  AUTH_CODES.ACCOUNT_BANNED,
  "Your account has been permanently banned",
  { reason: "Terms of service violation", bannedAt: new Date() }
);

// Business logic errors
throw new BusinessLogicError(
  BUSINESS_CODES.DUPLICATE_REVIEW,
  "A review already exists for this session"
);

// External service errors
try {
  await stellarSDK.submitTransaction(tx);
} catch (err) {
  throw new ExternalServiceError(
    "Stellar",
    SERVICE_CODES.EXTERNAL_API_ERROR,
    "Failed to submit transaction to Stellar",
    err as Error,
    { transactionHash: tx.hash() }
  );
}
```

## Client-Side Error Handling Examples

### JavaScript/TypeScript

```typescript
// Distinguish between error types without string parsing
try {
  const response = await client.post('/bookings', bookingData);
  handleSuccessfulBooking(response.data);
} catch (error) {
  const errorData = error.response?.data;
  
  // Handle specific error conditions
  if (errorData?.code === 'BOOKING_MENTOR_UNAVAILABLE') {
    // Show available slots or reschedule flow
    showRescheduleFlow(errorData.details?.availableSlots);
  } else if (errorData?.code === 'BOOKING_ALREADY_PAID') {
    // Booking already confirmed (idempotent retry successful)
    handleIdempotentSuccess();
  } else if (errorData?.code === 'BOOKING_INSUFFICIENT_BALANCE') {
    // Prompt user to add funds
    navigateToWalletTopup();
  } else if (errorData?.code === 'AUTH_ACCOUNT_BANNED') {
    // Account banned - show specific message
    showAccountBannedMessage(errorData.details?.reason);
  } else {
    // Generic error handling
    showErrorToast(errorData?.message || 'Something went wrong');
  }
}
```

### React Hook Example

```typescript
const useBooking = () => {
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const createBooking = async (bookingData: BookingRequest) => {
    setIsLoading(true);
    try {
      const response = await api.post('/bookings', bookingData);
      return response.data;
    } catch (err: any) {
      const errorData = err.response?.data;
      setError(errorData);

      // Route to specific error handler based on code
      switch (errorData?.code) {
        case 'BOOKING_MENTOR_UNAVAILABLE':
          return { type: 'reschedule', availableSlots: errorData.details?.availableSlots };
        case 'BOOKING_ALREADY_PAID':
          return { type: 'already_confirmed' };
        case 'BOOKING_INSUFFICIENT_BALANCE':
          return { type: 'add_funds' };
        default:
          throw err;
      }
    } finally {
      setIsLoading(false);
    }
  };

  return { createBooking, error, isLoading };
};
```

### Mobile App (Swift Example)

```swift
enum BookingError: Decodable {
  case mentorUnavailable(AvailableSlots)
  case alreadyPaid
  case insufficientBalance
  case unknown(message: String)

  init(from code: String, details: [String: Any]?) {
    switch code {
    case "BOOKING_MENTOR_UNAVAILABLE":
      let slots = details?["availableSlots"] as? [String] ?? []
      self = .mentorUnavailable(slots)
    case "BOOKING_ALREADY_PAID":
      self = .alreadyPaid
    case "BOOKING_INSUFFICIENT_BALANCE":
      self = .insufficientBalance
    default:
      self = .unknown(message: details?["message"] as? String ?? "Unknown error")
    }
  }
}

// Usage
do {
  try await bookingService.createBooking(data)
} catch {
  let apiError = try JSONDecoder().decode(APIErrorResponse.self, from: error)
  let bookingError = BookingError(from: apiError.code, details: apiError.details)
  
  switch bookingError {
  case .mentorUnavailable(let slots):
    showRescheduleSheet(with: slots)
  case .alreadyPaid:
    showConfirmationAlert("Booking already confirmed")
  case .insufficientBalance:
    navigateToWalletTopup()
  case .unknown(let message):
    showErrorAlert(message)
  }
}
```

## Internationalization (i18n)

The error codes are language-agnostic. To support multiple languages:

1. Use `ERROR_CODE_MESSAGES` as the default (English) fallback
2. Map error codes to i18n translation keys
3. Clients use the error code to look up localized messages

```typescript
// Server-side (return code only, let client handle i18n)
throw new AppError(
  BOOKING_CODES.MENTOR_UNAVAILABLE,
  ERROR_CODE_MESSAGES[BOOKING_CODES.MENTOR_UNAVAILABLE]
);

// Client-side (map code to i18n key)
const getErrorMessage = (code: string, locale: string): string => {
  const i18nKey = `errors.${code.toLowerCase()}`;
  return i18n.t(i18nKey, { defaultValue: 'Something went wrong' });
};
```

## API Documentation

Swagger/OpenAPI responses include error codes:

```yaml
responses:
  '409':
    description: Booking Conflict
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/ErrorResponse'
        examples:
          mentorUnavailable:
            value:
              status: error
              code: BOOKING_MENTOR_UNAVAILABLE
              message: Mentor is not available at the requested time
          alreadyPaid:
            value:
              status: error
              code: BOOKING_ALREADY_PAID
              message: Booking is already paid
```

## Best Practices

### For Backend Developers

1. **Always use error codes** - Don't create error messages that clients need to parse
2. **Include context** - Use the `details` field to provide actionable information
3. **Use specialized error classes** - `NotFoundError`, `ConflictError`, etc. are semantic
4. **Preserve error chain** - Use `ExternalServiceError` to wrap third-party errors
5. **Test error paths** - Every error code should have test coverage

```typescript
// ✓ Good: Clear error code and actionable details
throw new ConflictError(
  BOOKING_CODES.CONFLICT_TIME_OVERLAP,
  "Time slot conflicts with existing booking",
  {
    existingBookingId: conflictingBooking.id,
    conflictingTimeRange: {
      start: conflictingBooking.startTime,
      end: conflictingBooking.endTime,
    },
  }
);

// ✗ Bad: No error code, requires string parsing
throw new Error("Cannot book at 2 PM because of existing booking at 2:30 PM");
```

### For Frontend Developers

1. **Don't parse messages** - Use error codes for logic, messages for display
2. **Handle rate limiting** - Implement exponential backoff for 429 responses
3. **Retry idempotently** - Use request IDs to detect duplicate processing
4. **Cache error codes** - Consider caching i18n translations for error messages
5. **Log errors properly** - Include code, message, and requestId for debugging

```typescript
// ✓ Good: Handle specific error codes
if (errorData?.code === 'BOOKING_CONFLICT') {
  // Show reschedule UI
}

// ✗ Bad: String parsing for error logic
if (errorData?.message?.includes('not available')) {
  // Fragile and breaks with i18n
}
```

## Migration Guide

If you have existing code using the old `createError()` function:

```typescript
// Old way (deprecated)
throw createError("Booking not found", 404);

// New way
import { NotFoundError } from "../types/error.types";
import { NOT_FOUND_CODES } from "../constants/error-codes";

throw new NotFoundError("Booking", bookingId, NOT_FOUND_CODES.BOOKING_NOT_FOUND);
```

## Error Catalog by HTTP Status

### 400 Bad Request
- `VALIDATION_INVALID_INPUT`
- `VALIDATION_INVALID_EMAIL`
- `VALIDATION_INVALID_PASSWORD`
- `VALIDATION_INVALID_TIMEZONE`
- `VALIDATION_MISSING_REQUIRED_FIELD`
- `BUSINESS_NOT_PUBLISHED`
- `BOOKING_INVALID_TIME_RANGE`

### 401 Unauthorized
- `AUTH_INVALID_CREDENTIALS`
- `AUTH_TOKEN_EXPIRED`
- `AUTH_TOKEN_INVALID`
- `AUTH_UNAUTHORIZED`
- `AUTH_MISSING_CREDENTIALS`

### 403 Forbidden
- `AUTH_FORBIDDEN`
- `AUTH_INSUFFICIENT_PERMISSIONS`
- `AUTH_ACCOUNT_BANNED`
- `AUTH_ACCOUNT_SUSPENDED`
- `BUSINESS_ACCESS_DENIED`
- `BUSINESS_PREREQUISITES_NOT_MET`

### 404 Not Found
- `NOT_FOUND_USER`
- `NOT_FOUND_MENTOR`
- `NOT_FOUND_BOOKING`
- `NOT_FOUND_SESSION`
- (all `NOT_FOUND_*` codes)

### 409 Conflict
- `BOOKING_CONFLICT`
- `BOOKING_ALREADY_PAID`
- `BOOKING_ALREADY_CONFIRMED`
- `BUSINESS_DUPLICATE_ENTRY`
- `BUSINESS_DUPLICATE_REVIEW`

### 429 Too Many Requests
- `RATE_LIMIT_EXCEEDED`
- `RATE_LIMIT_TOO_MANY_REQUESTS`

### 500 Internal Server Error
- `SERVER_INTERNAL_ERROR`
- `SERVICE_DATABASE_ERROR`
- `PAYMENT_TRANSACTION_FAILED`
- (most `SERVICE_*` and `PAYMENT_*` codes)

### 502 Bad Gateway
- `SERVICE_UNAVAILABLE`
- `SERVICE_CIRCUIT_BREAKER_OPEN`

### 503 Service Unavailable
- `SERVICE_TIMEOUT`

## References

- [Error Codes Catalog](../src/constants/error-codes.ts)
- [Error Types](../src/types/error.types.ts)
- [Error Handler Middleware](../src/middleware/errorHandler.ts)
