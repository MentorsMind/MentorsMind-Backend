# Push Notifications Quick Reference

## Setup Checklist

- [x] Install `firebase-admin` SDK
- [x] Add Firebase credentials to `.env`
- [x] Run migration `016_create_push_tokens.sql`
- [x] Create `PushService` with `sendToUser()` method
- [x] Create `PushController` with subscribe/unsubscribe endpoints
- [x] Add routes: POST `/push/subscribe`, DELETE `/push/unsubscribe`
- [x] Handle invalid/expired tokens (mark inactive on 404)
- [x] Support multiple devices per user
- [x] Respect user notification preferences
- [x] Unit tests: send success, invalid token cleanup, preference check

## Quick Start

### 1. Configure Firebase

Add to `.env`:
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
```

### 2. Subscribe Client

```javascript
// Client-side: Get FCM token and subscribe
const token = await getFirebaseToken();
await fetch('/api/v1/notifications/push/subscribe', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ token, deviceType: 'web' })
});
```

### 3. Send Notifications

```typescript
// Session reminder (15 min before)
await PushService.sendSessionReminder(userId, {
  mentorName: 'John Doe',
  scheduledAt: sessionDate,
  durationMinutes: 60,
  bookingId: 'booking-123'
});

// Payment confirmed
await PushService.sendPaymentConfirmed(userId, {
  amount: '100.50',
  transactionId: 'tx-123'
});

// New message
await PushService.sendNewMessage(userId, {
  senderName: 'Jane Smith',
  messagePreview: 'Hey, are you available?',
  conversationId: 'conv-123'
});
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/notifications/push/subscribe` | Save FCM token |
| DELETE | `/api/v1/notifications/push/unsubscribe` | Remove FCM token |
| GET | `/api/v1/notifications/push/tokens` | List active tokens |
| POST | `/api/v1/notifications/push/test` | Send test notification |

## Features

✅ Multi-device support (web, Android, iOS)
✅ Automatic invalid token cleanup
✅ User preference checking
✅ Multiple devices per user
✅ Last used timestamp tracking
✅ Comprehensive error handling

## Testing

```bash
# Run unit tests
npm test -- --config=jest.unit.config.ts src/services/__tests__/push.service.unit.test.ts
npm test -- --config=jest.unit.config.ts src/controllers/__tests__/push.controller.unit.test.ts
```

## Files Created

- `src/services/push.service.ts` - FCM integration service
- `src/controllers/push.controller.ts` - API endpoints
- `src/models/push-tokens.model.ts` - Database model
- `database/migrations/016_create_push_tokens.sql` - Schema
- `docs/push-notifications.md` - Full documentation
- Unit tests for service, controller, and model

## Integration Points

The push notification system integrates with:
- Notification preferences (respects `push_enabled` flag)
- Multi-channel notification system (via `NotificationChannel.PUSH`)
- Existing notification service (auto-sends on PUSH channel)
