# 🚀 Structured Error Handling - START HERE

## The Problem

Your mobile app receives a `409 Conflict` response but **doesn't know what to do**:
- Is the mentor's time slot taken? → Show reschedule UI
- Is the booking already paid? → Show confirmation
- Something else? → Show error message

Without error codes, the app must **parse the error message** (fragile and unmaintainable).

## The Solution

**Error codes** - Machine-readable identifiers that tell the client exactly what happened:

```json
{
  "code": "BOOKING_CONFLICT",     ← What happened
  "message": "Mentor unavailable" ← Why it happened (user-friendly)
}
```

Now the client can handle each case specifically:
```typescript
switch (error.code) {
  case 'BOOKING_CONFLICT': showRescheduleUI(); break;
  case 'BOOKING_ALREADY_PAID': showConfirmation(); break;
}
```

## ✅ What's Implemented

- **42 error codes** across 9 categories
- **Rich context** (mentorId, conflictingSession, balance, etc.)
- **Retryable flag** for rate limits and transient errors
- **Type-safe** TypeScript implementation
- **Backward compatible** with existing error handling
- **Comprehensive docs** (3,084 lines)

## 📚 Documentation

Pick your path:

### 🎯 I want a quick overview (10 min)
→ Read: `docs/STRUCTURED_ERRORS_README.md`

### 📖 I need the complete reference (30 min)
→ Read: `docs/ERROR_HANDLING.md` (all error codes, client examples, testing)

### ⚡ I need quick lookups during development
→ Use: `docs/ERROR_CODES_QUICK_REF.md` (bookmark this!)

### 🔧 I'm migrating a service
→ Follow: `docs/ERROR_MIGRATION.md` (step-by-step guide)

### 💡 I want to see real code examples
→ Study: `docs/ERROR_IMPLEMENTATION_EXAMPLE.md` (before/after)

## 🛠 Quick Start

### Backend: Throw Structured Errors
```typescript
import { AppError } from "../utils/app-error";

// Instead of: throw createError("Message", 409);
throw AppError.bookingConflict(
  "Mentor is not available at 2:00 PM",
  { mentorId, conflictingSession: { start, end } }
);
```

### Frontend: Handle by Error Code
```typescript
try {
  await api.createBooking(data);
} catch (error) {
  switch (error.response.data.code) {
    case 'BOOKING_CONFLICT':
      showRescheduleUI(error.response.data.details.context);
      break;
    case 'BOOKING_ALREADY_PAID':
      showConfirmation('Already booked');
      break;
  }
}
```

## 📋 Error Codes At a Glance

| Code | Status | Use Case |
|------|--------|----------|
| `BOOKING_CONFLICT` | 409 | Mentor time not available |
| `BOOKING_ALREADY_PAID` | 409 | Duplicate payment attempt |
| `INSUFFICIENT_FUNDS` | 422 | Balance too low |
| `TOKEN_EXPIRED` | 401 | Refresh token needed |
| `ACCESS_DENIED` | 403 | Permission check failed |
| `ACCOUNT_SUSPENDED` | 403 | Temporarily disabled |
| `RESOURCE_NOT_FOUND` | 404 | Resource doesn't exist |

**See `docs/ERROR_HANDLING.md` for all 42 codes.**

## 🏗 Core Files

- `src/types/errors.types.ts` - Error enums and metadata
- `src/utils/app-error.ts` - AppError class
- `src/middleware/errorHandler.ts` - Global error handler (updated)

## 🗺 File Map

```
MentorsMind-Backend/
├── docs/
│   ├── STRUCTURED_ERRORS_README.md     ← Overview
│   ├── ERROR_HANDLING.md               ← Complete reference ⭐
│   ├── ERROR_CODES_QUICK_REF.md        ← Quick lookup
│   ├── ERROR_MIGRATION.md              ← How to migrate
│   └── ERROR_IMPLEMENTATION_EXAMPLE.md ← Real examples
├── src/
│   ├── types/
│   │   ├── errors.types.ts             ← Error codes & types
│   │   └── api.types.ts                ← API response types
│   ├── utils/
│   │   └── app-error.ts                ← AppError class
│   └── middleware/
│       └── errorHandler.ts             ← Error handler (updated)
└── IMPLEMENTATION_SUMMARY.md           ← This summary
```

## 🎓 Learning Path

1. **Understand the problem** (5 min)
   - Read the "Problem Statement" section above
   - Think about your current error handling

2. **See the solution** (10 min)
   - Read `docs/STRUCTURED_ERRORS_README.md`
   - Look at example error responses

3. **Learn the error codes** (20 min)
   - Read `docs/ERROR_HANDLING.md`
   - Review error code categories
   - See client handling examples

4. **Implement your changes** (per service)
   - Follow `docs/ERROR_MIGRATION.md`
   - Update service methods
   - Test error codes in responses

5. **Update your client** (as needed)
   - Switch from string parsing to error codes
   - Implement specific error handling for each code
   - Test with different error scenarios

## ❓ Common Questions

**Q: Do I need to update all services immediately?**
A: No. Start with core services (Bookings, Payments, Auth) and gradually migrate others.

**Q: What if I'm currently using string-based error handling?**
A: Your code still works. New code should use error codes. Gradual migration is fine.

**Q: How do I test error codes?**
A: Check `response.body.code` in tests instead of parsing `response.body.message`.

**Q: Can I localize error messages?**
A: Yes! Keep `code` in English, localize `message` based on user language.

## 🚀 Getting Started Now

1. **Read:** `docs/STRUCTURED_ERRORS_README.md` (10 min)
2. **Bookmark:** `docs/ERROR_CODES_QUICK_REF.md` (you'll use this)
3. **Choose a service** to migrate (start with BookingsService)
4. **Follow:** `docs/ERROR_MIGRATION.md` (30 min per service)
5. **Test:** Verify error codes appear in responses
6. **Update clients** to use error codes

## 📞 Need Help?

- **How do I throw an error?** → See `docs/ERROR_CODES_QUICK_REF.md`
- **What's the error code for X?** → See `docs/ERROR_HANDLING.md`
- **How do I migrate this service?** → Follow `docs/ERROR_MIGRATION.md`
- **Show me code examples** → Study `docs/ERROR_IMPLEMENTATION_EXAMPLE.md`

## ✨ Benefits

✅ Mobile apps can distinguish between different error types
✅ No more string parsing (fragile!)
✅ Rich context for debugging
✅ Error messages can be localized
✅ Automatic retry logic support
✅ Type-safe error handling

---

## Next: Read `docs/STRUCTURED_ERRORS_README.md`

(It's the best entry point for understanding the full system.)

Happy error handling! 🎉
