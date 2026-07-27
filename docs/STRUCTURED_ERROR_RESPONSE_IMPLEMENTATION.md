# Structured Error Response Implementation

## Overview

This implementation addresses the critical issue where the API was returning errors with only human-readable messages, forcing clients to parse error strings to determine specific error conditions. This new system introduces machine-readable error codes that enable robust, maintainable client-side error handling.

### Problem Statement (Original)

A mobile app handling a 409 booking conflict couldn't distinguish between:
- **"Mentor is not available at the requested time"** → User should reschedule
- **"Booking is already paid"** → Idempotency retry succeeded

Without error codes, the only option was fragile string parsing:

```javascript
// ❌ Before: Fragile string parsing
if (errorMessage.includes("Mentor is not available")) {
  // Reschedule flow
} else if (errorMessage.includes("already paid")) {
  // Idempotent success flow
}
```

Additionally, internationalizing error messages was impossible when the message itself was the identifier.

### Solution

Every API error now includes a machine-readable `code` field alongside the human-readable `message`, enabling robust client-side error handling:

```json
{
  "status": "error",
  "code": "BOOKING_MENTOR_UNAVAILABLE",
  "message": "Mentor is not available at the requested time",
  "requestId": "req_abc123",
  "timestamp": "2026-07-27T13:11:24.952Z",
  "details": {
    "mentorId": "mentor_456",
    "availableSlots": ["2026-07-28T10:00:00Z", "2026-07-28T14:00:00Z"]
  }
}
```

Now clients use error codes for logic, messages for display:

```javascript
// ✓ After: Robust error code matching
switch (error.code) {
  case 'BOOKING_MENTOR_UNAVAILABLE':
    showRescheduleFlow(error.details?.availableSlots);
    break;
  case 'BOOKING_ALREADY_PAID':
    handleIdempotentSuccess();
    break;
}
```

## Implementation Components

### 1. Error Code Catalog (`src/constants/error-codes.ts`)

Comprehensive catalog of all possible error codes organized by domain:

**106 machine-readable error codes** covering:
- **Authentication & Authorization** (9 codes)
- **Resource Not Found** (16 codes)
- **Booking Operations** (11 codes)
- **Payments & Wallets** (12 codes)
- **Input Validation** (9 codes)
- **Business Logic** (13 codes)
- **Rate Limiting** (2 codes)
- **External Services** (10 codes)
- **Server Errors** (4 codes)
- **Configuration** (2 codes)

**Key Features:**
- Centralized error code definitions
- HTTP status code mappings
- Default English messages (for i18n support)
- Type-safe code references

```typescript
// Example
export const BOOKING_CODES = {
  ALREADY_PAID: "BOOKING_ALREADY_PAID",
  MENTOR_UNAVAILABLE: "BOOKING_MENTOR_UNAVAILABLE",
  CONFLICT_TIME_OVERLAP: "BOOKING_CONFLICT_TIME_OVERLAP",
  // ... 8 more
} as const;

// Automatic type safety
type BookingError = typeof BOOKING_CODES[keyof typeof BOOKING_CODES];
```

### 2. Enhanced Error Classes (`src/types/error.types.ts`)

Structured error hierarchy providing semantic clarity:

**AppError** - Base class for all structured errors
```typescript
new AppError(
  BOOKING_CODES.MENTOR_UNAVAILABLE,
  "Mentor not available 2-5 PM",
  { availableSlots: ["10:00", "14:00"] }
)
```

**Specialized Subclasses:**
- **NotFoundError** - Resource doesn't exist (404)
- **ConflictError** - Conflict with existing state (409)
- **ValidationError** - Invalid input with field-level errors (400)
- **AuthenticationError** - Auth/permission issues (401, 403)
- **BusinessLogicError** - Business constraint violations (409)
- **ExternalServiceError** - Third-party service failures (5xx)

```typescript
throw new NotFoundError(
  "Booking",
  bookingId,
  NOT_FOUND_CODES.BOOKING_NOT_FOUND
);

throw new ConflictError(
  BOOKING_CODES.ALREADY_PAID,
  "Booking already paid",
  { paidAt: new Date() }
);

throw new ValidationError(
  { email: ["Invalid format"], password: ["Too short"] },
  "Registration failed"
);
```

### 3. Enhanced Error Handler Middleware (`src/middleware/errorHandler.ts`)

Restructured middleware that:
- Detects error type automatically (AppError vs generic Error)
- Extracts error code and status from structured errors
- Maintains backward compatibility
- Includes contextual request information
- Follows security best practices (stack traces only in dev)

**Response Structure:**
```json
{
  "status": "error",
  "code": "ERROR_CODE",
  "message": "Human-readable message",
  "requestId": "unique-request-id",
  "timestamp": "ISO-8601",
  "details": { "context": "specific fields" }
}
```

### 4. Comprehensive Documentation

#### [ERROR_HANDLING.md](./ERROR_HANDLING.md)
- Error response format specification
- Complete error code catalog
- HTTP status code mappings
- Client-side usage examples (JavaScript, React, Swift)
- Internationalization patterns
- Swagger/OpenAPI integration guide
- Best practices for backend and frontend

#### [ERROR_HANDLING_EXAMPLES.md](./ERROR_HANDLING_EXAMPLES.md)
- 5 detailed practical examples:
  1. Booking service distinguishing conflict types
  2. Payment service structured error details
  3. Learning path validation with field-level errors
  4. Session milestone prerequisite errors
  5. External service integration with circuit breaker
- Complete test scenarios
- Production patterns

#### [ERROR_HANDLING_MIGRATION.md](./ERROR_HANDLING_MIGRATION.md)
- Quick reference migration table
- Step-by-step migration guide
- Common patterns with before/after code
- Search commands for finding old patterns
- Migration checklist
- Priority service list for migration
- Testing guidance

### 5. Comprehensive Test Suite (`src/__tests__/error-handling.test.ts`)

488-line test suite covering:
- Error code to status mapping validation
- Each error class construction and behavior
- Error handler middleware for all error types
- Response format validation
- Field-level validation error handling
- Stack trace behavior (dev vs prod)
- Practical discrimination scenarios

## Key Benefits

### For Clients (Mobile, Web, Third-Party APIs)

1. **Programmable Error Handling** - Use error codes instead of string parsing
   ```javascript
   if (error.code === 'BOOKING_ALREADY_PAID') { /* handle */ }
   ```

2. **Internationalization Ready** - Map codes to i18n translations
   ```typescript
   const message = i18n.t(`errors.${error.code.toLowerCase()}`);
   ```

3. **Clear Action Items** - `details` field provides context
   ```javascript
   showRescheduleFlow(error.details?.availableSlots);
   ```

4. **Retry Logic** - Distinguish transient from permanent failures
   ```javascript
   if (error.details?.retryable) { attempt++ }
   ```

### For Backend Developers

1. **Structured Errors** - Semantic error classes instead of plain Error
2. **Type Safety** - Error codes are constants with autocomplete
3. **Consistency** - Centralized error catalog prevents duplicates
4. **Context Tracking** - Easy to include helpful details
5. **Maintainability** - Clear error intent and handling

### For the Platform

1. **Better Debugging** - Error codes in logs/monitoring
2. **Observability** - Track specific error patterns
3. **Analytics** - Understand failure modes by code
4. **Documentation** - Error codes are self-documenting
5. **Compliance** - Audit trails include specific error codes

## Architecture Decisions

### 1. Error Code Naming Convention: `[DOMAIN]_[RESOURCE]_[CONDITION]`

**Examples:**
- `BOOKING_MENTOR_UNAVAILABLE` - Booking domain, mentor resource, unavailable condition
- `AUTH_TOKEN_EXPIRED` - Auth domain, token resource, expired condition
- `NOT_FOUND_USER` - Not found domain, user resource

**Benefits:**
- Self-documenting
- Prevents naming conflicts
- Easy to search and understand
- Clear ownership domain

### 2. HTTP Status Code Mapping

Each error code maps to exactly one HTTP status:

```typescript
ERROR_CODE_TO_STATUS: Record<ErrorCode, number> = {
  BOOKING_ALREADY_PAID: 409,        // Conflict (not retryable)
  BOOKING_MENTOR_UNAVAILABLE: 409,  // Conflict (needs action)
  AUTH_TOKEN_EXPIRED: 401,          // Unauthorized
  NOT_FOUND_USER: 404,              // Not Found
  PAYMENT_UNSUPPORTED_CURRENCY: 500, // Server error (contact support)
}
```

**Pattern:**
- 400 - Client error, invalid input
- 401 - Unauthorized, authentication required
- 403 - Forbidden, authorization failed
- 404 - Resource not found
- 409 - Conflict, state mismatch or duplicate
- 429 - Rate limited
- 5xx - Server/service error

### 3. Details Field for Contextual Information

Each error can include a `details` object with relevant context:

```typescript
{
  "code": "BOOKING_CONFLICT",
  "details": {
    "mentorId": "m123",
    "requestedTime": "2026-07-28T14:00:00Z",
    "availableSlots": ["10:00", "16:00"],
    "nextAvailableDate": "2026-07-28"
  }
}
```

**Benefits:**
- Clients can make better UX decisions
- Reduces need for follow-up requests
- Enables pre-population of forms
- Powers detailed error messages

### 4. Error Class Hierarchy

Specialized subclasses provide semantic meaning:

```
Error
├── AppError (base class)
│   ├── NotFoundError (404)
│   ├── ConflictError (409)
│   ├── ValidationError (400, field-level)
│   ├── AuthenticationError (401, 403)
│   ├── BusinessLogicError (409)
│   └── ExternalServiceError (5xx)
```

**Why:**
- Type-safe in catch blocks: `catch (e: NotFoundError)`
- Clearer intent than `new AppError(...)`
- Extensible for future specializations

## Usage Patterns

### Pattern 1: Simple Not Found

```typescript
const user = await db.getUserById(id);
if (!user) {
  throw new NotFoundError("User", id, NOT_FOUND_CODES.USER_NOT_FOUND);
}
```

**Response:**
```json
{ "code": "NOT_FOUND_USER", "statusCode": 404 }
```

### Pattern 2: Conflict with Details

```typescript
if (booking.paymentStatus === "PAID") {
  throw new ConflictError(
    BOOKING_CODES.ALREADY_PAID,
    "This booking has already been paid",
    { bookingId, paidAt: booking.paidAt, paymentId: booking.paymentId }
  );
}
```

**Response:**
```json
{
  "code": "BOOKING_ALREADY_PAID",
  "statusCode": 409,
  "details": { "bookingId": "b123", "paidAt": "...", "paymentId": "..." }
}
```

### Pattern 3: Validation with Field Errors

```typescript
const fieldErrors: Record<string, string[]> = {};
if (!isValidEmail(email)) {
  fieldErrors.email = ["Invalid email format"];
}
if (password.length < 8) {
  fieldErrors.password = ["Password must be at least 8 characters"];
}
if (Object.keys(fieldErrors).length > 0) {
  throw new ValidationError(fieldErrors, "Registration validation failed");
}
```

**Response:**
```json
{
  "code": "VALIDATION_INVALID_INPUT",
  "statusCode": 400,
  "details": {
    "fieldErrors": {
      "email": ["Invalid email format"],
      "password": ["Password must be at least 8 characters"]
    }
  }
}
```

### Pattern 4: External Service with Retryability

```typescript
try {
  await stellarSDK.submitTransaction(tx);
} catch (err) {
  throw new ExternalServiceError(
    "Stellar",
    SERVICE_CODES.EXTERNAL_API_ERROR,
    "Transaction submission failed",
    err,
    {
      retryable: err.statusCode >= 500,
      attemptNumber: 2,
      backoffMs: 5000
    }
  );
}
```

**Response:**
```json
{
  "code": "SERVICE_EXTERNAL_API_ERROR",
  "statusCode": 500,
  "details": {
    "service": "Stellar",
    "retryable": true,
    "attemptNumber": 2,
    "backoffMs": 5000
  }
}
```

## File Locations

| File | Purpose | Lines |
|------|---------|-------|
| `src/constants/error-codes.ts` | Error codes catalog & mappings | 385 |
| `src/types/error.types.ts` | Error class definitions | 124 |
| `src/middleware/errorHandler.ts` | Enhanced error handler | 170 |
| `src/__tests__/error-handling.test.ts` | Comprehensive test suite | 488 |
| `docs/ERROR_HANDLING.md` | Complete user guide | 487 |
| `docs/ERROR_HANDLING_EXAMPLES.md` | 5 practical examples | 790 |
| `docs/ERROR_HANDLING_MIGRATION.md` | Migration guide for services | 480 |

**Total: 2,924 lines of code, tests, and documentation**

## Migration Path

### Phase 1: Foundation (Completed)
- ✅ Error codes catalog created
- ✅ Error classes defined
- ✅ Error handler middleware enhanced
- ✅ Tests written
- ✅ Documentation complete

### Phase 2: Service Migration (In Progress)
Priority order:
1. Bookings service - Critical path
2. Payments service - Financial correctness
3. Enrollment/Learning Path - User-facing
4. Reviews, Collaborations, Sessions
5. Remaining services

### Phase 3: Enforcement (Future)
- Remove deprecated `createError()` function
- Add linting rule to prevent `throw new Error(...)`
- Require error codes in new endpoints

## Backward Compatibility

The old `createError()` function still works (deprecated):

```typescript
// Still supported but discouraged
throw createError("User not found", 404);

// Will be removed in v2.0
```

The enhanced error handler automatically detects and handles both old and new error types.

## Monitoring & Observability

With this system, you can now:

**Track error patterns:**
```sql
SELECT code, COUNT(*) as count, AVG(response_time_ms) as avg_time
FROM api_errors
GROUP BY code
ORDER BY count DESC;
```

**Alert on specific conditions:**
```yaml
alert:
  - when: error_code == "PAYMENT_TRANSACTION_FAILED" AND count > 10/min
    then: notify_payments_team
  
  - when: error_code == "SERVICE_DATABASE_ERROR" AND count > 100/min
    then: page_on_call_engineer
```

**Analyze client impact:**
```sql
-- Find which apps are affected by specific error codes
SELECT client_id, COUNT(*) as error_count
FROM api_errors
WHERE code = "SERVICE_EXTERNAL_API_ERROR"
  AND timestamp > now() - interval '1 hour'
GROUP BY client_id;
```

## References

- [Complete Error Handling Guide](./ERROR_HANDLING.md)
- [Implementation Examples](./ERROR_HANDLING_EXAMPLES.md)
- [Migration Guide](./ERROR_HANDLING_MIGRATION.md)
- [Error Codes Catalog](../src/constants/error-codes.ts)
- [Error Types Definitions](../src/types/error.types.ts)
- [Enhanced Error Handler](../src/middleware/errorHandler.ts)
- [Test Suite](../src/__tests__/error-handling.test.ts)

## Next Steps

1. **Review Implementation** - Validate error codes cover all scenarios
2. **Migrate Services** - Follow the [Migration Guide](./ERROR_HANDLING_MIGRATION.md)
3. **Update Client Libraries** - Provide error code handling in SDKs
4. **Document API Changes** - Update Swagger/OpenAPI specs
5. **Train Teams** - Ensure backend/frontend teams understand the system
6. **Monitor Adoption** - Track which error codes are most common
7. **Iterate** - Add new codes as needed, refine existing ones

---

**Status:** ✅ Implementation Complete - Ready for Service Migration

**Impact:** Enables robust, maintainable error handling across all API consumers
