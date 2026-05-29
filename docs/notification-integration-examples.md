# Notification Integration Examples

This document provides practical examples of integrating the notification system into existing services.

## Table of Contents

1. [Booking Events](#booking-events)
2. [Payment Events](#payment-events)
3. [Review Events](#review-events)
4. [Dispute Events](#dispute-events)
5. [Meeting Events](#meeting-events)
6. [System Events](#system-events)

## Booking Events

### Session Booked

```typescript
// In bookings.service.ts
import { NotificationService } from './notification.service';

async createBooking(data: CreateBookingData): Promise<BookingRecord> {
  // ... create booking logic ...
  
  const booking = await BookingModel.create({...});
  
  // Notify mentor about new booking
  await NotificationService.create(booking.mentor_id, 'session_booked', {
    title: 'New Session Booking',
    message: `You have a new session booking from ${menteeName}`,
    data: {
      booking_id: booking.id,
      mentee_name: menteeName,
      scheduled_at: booking.scheduled_at,
      topic: booking.topic,
      duration_minutes: booking.duration_minutes
    }
  });
  
  return booking;
}
```

### Session Confirmed

```typescript
async confirmBooking(bookingId: string, userId: string): Promise<BookingRecord> {
  // ... confirmation logic ...
  
  const booking = await BookingModel.update(bookingId, { status: 'confirmed' });
  
  // Get user details
  const [mentor, mentee] = await Promise.all([
    UsersService.findById(booking.mentor_id),
    UsersService.findById(booking.mentee_id)
  ]);
  
  // Notify both parties
  await Promise.all([
    NotificationService.create(booking.mentor_id, 'session_confirmed', {
      title: 'Session Confirmed',
      message: `Your session with ${mentee.first_name} ${mentee.last_name} has been confirmed`,
      data: {
        booking_id: bookingId,
        mentee_name: `${mentee.first_name} ${mentee.last_name}`,
        scheduled_at: booking.scheduled_at
      }
    }),
    NotificationService.create(booking.mentee_id, 'session_confirmed', {
      title: 'Session Confirmed',
      message: `Your session with ${mentor.first_name} ${mentor.last_name} has been confirmed`,
      data: {
        booking_id: bookingId,
        mentor_name: `${mentor.first_name} ${mentor.last_name}`,
        scheduled_at: booking.scheduled_at
      }
    })
  ]);
  
  return booking;
}
```

### Session Cancelled

```typescript
async cancelBooking(bookingId: string, userId: string, reason?: string): Promise<BookingRecord> {
  // ... cancellation logic ...
  
  const booking = await BookingModel.update(bookingId, { 
    status: 'cancelled',
    cancellation_reason: reason 
  });
  
  // Determine who cancelled and who to notify
  const cancelledBy = userId === booking.mentor_id ? 'mentor' : 'mentee';
  const notifyUserId = userId === booking.mentor_id ? booking.mentee_id : booking.mentor_id;
  
  // Notify the other party
  await NotificationService.create(notifyUserId, 'session_cancelled', {
    title: 'Session Cancelled',
    message: `Your session has been cancelled by the ${cancelledBy}${reason ? `: ${reason}` : ''}`,
    data: {
      booking_id: bookingId,
      cancelled_by: cancelledBy,
      cancellation_reason: reason,
      scheduled_at: booking.scheduled_at
    }
  });
  
  return booking;
}
```

### Session Reminder

```typescript
// In reminder.service.ts
async send24hReminder(session: SessionRecord): Promise<void> {
  const mentorTime = formatInTimezone(session.scheduled_at_utc, session.mentor_timezone);
  const menteeTime = formatInTimezone(session.scheduled_at_utc, session.mentee_timezone);
  
  // Send in-app notifications
  await Promise.all([
    NotificationService.create(session.mentor_id, 'session_reminder', {
      title: 'Session Tomorrow',
      message: `Your session "${session.topic}" is scheduled for ${mentorTime}`,
      data: {
        session_id: session.id,
        scheduled_at: session.scheduled_at_utc,
        duration_minutes: session.duration_minutes,
        reminder_type: '24h'
      }
    }),
    NotificationService.create(session.mentee_id, 'session_reminder', {
      title: 'Session Tomorrow',
      message: `Your mentoring session is scheduled for ${menteeTime}`,
      data: {
        session_id: session.id,
        scheduled_at: session.scheduled_at_utc,
        duration_minutes: session.duration_minutes,
        reminder_type: '24h'
      }
    })
  ]);
}
```

## Payment Events

### Payment Received

```typescript
// In payments.service.ts
async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
  // ... payment processing logic ...
  
  const payment = await PaymentModel.create({...});
  
  // Notify recipient
  await NotificationService.create(payment.recipient_id, 'payment_received', {
    title: 'Payment Received',
    message: `You received a payment of ${payment.amount} ${payment.currency}`,
    data: {
      payment_id: payment.id,
      transaction_id: payment.transaction_id,
      amount: payment.amount,
      currency: payment.currency,
      sender_id: payment.sender_id,
      stellar_tx_hash: payment.stellar_tx_hash
    }
  });
  
  return payment;
}
```

### Payment Failed

```typescript
async handlePaymentFailure(paymentId: string, error: string): Promise<void> {
  const payment = await PaymentModel.findById(paymentId);
  
  // Notify sender about failure
  await NotificationService.create(payment.sender_id, 'payment_failed', {
    title: 'Payment Failed',
    message: `Your payment of ${payment.amount} ${payment.currency} failed: ${error}`,
    data: {
      payment_id: paymentId,
      amount: payment.amount,
      currency: payment.currency,
      error_message: error,
      recipient_id: payment.recipient_id
    }
  });
}
```

### Escrow Released

```typescript
// In escrow.service.ts
async releaseEscrow(escrowId: string): Promise<void> {
  // ... escrow release logic ...
  
  const escrow = await EscrowModel.findById(escrowId);
  
  // Notify both parties
  await Promise.all([
    NotificationService.create(escrow.payer_id, 'escrow_released', {
      title: 'Escrow Released',
      message: `Escrow funds of ${escrow.amount} ${escrow.currency} have been released`,
      data: {
        escrow_id: escrowId,
        amount: escrow.amount,
        currency: escrow.currency,
        recipient_id: escrow.recipient_id,
        booking_id: escrow.booking_id
      }
    }),
    NotificationService.create(escrow.recipient_id, 'escrow_released', {
      title: 'Payment Received',
      message: `You received ${escrow.amount} ${escrow.currency} from escrow`,
      data: {
        escrow_id: escrowId,
        amount: escrow.amount,
        currency: escrow.currency,
        payer_id: escrow.payer_id,
        booking_id: escrow.booking_id
      }
    })
  ]);
}
```

## Review Events

### Review Received

```typescript
// In reviews.service.ts
async createReview(reviewData: CreateReviewData): Promise<ReviewRecord> {
  // ... create review logic ...
  
  const review = await ReviewModel.create({...});
  
  // Get reviewer name
  const reviewer = await UsersService.findById(review.reviewer_id);
  
  // Notify the reviewed user
  await NotificationService.create(review.reviewee_id, 'review_received', {
    title: 'New Review Received',
    message: `${reviewer.first_name} ${reviewer.last_name} left you a ${review.rating}-star review`,
    data: {
      review_id: review.id,
      reviewer_id: review.reviewer_id,
      reviewer_name: `${reviewer.first_name} ${reviewer.last_name}`,
      rating: review.rating,
      booking_id: review.booking_id
    }
  });
  
  return review;
}
```

## Dispute Events

### Dispute Opened

```typescript
// In disputes.service.ts
async createDispute(disputeData: CreateDisputeData): Promise<DisputeRecord> {
  // ... create dispute logic ...
  
  const dispute = await DisputeModel.create({...});
  
  // Determine who to notify (the other party)
  const notifyUserId = disputeData.initiated_by === dispute.mentor_id 
    ? dispute.mentee_id 
    : dispute.mentor_id;
  
  // Notify the other party
  await NotificationService.create(notifyUserId, 'dispute_opened', {
    title: 'Dispute Opened',
    message: `A dispute has been opened regarding your session`,
    data: {
      dispute_id: dispute.id,
      booking_id: dispute.booking_id,
      initiated_by: disputeData.initiated_by,
      reason: dispute.reason
    }
  });
  
  return dispute;
}
```

### Dispute Resolved

```typescript
async resolveDispute(disputeId: string, resolution: string): Promise<void> {
  const dispute = await DisputeModel.findById(disputeId);
  
  // Notify both parties
  await Promise.all([
    NotificationService.create(dispute.mentor_id, 'system_alert', {
      title: 'Dispute Resolved',
      message: `The dispute has been resolved: ${resolution}`,
      data: {
        dispute_id: disputeId,
        booking_id: dispute.booking_id,
        resolution: resolution
      }
    }),
    NotificationService.create(dispute.mentee_id, 'system_alert', {
      title: 'Dispute Resolved',
      message: `The dispute has been resolved: ${resolution}`,
      data: {
        dispute_id: disputeId,
        booking_id: dispute.booking_id,
        resolution: resolution
      }
    })
  ]);
}
```

## Meeting Events

### Meeting URL Generated

```typescript
// In meeting.service.ts or bookings.controller.ts
async confirmBookingWithMeeting(bookingId: string): Promise<void> {
  // ... generate meeting URL ...
  
  const meetingResult = await MeetingService.createMeetingRoom({...});
  const booking = await BookingModel.updateMeetingUrl(bookingId, meetingResult);
  
  // Get participant details
  const [mentor, mentee] = await Promise.all([
    UsersService.findById(booking.mentor_id),
    UsersService.findById(booking.mentee_id)
  ]);
  
  // Notify both parties with meeting link
  await Promise.all([
    NotificationService.create(booking.mentor_id, 'meeting_confirmed', {
      title: 'Meeting Link Ready',
      message: `Your meeting link is ready for the session with ${mentee.first_name}`,
      data: {
        booking_id: bookingId,
        meeting_url: meetingResult.meetingUrl,
        meeting_provider: meetingResult.provider,
        scheduled_at: booking.scheduled_at,
        expires_at: meetingResult.expiresAt
      }
    }),
    NotificationService.create(booking.mentee_id, 'meeting_confirmed', {
      title: 'Meeting Link Ready',
      message: `Your meeting link is ready for the session with ${mentor.first_name}`,
      data: {
        booking_id: bookingId,
        meeting_url: meetingResult.meetingUrl,
        meeting_provider: meetingResult.provider,
        scheduled_at: booking.scheduled_at,
        expires_at: meetingResult.expiresAt
      }
    })
  ]);
}
```

## System Events

### Maintenance Notification

```typescript
// In admin.service.ts
async scheduleMaintenanceNotification(
  scheduledAt: Date,
  duration: number,
  reason: string
): Promise<void> {
  // Get all active users
  const users = await UsersService.getAllActiveUsers();
  
  // Notify all users
  const notifications = users.map(user =>
    NotificationService.create(user.id, 'system_alert', {
      title: 'Scheduled Maintenance',
      message: `System maintenance scheduled for ${scheduledAt.toLocaleString()}. Duration: ${duration} minutes.`,
      data: {
        scheduled_at: scheduledAt,
        duration_minutes: duration,
        reason: reason,
        type: 'maintenance'
      }
    })
  );
  
  await Promise.all(notifications);
}
```

### Feature Announcement

```typescript
async announceNewFeature(
  featureName: string,
  description: string,
  learnMoreUrl?: string
): Promise<void> {
  const users = await UsersService.getAllActiveUsers();
  
  const notifications = users.map(user =>
    NotificationService.create(user.id, 'system_alert', {
      title: `New Feature: ${featureName}`,
      message: description,
      data: {
        feature_name: featureName,
        learn_more_url: learnMoreUrl,
        type: 'feature_announcement'
      }
    })
  );
  
  await Promise.all(notifications);
}
```

## Best Practices

### 1. Error Handling

Always wrap notification creation in try-catch to prevent blocking main operations:

```typescript
try {
  await NotificationService.create(userId, 'session_booked', {...});
} catch (error) {
  logger.error('Failed to create notification', { error, userId });
  // Continue with main operation
}
```

### 2. Batch Notifications

For multiple notifications, use `Promise.all`:

```typescript
await Promise.all([
  NotificationService.create(user1Id, 'session_confirmed', {...}),
  NotificationService.create(user2Id, 'session_confirmed', {...})
]);
```

### 3. Rich Data

Include relevant IDs and data for client-side navigation:

```typescript
await NotificationService.create(userId, 'payment_received', {
  title: 'Payment Received',
  message: `You received ${amount} XLM`,
  data: {
    payment_id: paymentId,
    transaction_id: txId,
    amount: amount,
    currency: 'XLM',
    // Include data needed for navigation
    booking_id: bookingId,
    sender_id: senderId
  }
});
```

### 4. User-Friendly Messages

Keep messages concise and actionable:

```typescript
// Good
message: 'Your session with John Doe starts in 1 hour'

// Bad
message: 'Session ID abc-123 scheduled_at 2026-03-26T14:00:00Z status confirmed'
```

### 5. Notification Timing

Consider when to send notifications:

```typescript
// Immediate notifications
await NotificationService.create(userId, 'payment_received', {...});

// Scheduled notifications (future feature)
await NotificationService.scheduleNotification({
  userId,
  type: 'session_reminder',
  scheduledAt: sessionTime.minus({ hours: 1 }),
  ...
});
```

## Testing Integration

### Unit Test Example

```typescript
import { NotificationService } from '../services/notification.service';

jest.mock('../services/notification.service');

describe('BookingsService', () => {
  it('should create notification when booking is confirmed', async () => {
    const booking = await BookingsService.confirmBooking(bookingId, userId);
    
    expect(NotificationService.create).toHaveBeenCalledWith(
      booking.mentor_id,
      'session_confirmed',
      expect.objectContaining({
        title: 'Session Confirmed',
        data: expect.objectContaining({
          booking_id: bookingId
        })
      })
    );
  });
});
```

### Integration Test Example

```typescript
describe('Notification Integration', () => {
  it('should emit WebSocket event when notification is created', async (done) => {
    const socket = io('http://localhost:3000', {
      auth: { token: testToken }
    });
    
    socket.on('notification:new', (data) => {
      expect(data.type).toBe('session_booked');
      expect(data.title).toBe('New Session Booking');
      done();
    });
    
    // Trigger notification creation
    await BookingsService.createBooking({...});
  });
});
```

## Monitoring

### Log Notification Failures

```typescript
try {
  await NotificationService.create(userId, type, payload);
} catch (error) {
  logger.error('Notification creation failed', {
    userId,
    type,
    error: error.message,
    stack: error.stack
  });
}
```

### Track Notification Metrics

```typescript
// In a monitoring service
async trackNotificationMetrics() {
  const counts = await pool.query(`
    SELECT 
      type,
      COUNT(*) as total,
      COUNT(CASE WHEN is_read THEN 1 END) as read,
      COUNT(CASE WHEN NOT is_read THEN 1 END) as unread
    FROM notifications
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY type
  `);
  
  return counts.rows;
}
```

## Summary

The notification system is designed to be:
- **Non-blocking**: Failures don't affect main operations
- **Real-time**: WebSocket delivery for instant updates
- **Flexible**: Rich data field for custom payloads
- **Scalable**: Indexed queries and pagination
- **Maintainable**: Auto-cleanup of old notifications

Integrate notifications at key points in your application flow to keep users informed and engaged.
