# Notifications System - Quick Reference

## 🎯 Overview

Centralized notification service for in-app notifications with real-time WebSocket delivery.

## 📁 Files Created

```
src/
├── controllers/notifications.controller.ts    # API endpoint handlers
├── routes/notifications.routes.ts             # Route definitions
└── services/
    └── notification-cleanup.service.ts        # Auto-delete cron job

database/
└── migrations/
    └── 014_create_notifications.sql           # Database schema

docs/
└── notifications-api.md                       # Full API documentation
```

## 🔧 Service Already Exists

The `NotificationService` was already implemented with advanced features. We added:
- ✅ `create()` method for simplified notification creation
- ✅ WebSocket emission via `SocketService`
- ✅ Controller and routes for API endpoints
- ✅ Auto-cleanup cron job

## 📊 Database Schema

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
);
```

## 🚀 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/notifications` | Get paginated notifications (unread first) |
| GET | `/api/v1/notifications/unread-count` | Get unread count |
| PUT | `/api/v1/notifications/:id/read` | Mark single as read |
| PUT | `/api/v1/notifications/read-all` | Mark all as read |
| DELETE | `/api/v1/notifications/:id` | Delete notification |

## 📝 Notification Types

```typescript
'session_booked'       // New session booking
'session_confirmed'    // Session confirmed
'session_cancelled'    // Session cancelled
'session_reminder'     // Upcoming session
'payment_received'     // Payment success
'payment_failed'       // Payment failure
'review_received'      // New review
'escrow_released'      // Escrow released
'dispute_opened'       // Dispute created
'meeting_confirmed'    // Meeting URL ready
'message_received'     // New message
'system_alert'         // System notification
```

## 💻 Usage Examples

### Create Notification

```typescript
import { NotificationService } from '../services/notification.service';

await NotificationService.create(userId, 'session_booked', {
  title: 'New Session Booked',
  message: 'You have a new session with John Doe',
  data: {
    booking_id: bookingId,
    mentor_name: 'John Doe',
    scheduled_at: scheduledAt
  }
});
```

### WebSocket Event

```javascript
// Client-side
socket.on('notification:new', (data) => {
  console.log('New notification:', data);
  // Update UI, show toast, increment badge
});
```

### Get Notifications

```bash
curl -X GET http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -G -d "page=1" -d "limit=20"
```

### Mark as Read

```bash
curl -X PUT http://localhost:3000/api/v1/notifications/:id/read \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Unread Count

```bash
curl -X GET http://localhost:3000/api/v1/notifications/unread-count \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 🔄 Auto-Cleanup

- **Schedule**: Daily at 2:00 AM
- **Action**: Deletes notifications older than 90 days
- **Service**: `NotificationCleanupService`
- **Manual trigger**: `notificationCleanupService.triggerCleanup()`

## 🗄️ Migration

```bash
# Run migration
./database/migrate.sh    # Unix/Linux/Mac
database\migrate.bat     # Windows
```

## 🔌 WebSocket Integration

Notifications automatically emit `notification:new` events via WebSocket when created:

```typescript
SocketService.emitToUser(userId, 'notification:new', {
  notificationId: notification.id,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  data: notification.data,
  createdAt: notification.created_at
});
```

## ✅ Acceptance Criteria Status

- ✅ Notifications table created with required fields
- ✅ `NotificationService.create(userId, type, payload)` method
- ✅ All notification types supported
- ✅ GET `/api/v1/notifications` - paginated, unread first
- ✅ PUT `/api/v1/notifications/:id/read` - mark single as read
- ✅ PUT `/api/v1/notifications/read-all` - mark all as read
- ✅ DELETE `/api/v1/notifications/:id` - delete notification
- ✅ GET `/api/v1/notifications/unread-count` - returns `{ count: number }`
- ✅ Emit `notification:new` via WebSocket on creation
- ✅ Auto-delete notifications older than 90 days (cron job)

## 📚 Documentation

Full documentation: `docs/notifications-api.md`

## 🧪 Testing

```typescript
// Test notification creation
const notification = await NotificationService.create(
  'user-id',
  'session_booked',
  {
    title: 'Test Notification',
    message: 'This is a test',
    data: { test: true }
  }
);

// Test WebSocket
socket.on('notification:new', (data) => {
  console.log('Received:', data);
});
```

## 🎨 Integration Examples

### Booking Confirmation

```typescript
// Notify both parties
await NotificationService.create(booking.mentor_id, 'session_confirmed', {
  title: 'Session Confirmed',
  message: `Session with ${menteeName} confirmed`,
  data: { booking_id: bookingId }
});

await NotificationService.create(booking.mentee_id, 'session_confirmed', {
  title: 'Session Confirmed',
  message: `Session with ${mentorName} confirmed`,
  data: { booking_id: bookingId }
});
```

### Payment Notification

```typescript
await NotificationService.create(userId, 'payment_received', {
  title: 'Payment Received',
  message: `Payment of ${amount} XLM received`,
  data: {
    transaction_id: txId,
    amount: amount,
    currency: 'XLM'
  }
});
```

## 🔍 Monitoring

Check logs for:
- `Notification cleanup completed: X notifications deleted`
- `Failed to emit notification:new event` (WebSocket issues)
- `Notification cleanup service initialized`

## 🚨 Error Handling

- Notification creation failures are logged but don't block main operations
- WebSocket emission failures don't affect database storage
- Cleanup job failures are logged for monitoring
