# Push Notifications via Firebase Cloud Messaging

This document describes the web push notification implementation using Firebase Cloud Messaging (FCM).

## Overview

Users receive push notifications for important events even when the browser tab is closed:
- Session starting in 15 minutes
- Payment confirmed
- New message received

## Setup

### 1. Install Dependencies

```bash
npm install firebase-admin
```

### 2. Firebase Configuration

Get your Firebase service account credentials:
1. Go to Firebase Console > Project Settings > Service Accounts
2. Click "Generate New Private Key"
3. Add credentials to `.env`:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
```

### 3. Run Migration

```bash
npm run migrate:up
```

This creates the `push_tokens` table for storing FCM device tokens.

## API Endpoints

### Subscribe to Push Notifications

```http
POST /api/v1/notifications/push/subscribe
Authorization: Bearer <token>
Content-Type: application/json

{
  "token": "fcm-device-token-here",
  "deviceType": "web",
  "deviceId": "optional-device-id"
}
```

Response:
```json
{
  "status": "success",
  "data": {
    "message": "Successfully subscribed to push notifications",
    "tokenId": "uuid"
  }
}
```

### Unsubscribe from Push Notifications

```http
DELETE /api/v1/notifications/push/unsubscribe
Authorization: Bearer <token>
Content-Type: application/json

{
  "token": "fcm-device-token-here"
}
```

### Get Active Tokens

```http
GET /api/v1/notifications/push/tokens
Authorization: Bearer <token>
```

### Send Test Notification

```http
POST /api/v1/notifications/push/test
Authorization: Bearer <token>
```

## Usage in Code

### Send Session Reminder

```typescript
import { PushService } from './services/push.service';

await PushService.sendSessionReminder(userId, {
  mentorName: 'John Doe',
  scheduledAt: new Date('2026-03-27T10:00:00Z'),
  durationMinutes: 60,
  bookingId: 'booking-123',
});
```

### Send Payment Confirmation

```typescript
await PushService.sendPaymentConfirmed(userId, {
  amount: '100.50',
  transactionId: 'tx-123',
});
```

### Send New Message Notification

```typescript
await PushService.sendNewMessage(userId, {
  senderName: 'Jane Smith',
  messagePreview: 'Hey, are you available tomorrow?',
  conversationId: 'conv-123',
});
```

### Send Custom Notification

```typescript
await PushService.sendToUser(
  userId,
  'Custom Title',
  'Custom message body',
  { customKey: 'customValue' }
);
```

## Features

### Multi-Device Support
- Users can have multiple FCM tokens (web, mobile, tablet)
- Notifications are sent to all active devices
- Each device token is tracked independently

### Invalid Token Handling
- Automatically detects invalid/expired tokens
- Marks them as inactive in the database
- Removes them on 404 responses from FCM

### User Preferences
- Respects user notification preferences
- Checks `push_enabled` flag before sending
- Integrates with existing notification preference system

### Token Management
- Tokens are automatically updated on re-subscription
- `last_used_at` timestamp tracks token activity
- Cleanup job can remove old inactive tokens

## Database Schema

```sql
CREATE TABLE push_tokens (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    token TEXT NOT NULL,
    device_type VARCHAR(50),
    device_id VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, token)
);
```

## Testing

Run unit tests:
```bash
npm test -- --config=jest.unit.config.ts src/services/__tests__/push.service.unit.test.ts
npm test -- --config=jest.unit.config.ts src/controllers/__tests__/push.controller.unit.test.ts
```

## Security Considerations

- FCM tokens are stored securely in the database
- Only authenticated users can subscribe/unsubscribe
- Users can only manage their own tokens
- Firebase private key must be kept secure (never commit to git)

## Troubleshooting

### Firebase not initialized
- Check that all three Firebase env variables are set
- Verify the private key format (must include `\n` for newlines)
- Check logs for initialization errors

### Notifications not received
- Verify user has `push_enabled: true` in preferences
- Check that FCM token is active in database
- Test with `/api/v1/notifications/push/test` endpoint
- Verify Firebase project has Cloud Messaging enabled

### Invalid token errors
- These are automatically handled by marking tokens inactive
- Users need to re-subscribe to get a new token
- Old tokens are cleaned up periodically
