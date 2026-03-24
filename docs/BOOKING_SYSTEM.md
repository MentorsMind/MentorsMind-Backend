# Booking System - Complete Implementation Guide

## Overview

The MentorsMind Booking System provides a complete solution for managing mentoring session bookings with integrated Stellar blockchain payment processing, conflict detection, and comprehensive business rules.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Booking System                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │   Routes     │───▶│ Controllers  │───▶│  Services    │ │
│  │ (REST API)   │    │  (Handlers)  │    │ (Business)   │ │
│  └──────────────┘    └──────────────┘    └──────┬───────┘ │
│                                                   │          │
│  ┌──────────────┐    ┌──────────────┐           │          │
│  │ Validators   │    │   Models     │◀──────────┘          │
│  │   (Zod)      │    │ (Database)   │                      │
│  └──────────────┘    └──────────────┘                      │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐                      │
│  │   Utils      │    │  Middleware  │                      │
│  │ (Conflicts)  │    │   (Auth)     │                      │
│  └──────────────┘    └──────────────┘                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── routes/
│   └── bookings.routes.ts          # API endpoints
├── controllers/
│   └── bookings.controller.ts      # Request handlers
├── services/
│   ├── bookings.service.ts         # Business logic
│   └── __tests__/
│       └── bookings.service.test.ts
├── models/
│   └── booking.model.ts            # Database operations
├── validators/
│   └── schemas/
│       └── bookings.schemas.ts     # Input validation
├── utils/
│   ├── booking-conflicts.utils.ts  # Conflict detection
│   └── __tests__/
│       └── booking-conflicts.utils.test.ts
└── docs/
    ├── booking-api.md              # API documentation
    ├── booking-flow.md             # Flow diagrams
    ├── booking-policies.md         # Business policies
    └── BOOKING_SYSTEM.md           # This file
```

## Database Schema

### Bookings Table

```sql
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentee_id UUID NOT NULL REFERENCES users(id),
  mentor_id UUID NOT NULL REFERENCES users(id),
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL,
  topic VARCHAR(500) NOT NULL,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  amount DECIMAL(20, 7) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'XLM',
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  stellar_tx_hash VARCHAR(64),
  transaction_id UUID REFERENCES transactions(id),
  cancellation_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT check_status CHECK (
    status IN ('pending', 'confirmed', 'completed', 'cancelled', 'rescheduled')
  ),
  CONSTRAINT check_payment_status CHECK (
    payment_status IN ('pending', 'paid', 'refunded', 'failed')
  ),
  CONSTRAINT check_duration CHECK (
    duration_minutes >= 15 AND duration_minutes <= 240
  )
);

-- Indexes for performance
CREATE INDEX idx_bookings_mentee_id ON bookings(mentee_id);
CREATE INDEX idx_bookings_mentor_id ON bookings(mentor_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_scheduled_at ON bookings(scheduled_at);
CREATE INDEX idx_bookings_payment_status ON bookings(payment_status);
```

## API Endpoints

### Summary

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/v1/bookings` | Create booking | Required |
| GET | `/api/v1/bookings` | List bookings | Required |
| GET | `/api/v1/bookings/:id` | Get booking | Required |
| PUT | `/api/v1/bookings/:id` | Update booking | Required |
| DELETE | `/api/v1/bookings/:id` | Cancel booking | Required |
| POST | `/api/v1/bookings/:id/confirm` | Confirm booking | Mentor only |
| POST | `/api/v1/bookings/:id/complete` | Complete booking | Required |
| POST | `/api/v1/bookings/:id/reschedule` | Reschedule booking | Required |
| GET | `/api/v1/bookings/:id/payment-status` | Payment status | Required |

See [booking-api.md](./booking-api.md) for detailed endpoint documentation.

## Features

### 1. Conflict Detection

Automatically prevents double-booking by checking for overlapping time slots:

```typescript
// Check if mentor is available
const hasConflict = await BookingModel.checkConflict(
  mentorId,
  scheduledAt,
  durationMinutes
);

if (hasConflict) {
  throw createError('Mentor is not available', 409);
}
```

**Algorithm:**
- Queries existing bookings for the mentor
- Excludes cancelled and completed bookings
- Checks for any time overlap using interval arithmetic
- Returns true if conflict found

### 2. Payment Integration

Integrated with Stellar blockchain for secure payments:

```typescript
// Payment flow
1. Create booking (status: pending, payment_status: pending)
2. Process payment via Stellar
3. Update booking with transaction hash
4. Set payment_status to 'paid'
5. Mentor confirms booking
6. Session takes place
7. Mark as completed
8. Payment released to mentor
```

### 3. Refund Policy

Automatic refund calculation based on cancellation timing:

```typescript
const refundInfo = calculateRefundEligibility(scheduledAt);

// Returns:
// - 100% refund: 24+ hours before session
// - 50% refund: 12-24 hours before session
// - 0% refund: <12 hours before session
```

### 4. Status Management

Comprehensive status tracking with validation:

```
pending → confirmed → completed
   ↓           ↓
cancelled  cancelled
   ↓
rescheduled → pending
```

### 5. Authorization

Role-based access control:

- **Mentees:** Create, update (own), cancel (own), view (own)
- **Mentors:** Confirm, complete, cancel (own), view (own)
- **Both:** Reschedule, check payment status

## Usage Examples

### Creating a Booking

```typescript
const response = await fetch('/api/v1/bookings', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    mentorId: 'mentor-uuid',
    scheduledAt: '2026-03-25T14:00:00Z',
    durationMinutes: 60,
    topic: 'Career guidance',
    notes: 'Looking for advice on senior role transition'
  })
});

const booking = await response.json();
// booking.data.id - use for payment processing
```

### Processing Payment

```typescript
// After booking creation, process payment
const paymentResult = await stellarService.submitTransaction(
  signedTransactionXDR
);

// Update booking with payment info
await BookingsService.updatePaymentStatus(
  bookingId,
  paymentResult.hash,
  transactionId
);
```

### Checking Conflicts

```typescript
import { doTimeSlotsOverlap } from './utils/booking-conflicts.utils';

const newSlot = {
  start: new Date('2026-03-25T14:00:00Z'),
  end: new Date('2026-03-25T15:00:00Z')
};

const existingSlot = {
  start: new Date('2026-03-25T14:30:00Z'),
  end: new Date('2026-03-25T15:30:00Z')
};

if (doTimeSlotsOverlap(newSlot, existingSlot)) {
  console.log('Conflict detected!');
}
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run booking tests only
npm test -- bookings

# Run with coverage
npm test:coverage
```

### Test Coverage

- ✅ Conflict detection utilities
- ✅ Booking service business logic
- ✅ Refund calculations
- ✅ Status transitions
- ✅ Authorization checks

### Manual Testing

```bash
# 1. Create a booking
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mentorId": "mentor-uuid",
    "scheduledAt": "2026-03-25T14:00:00Z",
    "durationMinutes": 60,
    "topic": "Career guidance"
  }'

# 2. List bookings
curl http://localhost:3000/api/v1/bookings \
  -H "Authorization: Bearer $TOKEN"

# 3. Cancel booking
curl -X DELETE http://localhost:3000/api/v1/bookings/booking-id \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Schedule conflict"}'
```

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mentorminds

# Stellar
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
PLATFORM_SECRET_KEY=SCZM...

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
```

### Validation Config

Located in `src/config/validation.config.ts`:

```typescript
{
  string: {
    maxShort: 100,    // Topic length
    maxLong: 2000,    // Notes length
  },
  pagination: {
    defaultLimit: 10,
    maxLimit: 100,
  }
}
```

## Error Handling

### Common Errors

| Code | Error | Cause | Solution |
|------|-------|-------|----------|
| 400 | Validation error | Invalid input | Check request body |
| 401 | Unauthorized | Missing/invalid token | Authenticate first |
| 403 | Forbidden | Wrong user role | Check permissions |
| 404 | Not found | Invalid ID | Verify booking exists |
| 409 | Conflict | Time slot taken | Choose different time |
| 500 | Server error | System failure | Contact support |

### Error Response Format

```json
{
  "status": "error",
  "message": "Mentor is not available at the requested time",
  "timestamp": "2026-03-24T10:00:00Z"
}
```

## Performance Optimization

### Database Indexes

Critical indexes for query performance:

1. `idx_bookings_mentor_id` - Conflict detection
2. `idx_bookings_scheduled_at` - Time-based queries
3. `idx_bookings_status` - Status filtering
4. Composite index on `(mentor_id, scheduled_at)` for optimal conflict checks

### Caching Strategy

```typescript
// Cache mentor availability (future feature)
const cacheKey = `mentor:${mentorId}:availability:${date}`;
const cached = await redis.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

// Fetch and cache
const availability = await fetchAvailability(mentorId, date);
await redis.setex(cacheKey, 300, JSON.stringify(availability)); // 5 min TTL
```

### Query Optimization

```sql
-- Efficient conflict check with indexed columns
SELECT COUNT(*) FROM bookings
WHERE mentor_id = $1
  AND status NOT IN ('cancelled', 'completed')
  AND scheduled_at < $3  -- end time
  AND scheduled_at + (duration_minutes || ' minutes')::INTERVAL > $2  -- start time
```

## Security Considerations

### Input Validation

- All inputs validated with Zod schemas
- SQL injection prevention via parameterized queries
- XSS prevention via sanitization

### Authorization

- JWT-based authentication
- Role-based access control
- Resource ownership verification

### Payment Security

- Stellar blockchain for immutable transactions
- Transaction hash verification
- Escrow pattern for payment holding

## Monitoring & Logging

### Audit Logging

All booking actions are logged:

```typescript
{
  "action": "BOOKING_CREATED",
  "user_id": "mentee-uuid",
  "entity_type": "booking",
  "entity_id": "booking-uuid",
  "metadata": {
    "mentor_id": "mentor-uuid",
    "scheduled_at": "2026-03-25T14:00:00Z",
    "amount": "50.0000000"
  }
}
```

### Metrics to Track

- Booking creation rate
- Cancellation rate
- Average session duration
- Payment success rate
- Conflict detection rate
- Response times

## Future Enhancements

### Planned Features

1. **Recurring Bookings**
   - Weekly/monthly sessions
   - Bulk booking creation
   - Series management

2. **Availability Calendar**
   - Mentor sets available hours
   - Block out unavailable times
   - Sync with external calendars

3. **Group Sessions**
   - Multiple mentees per session
   - Split payment handling
   - Group chat integration

4. **Video Integration**
   - Zoom/Meet integration
   - Automatic meeting creation
   - Recording management

5. **Automated Reminders**
   - Email notifications
   - SMS reminders
   - In-app notifications

6. **Review System**
   - Post-session ratings
   - Mentor feedback
   - Quality metrics

## Troubleshooting

### Common Issues

**Issue:** Conflict detection not working
- Check database indexes exist
- Verify timezone handling
- Review query logic

**Issue:** Payment not updating booking
- Verify Stellar transaction hash
- Check transaction model integration
- Review payment status flow

**Issue:** Authorization errors
- Verify JWT token validity
- Check user role in database
- Review middleware chain

## Support

### Documentation

- [API Documentation](./booking-api.md)
- [Flow Diagrams](./booking-flow.md)
- [Business Policies](./booking-policies.md)

### Getting Help

- GitHub Issues: Report bugs
- Email: [email]
- Slack: #booking-system channel

## Contributing

### Development Workflow

1. Create feature branch
2. Implement changes
3. Write tests
4. Update documentation
5. Submit pull request

### Code Standards

- TypeScript strict mode
- ESLint + Prettier
- 80%+ test coverage
- JSDoc comments for public APIs

## License

MIT License - See LICENSE file for details
