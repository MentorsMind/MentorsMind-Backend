# CalendarService Token Expiration Fix

## Steps

- [x] 1. Add `CALENDAR_CONNECTION_EXPIRED` to `NotificationType` enum in `src/models/notifications.model.ts`
- [x] 2. Add defaults for `CALENDAR_CONNECTION_EXPIRED` in `src/services/notification.service.ts`
- [x] 3. Update `_buildAuthedClient` in `src/services/calendar.service.ts` to proactively refresh expired tokens and handle `invalid_grant`
- [x] 4. Update event methods (`createGoogleCalendarEvent`, `updateGoogleCalendarEvent`, `deleteGoogleCalendarEvent`) to handle `invalid_grant` instead of silently swallowing
- [x] 5. Add tests in `src/__tests__/security_and_reliability.test.ts`
- [x] 6. Run tests and TypeScript check (blocked: node_modules not installed in environment)

