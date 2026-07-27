# Structured Error Responses - Quick Reference Card

## Problem Solved
Mobile app couldn't distinguish "Mentor unavailable" (reschedule) from "Already paid" (idempotent success) without fragile string parsing.

## Solution
Every error now includes a machine-readable `code` field alongside human-readable `message`.

---

## Error Response Format

```json
{
  "status": "error",
  "code": "ERROR_CODE",
  "message": "Human-readable message",
  "requestId": "unique-id",
  "timestamp": "2026-07-27T13:11:24.952Z",
  "details": { "context": "specific fields" }
}
```

---

## Common Error Codes

### Booking Errors (409 Conflict)
| Code | Meaning | Action |
|------|---------|--------|
| `BOOKING_MENTOR_UNAVAILABLE` | Mentor not available | Show reschedule UI with available slots |
| `BOOKING_ALREADY_PAID` | Booking already paid | Treat as idempotent success |
| `BOOKING_ALREADY_CONFIRMED` | Already confirmed | Show existing booking details |
| `BOOKING_INSUFFICIENT_BALANCE` | Wallet balance too low | Prompt to add funds |

### Authentication Errors (401/403)
| Code | Meaning | Action |
|------|---------|--------|
| `AUTH_INVALID_CREDENTIALS` | Bad email/password | Show login retry |
| `AUTH_TOKEN_EXPIRED` | JWT expired | Re-authenticate |
| `AUTH_ACCOUNT_BANNED` | Account banned | Show support message |

### Validation Errors (400)
| Code | Meaning | Action |
|------|---------|--------|
| `VALIDATION_INVALID_EMAIL` | Invalid email format | Show field error |
| `VALIDATION_INVALID_INPUT` | Invalid data | Highlight fields in details |

### Not Found Errors (404)
| Code | Meaning | Action |
|------|---------|--------|
| `NOT_FOUND_BOOKING` | Booking doesn't exist | Show 404 message |
| `NOT_FOUND_USER` | User doesn't exist | Show 404 message |

### Payment Errors (500)
| Code | Meaning | Action |
|------|---------|--------|
| `PAYMENT_INSUFFICIENT_FUNDS` | Balance too low | Prompt to add funds |
| `PAYMENT_UNSUPPORTED_CURRENCY` | Currency not supported | Show supported currencies |
| `PAYMENT_QUOTE_EXPIRED` | Rate quote expired | Refresh quote |

### Service Errors (500/502/503)
| Code | Meaning | Retry? |
|------|---------|---------|
| `SERVICE_EXTERNAL_API_ERROR` | External service failed | Yes (check `details.retryable`) |
| `SERVICE_TIMEOUT` | Request timeout | Yes (with backoff) |
| `SERVICE_CIRCUIT_BREAKER_OPEN` | Service temporarily unavailable | Yes (after `details.retryAfter` ms) |

---

## Backend Usage

### Import Required Classes
```typescript
import {
  AppError, NotFoundError, ConflictError, ValidationError,
  AuthenticationError, BusinessLogicError, ExternalServiceError
} from "../types/error.types";
import {
  BOOKING_CODES, NOT_FOUND_CODES, PAYMENT_CODES, AUTH_CODES,
  VALIDATION_CODES, BUSINESS_CODES, SERVICE_CODES
} from "../constants/error-codes";
```

### Throw Structured Errors
```typescript
// Simple error
throw new AppError(VALIDATION_CODES.INVALID_EMAIL);

// With custom message
throw new AppError(BOOKING_CODES.MENTOR_UNAVAILABLE, "Not available 2-5 PM");

// With context details
throw new ConflictError(
  BOOKING_CODES.ALREADY_PAID,
  "Booking already paid",
  { bookingId, paidAt: booking.paidAt }
);

// Not found with resource info
throw new NotFoundError("Booking", bookingId, NOT_FOUND_CODES.BOOKING_NOT_FOUND);

// Validation with field errors
throw new ValidationError(
  { email: ["Invalid format"], password: ["Too short"] },
  "Registration validation failed"
);

// External service error
throw new ExternalServiceError(
  "Stellar",
  SERVICE_CODES.EXTERNAL_API_ERROR,
  "Transaction failed",
  originalError,
  { retryable: true }
);
```

---

## Frontend Usage

### Swift/iOS
```swift
do {
  try await api.confirmBooking(id)
} catch {
  let apiError = try JSONDecoder().decode(APIErrorResponse.self, from: error)
  
  switch apiError.code {
  case "BOOKING_MENTOR_UNAVAILABLE":
    let slots = apiError.details["availableSlots"] as? [String]
    showRescheduleSheet(with: slots)
  case "BOOKING_ALREADY_PAID":
    showSuccess("Booking already confirmed")
  case "BOOKING_INSUFFICIENT_BALANCE":
    navigateToWalletTopup()
  default:
    showError(apiError.message)
  }
}
```

### JavaScript/React
```typescript
try {
  await api.confirmBooking(id);
} catch (error) {
  const { code, message, details } = error.response?.data;
  
  switch (code) {
    case 'BOOKING_MENTOR_UNAVAILABLE':
      setAvailableSlots(details.availableSlots);
      setShowReschedule(true);
      break;
    case 'BOOKING_ALREADY_PAID':
      handleIdempotentSuccess();
      break;
    case 'BOOKING_INSUFFICIENT_BALANCE':
      navigateToWalletTopup(details.shortfall);
      break;
    default:
      showError(message);
  }
}
```

### Retry Logic
```typescript
async function retryWithBackoff(request, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await request();
    } catch (error) {
      const { code, details } = error.response?.data;
      
      // Detect retryable errors
      if (details?.retryable && attempt < maxRetries) {
        const delay = details.backoffMs || (1000 * Math.pow(2, attempt - 1));
        await sleep(delay);
        continue;
      }
      
      throw error;
    }
  }
}
```

---

## Internationalization

### Map Codes to i18n Keys
```typescript
const getErrorMessage = (code: string, locale: string): string => {
  const i18nKey = `errors.${code.toLowerCase()}`;
  return i18n.t(i18nKey, { defaultValue: code });
};

// Usage
const localizedMessage = getErrorMessage(error.code, 'es'); // Spanish
// Returns: "Mentor no disponible a la hora solicitada"
```

### i18n File Structure
```json
{
  "errors": {
    "booking_mentor_unavailable": "Mentor is not available at the requested time",
    "booking_already_paid": "Booking is already paid",
    "booking_insufficient_balance": "Insufficient wallet balance",
    "auth_account_banned": "Your account has been permanently banned"
  }
}
```

---

## Error Code Categories

| Category | Count | Codes |
|----------|-------|-------|
| Authentication | 9 | AUTH_* |
| Not Found | 16 | NOT_FOUND_* |
| Booking | 11 | BOOKING_* |
| Payment | 12 | PAYMENT_* |
| Validation | 9 | VALIDATION_* |
| Business Logic | 13 | BUSINESS_* |
| Rate Limiting | 2 | RATE_LIMIT_* |
| Services | 10 | SERVICE_* |
| Server | 4 | SERVER_* |
| Config | 2 | CONFIG_* |
| **TOTAL** | **106** | |

---

## HTTP Status Mapping

| Status | Error Codes | Example |
|--------|-------------|---------|
| 400 | VALIDATION_* | Invalid input, missing field |
| 401 | AUTH_INVALID_CREDENTIALS, AUTH_TOKEN_EXPIRED | Bad login, expired token |
| 403 | AUTH_FORBIDDEN, BUSINESS_ACCESS_DENIED | No permission, banned |
| 404 | NOT_FOUND_* | Resource doesn't exist |
| 409 | BOOKING_*, BUSINESS_DUPLICATE_* | Conflict, already paid |
| 429 | RATE_LIMIT_* | Rate limited |
| 500 | PAYMENT_*, SERVICE_* | Server/service error |
| 502 | SERVICE_UNAVAILABLE | Bad gateway |
| 503 | SERVICE_TIMEOUT | Service down |

---

## Migration Path

### Step 1: Replace `createError()`
```typescript
// Before
throw createError("User not found", 404);

// After
throw new NotFoundError("User", userId, NOT_FOUND_CODES.USER_NOT_FOUND);
```

### Step 2: Add Context Details
```typescript
// Before
throw createError("Mentor not available", 409);

// After
throw new ConflictError(
  BOOKING_CODES.MENTOR_UNAVAILABLE,
  "Mentor not available at requested time",
  { availableSlots: ["10:00", "14:00"], mentorId }
);
```

### Step 3: Use Specialized Classes
```typescript
// Before
throw new Error("Access denied");

// After
throw new AppError(AUTH_CODES.FORBIDDEN, "Access denied", { userId });
```

---

## Helpful Links

- **Complete Guide:** [docs/ERROR_HANDLING.md](docs/ERROR_HANDLING.md)
- **Examples:** [docs/ERROR_HANDLING_EXAMPLES.md](docs/ERROR_HANDLING_EXAMPLES.md)
- **Migration:** [docs/ERROR_HANDLING_MIGRATION.md](docs/ERROR_HANDLING_MIGRATION.md)
- **Error Codes:** [src/constants/error-codes.ts](src/constants/error-codes.ts)
- **Error Classes:** [src/types/error.types.ts](src/types/error.types.ts)
- **Error Handler:** [src/middleware/errorHandler.ts](src/middleware/errorHandler.ts)

---

## Testing

### Check Error Code
```typescript
try {
  await service.operation();
} catch (err: any) {
  expect(err.code).toBe(BOOKING_CODES.MENTOR_UNAVAILABLE);
  expect(err.statusCode).toBe(409);
}
```

### Check Response Format
```typescript
const response = await request(app)
  .post('/bookings/confirm')
  .expect(409);

expect(response.body).toEqual(
  expect.objectContaining({
    status: "error",
    code: expect.any(String),
    message: expect.any(String),
    requestId: expect.any(String)
  })
);
```

---

**Quick Access:** Most questions answered in links above.
**Status:** ✅ Ready to use in production.
