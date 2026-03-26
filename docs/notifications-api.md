# Notifications API Documentation

## Overview

The Notifications API provides a centralized notification service that creates, stores, and delivers in-app notifications triggered by platform events. Notifications are delivered via WebSocket in real-time and stored in the database for later retrieval.

## Features

- ✅ In-app notifications with real-time WebSocket delivery
- ✅ Paginated notification list (unread first)
- ✅ Mark single or all notifications as read
- ✅ Delete individual notifications
- ✅ Unread count endpoint
- ✅ Auto-delete notifications older than 90 days (daily cron job at 2:00 AM)
- ✅ WebSocket event emission on notification creation

## Database Schema

### Notifications Table

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Notification Types

- `session_booked` - New session booking created
- `session_confirmed` - Session confirmed by mentor
- `session_cancelled` - Session cancelled
- `session_reminder` - Upcoming session reminder
- `payment_received` - Payment successfully received
- `payment_failed` - Payment failed
- `review_received` - New review received
- `escrow_released` - Escrow funds released
- `dispute_opened` - New dispute opened
- `meeting_confirmed` - Meeting URL generated
- `message_received` - New message received
- `system_alert` - System notification

## API Endpoints

### 1. Get Notifications (Paginated)

**GET** `/api/v1/notifications`

Returns a paginated list of notifications for the authenticated user, with unread notifications appearing first.

**Query Parameters:**
- `page` (integer, default: 1) - Page number
- `limit` (integer, default: 20, max: 100) - Items per page

**Response:**
```json
{
  "status": "success",
  "data": {
    "notifications": [
      {
        "id": "uuid",
        "user_id": "uuid",
        "type": "session_booked",
        "title": "New Session Booked",
        "message": "You have a new session booking",
        "data": {
          "booking_id": "uuid",
          "mentor_name": "John Doe"
        },
        "is_read": false,
        "created_at": "2026-03-26T10:00:00Z",
        "updated_at": "2026-03-26T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "hasMore": true
    }
  }
}
```

### 2. Get Unread Count

**GET** `/api/v1/notifications/unread-count`

Returns the count of unread notifications for the authenticated user.

**Response:**
```json
{
  "status": "success",
  "data": {
    "count": 5
  }
}
```

### 3. Mark Notification as Read

**PUT** `/api/v1/notifications/:id/read`

Marks a single notification as read.

**Response:**
```json
{
  "status": "success",
  "data": {
    "message": "Notification marked as read"
  }
}
```

### 4. Mark All as Read

**PUT** `/api/v1/notifications/read-all`

Marks all notifications as read for the authenticated user.

**Response:**
```json
{
  "status": "success",
  "data": {
    "message": "5 notifications marked as read",
    "count": 5
  }
}
```

### 5. Delete Notification

**DELETE** `/api/v1/notifications/:id`

Deletes a specific notification.

**Response:**
```json
{
  "status": "success",
  "data": {
    "message": "Notification deleted successfully"
  }
}
```

## WebSocket Events

### notification:new

Emitted when a new notification is created for a user.

**Event Data:**
```json
{
  "notificationId": "uuid",
  "type": "session_booked",
  "title": "New Session Booked",
  "message": "You have a new session booking",
  "data": {
    "booking_id": "uuid"
  },
  "createdAt": "2026-03-26T10:00:00Z"
}
```

**Client Example:**
```javascript
socket.on('notification:new', (data) => {
  console.log('New notification:', data);
  // Update UI, show toast, increment badge count, etc.
});
```

## Service Usage

### Creating Notifications

The `NotificationService` provides a `create()` method for creating notifications:

```typescript
import { NotificationService } from '../services/notification.service';

// Create a notification
await NotificationService.create(userId, 'session_booked', {
  title: 'New Session Booked',
  message: 'You have a new session booking with John Doe',
  data: {
    booking_id: bookingId,
    mentor_name: 'John Doe',
    scheduled_at: scheduledAt
  }
});
```

### Example: Booking Confirmation Notification

```typescript
// In bookings.service.ts
import { NotificationService } from './notification.service';

async confirmBooking(bookingId: string, userId: string) {
  // ... booking confirmation logic ...

  // Notify mentor
  await NotificationService.create(booking.mentor_id, 'session_confirmed', {
    title: 'Session Confirmed',
    message: `Your session with ${menteeName} has been confirmed`,
    data: {
      booking_id: bookingId,
      scheduled_at: booking.scheduled_at
    }
  });

  // Notify mentee
  await NotificationService.create(booking.mentee_id, 'session_confirmed', {
    title: 'Session Confirmed',
    message: `Your session with ${mentorName} has been confirmed`,
    data: {
      booking_id: bookingId,
      scheduled_at: booking.scheduled_at
    }
  });
}
```

## Auto-Cleanup

The notification cleanup service runs daily at 2:00 AM and automatically deletes:
- Notifications older than 90 days
- Expired notifications (if `expires_at` is set)

**Manual Cleanup:**
```typescript
import { notificationCleanupService } from '../services/notification-cleanup.service';

// Trigger manual cleanup
const result = await notificationCleanupService.triggerCleanup();
console.log(`Deleted ${result.deleted} old notifications, ${result.expired} expired`);
```

## Migration

Run the migration to create the notifications table:

```bash
# Unix/Linux/Mac
./database/migrate.sh

# Windows
database\migrate.bat
```

The migration file is located at: `database/migrations/014_create_notifications.sql`

## Testing

### Test Notification Creation

```bash
curl -X POST http://localhost:3000/api/v1/notifications/test \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### Test WebSocket Connection

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: 'YOUR_JWT_TOKEN' }
});

socket.on('connect', () => {
  console.log('Connected to WebSocket');
});

socket.on('notification:new', (data) => {
  console.log('New notification:', data);
});
```

## Best Practices

1. **Always include relevant data**: Add booking IDs, user names, dates, etc. in the `data` field
2. **Keep messages concise**: Notification messages should be brief and actionable
3. **Use appropriate types**: Choose the correct notification type for better filtering
4. **Handle WebSocket failures gracefully**: Notifications are stored in DB even if WebSocket fails
5. **Don't spam users**: Consolidate related notifications when possible

## Error Handling

All notification operations are wrapped in try-catch blocks. If notification creation fails:
- The error is logged
- The main operation continues (notifications are non-critical)
- WebSocket emission failures don't affect database storage

## Performance Considerations

- Notifications are indexed by `user_id`, `is_read`, and `created_at`
- Pagination prevents loading too many notifications at once
- WebSocket events are emitted asynchronously
- Cleanup runs during low-traffic hours (2:00 AM)

## Future Enhancements

- [ ] Push notifications (mobile)
- [ ] Email notifications
- [ ] SMS notifications
- [ ] Notification preferences per user
- [ ] Notification grouping/threading
- [ ] Rich notification templates
- [ ] Notification scheduling
