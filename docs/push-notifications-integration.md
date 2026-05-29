# Push Notifications Integration Examples

## Booking Flow Integration

### Session Reminder (15 minutes before)

Add to your booking scheduler or cron job:

```typescript
import { PushService } from '../services/push.service';
import { BookingsModel } from '../models/bookings.model';

// Run every minute to check for upcoming sessions
async function sendSessionReminders() {
  const now = new Date();
  const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
  
  // Get sessions starting in 15 minutes
  const upcomingSessions = await BookingsModel.getSessionsStartingBetween(
    now,
    fifteenMinutesFromNow
  );
  
  for (const session of upcomingSessions) {
    // Send to mentee
    await PushService.sendSessionReminder(session.mentee_id, {
      mentorName: session.mentor_name,
      scheduledAt: session.scheduled_at,
      durationMinutes: session.duration_minutes,
      bookingId: session.id,
    });
    
    // Send to mentor
    await PushService.sendSessionReminder(session.mentor_id, {
      mentorName: session.mentee_name, // From mentor's perspective
      scheduledAt: session.scheduled_at,
      durationMinutes: session.duration_minutes,
      bookingId: session.id,
    });
  }
}
```

## Payment Flow Integration

### Payment Confirmation

Add to your payment processing service:

```typescript
import { PushService } from '../services/push.service';

async function processPayment(userId: string, amount: string, bookingId: string) {
  // Process payment via Stellar
  const transaction = await stellarService.processPayment(/* ... */);
  
  if (transaction.success) {
    // Send push notification
    await PushService.sendPaymentConfirmed(userId, {
      amount: amount,
      transactionId: transaction.id,
    });
  }
}
```

## Messaging Integration

### New Message Notification

Add to your messaging/chat service:

```typescript
import { PushService } from '../services/push.service';

async function sendMessage(
  senderId: string,
  recipientId: string,
  message: string,
  conversationId: string
) {
  // Save message to database
  await MessagesModel.create({
    sender_id: senderId,
    recipient_id: recipientId,
    content: message,
    conversation_id: conversationId,
  });
  
  // Get sender info
  const sender = await UsersModel.getById(senderId);
  
  // Send push notification to recipient
  await PushService.sendNewMessage(recipientId, {
    senderName: sender.name,
    messagePreview: message.substring(0, 100), // First 100 chars
    conversationId: conversationId,
  });
}
```

## Multi-Channel Notification

### Using NotificationService with Push Channel

```typescript
import { NotificationService } from '../services/notification.service';
import { NotificationType, NotificationChannel, NotificationPriority } from '../models/notifications.model';

// Send notification via multiple channels including push
await NotificationService.sendNotification({
  userId: 'user-123',
  type: NotificationType.SESSION_REMINDER,
  channels: [
    NotificationChannel.EMAIL,
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH, // Will automatically trigger PushService
  ],
  priority: NotificationPriority.HIGH,
  title: 'Session Starting Soon',
  message: 'Your session with John Doe starts in 15 minutes',
  data: {
    bookingId: 'booking-123',
    scheduledAt: new Date().toISOString(),
  },
});
```

## Client-Side Implementation

### Web App (React/Vue/Angular)

```javascript
// 1. Initialize Firebase in your web app
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: "your-api-key",
  projectId: "your-project-id",
  messagingSenderId: "your-sender-id",
  appId: "your-app-id"
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

// 2. Request permission and get token
async function subscribeToPushNotifications() {
  try {
    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      const token = await getToken(messaging, {
        vapidKey: 'your-vapid-key'
      });
      
      // Send token to backend
      await fetch('/api/v1/notifications/push/subscribe', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: token,
          deviceType: 'web',
          deviceId: navigator.userAgent // or generate unique ID
        })
      });
      
      console.log('Subscribed to push notifications');
    }
  } catch (error) {
    console.error('Failed to subscribe:', error);
  }
}

// 3. Handle incoming messages
onMessage(messaging, (payload) => {
  console.log('Message received:', payload);
  
  // Show notification
  new Notification(payload.notification.title, {
    body: payload.notification.body,
    icon: '/icon.png',
    data: payload.data
  });
});

// 4. Unsubscribe when user logs out
async function unsubscribeFromPushNotifications(token) {
  await fetch('/api/v1/notifications/push/unsubscribe', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ token })
  });
}
```

### Service Worker (firebase-messaging-sw.js)

```javascript
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "your-api-key",
  projectId: "your-project-id",
  messagingSenderId: "your-sender-id",
  appId: "your-app-id"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('Background message received:', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon.png',
    data: payload.data
  };
  
  return self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});
```

## Scheduled Jobs

### Session Reminder Cron Job

```typescript
import { CronJob } from 'cron';
import { PushService } from './services/push.service';
import { BookingsModel } from './models/bookings.model';

// Run every minute
const sessionReminderJob = new CronJob('* * * * *', async () => {
  const now = new Date();
  const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
  
  const upcomingSessions = await BookingsModel.getSessionsStartingBetween(
    now,
    fifteenMinutesFromNow
  );
  
  for (const session of upcomingSessions) {
    // Check if reminder already sent (add flag to bookings table)
    if (!session.reminder_sent) {
      await PushService.sendSessionReminder(session.mentee_id, {
        mentorName: session.mentor_name,
        scheduledAt: session.scheduled_at,
        durationMinutes: session.duration_minutes,
        bookingId: session.id,
      });
      
      // Mark reminder as sent
      await BookingsModel.markReminderSent(session.id);
    }
  }
});

sessionReminderJob.start();
```

### Token Cleanup Job

```typescript
import { CronJob } from 'cron';
import { PushTokensModel } from './models/push-tokens.model';

// Run daily at 2 AM
const tokenCleanupJob = new CronJob('0 2 * * *', async () => {
  const deletedCount = await PushTokensModel.cleanupInactiveTokens(30);
  console.log(`Cleaned up ${deletedCount} inactive push tokens`);
});

tokenCleanupJob.start();
```

## Error Handling

The push service handles various error scenarios:

1. **Firebase not initialized** - Logs warning, notifications disabled
2. **User disabled push** - Skips sending, returns error
3. **No active tokens** - Returns error with message
4. **Invalid tokens** - Automatically marks inactive
5. **Network errors** - Logs error, returns failure result

All errors are logged and returned in the result object for proper handling.
