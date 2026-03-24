# Booking Flow Diagram

## Complete Booking Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                     BOOKING CREATION FLOW                        │
└─────────────────────────────────────────────────────────────────┘

Mentee                    System                    Mentor
  │                         │                         │
  │  1. Browse mentors      │                         │
  │────────────────────────>│                         │
  │                         │                         │
  │  2. Select time slot    │                         │
  │────────────────────────>│                         │
  │                         │                         │
  │                         │  3. Check conflicts     │
  │                         │─────────┐               │
  │                         │         │               │
  │                         │<────────┘               │
  │                         │                         │
  │  4. Create booking      │                         │
  │────────────────────────>│                         │
  │                         │                         │
  │  5. Booking created     │                         │
  │  (status: pending)      │                         │
  │<────────────────────────│                         │
  │                         │                         │
  │  6. Process payment     │                         │
  │────────────────────────>│                         │
  │                         │                         │
  │                         │  7. Submit to Stellar   │
  │                         │─────────────────────────>│
  │                         │                         │
  │                         │  8. Payment confirmed   │
  │                         │<─────────────────────────│
  │                         │                         │
  │  9. Payment success     │                         │
  │  (payment_status: paid) │                         │
  │<────────────────────────│                         │
  │                         │                         │
  │                         │  10. Notify mentor      │
  │                         │────────────────────────>│
  │                         │                         │
  │                         │  11. Mentor confirms    │
  │                         │<────────────────────────│
  │                         │                         │
  │  12. Booking confirmed  │                         │
  │  (status: confirmed)    │                         │
  │<────────────────────────│                         │
  │                         │                         │


┌─────────────────────────────────────────────────────────────────┐
│                     SESSION COMPLETION FLOW                      │
└─────────────────────────────────────────────────────────────────┘

Mentee                    System                    Mentor
  │                         │                         │
  │  [Session takes place]  │                         │
  │◄───────────────────────────────────────────────►│
  │                         │                         │
  │  1. Mark completed      │                         │
  │────────────────────────>│                         │
  │                         │                         │
  │                         │  2. Verify session end  │
  │                         │─────────┐               │
  │                         │         │               │
  │                         │<────────┘               │
  │                         │                         │
  │  3. Status updated      │                         │
  │  (status: completed)    │                         │
  │<────────────────────────│                         │
  │                         │                         │
  │                         │  4. Release payment     │
  │                         │────────────────────────>│
  │                         │                         │


┌─────────────────────────────────────────────────────────────────┐
│                     CANCELLATION FLOW                            │
└─────────────────────────────────────────────────────────────────┘

User                      System                    Stellar
  │                         │                         │
  │  1. Cancel booking      │                         │
  │────────────────────────>│                         │
  │                         │                         │
  │                         │  2. Check refund policy │
  │                         │─────────┐               │
  │                         │         │               │
  │                         │<────────┘               │
  │                         │                         │
  │                         │  3. Calculate refund    │
  │                         │─────────┐               │
  │                         │         │               │
  │                         │<────────┘               │
  │                         │                         │
  │  4. Cancellation        │                         │
  │  confirmed              │                         │
  │<────────────────────────│                         │
  │                         │                         │
  │                         │  5. Process refund      │
  │                         │  (if eligible)          │
  │                         │────────────────────────>│
  │                         │                         │
  │                         │  6. Refund confirmed    │
  │                         │<────────────────────────│
  │                         │                         │
  │  7. Refund notification │                         │
  │<────────────────────────│                         │
  │                         │                         │


┌─────────────────────────────────────────────────────────────────┐
│                     RESCHEDULE FLOW                              │
└─────────────────────────────────────────────────────────────────┘

User                      System                    Other Party
  │                         │                         │
  │  1. Request reschedule  │                         │
  │────────────────────────>│                         │
  │                         │                         │
  │                         │  2. Check new slot      │
  │                         │─────────┐               │
  │                         │         │               │
  │                         │<────────┘               │
  │                         │                         │
  │  3. Reschedule success  │                         │
  │  (status: rescheduled)  │                         │
  │<────────────────────────│                         │
  │                         │                         │
  │                         │  4. Notify other party  │
  │                         │────────────────────────>│
  │                         │                         │
```

## Status State Machine

```
                    ┌──────────┐
                    │ PENDING  │
                    └────┬─────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌─────────┐    ┌──────────┐    ┌────────────┐
    │CANCELLED│    │CONFIRMED │    │RESCHEDULED │
    └─────────┘    └────┬─────┘    └──────┬─────┘
                        │                  │
                        │                  │
                        ▼                  ▼
                   ┌──────────┐       ┌──────────┐
                   │COMPLETED │       │ PENDING  │
                   └──────────┘       └──────────┘
                        │
                        ▼
                   ┌──────────┐
                   │CANCELLED │
                   └──────────┘
```

## Payment Status Flow

```
    ┌─────────┐
    │ PENDING │
    └────┬────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌──────┐  ┌──────┐
│ PAID │  │FAILED│
└──┬───┘  └──────┘
   │
   ▼
┌─────────┐
│REFUNDED │
└─────────┘
```

## Conflict Detection Algorithm

```
┌─────────────────────────────────────────────────────────────────┐
│                  CONFLICT DETECTION LOGIC                        │
└─────────────────────────────────────────────────────────────────┘

Input: New booking (start_time, duration)
       Mentor ID

Step 1: Calculate end_time
        end_time = start_time + duration

Step 2: Query existing bookings
        WHERE mentor_id = input_mentor_id
        AND status NOT IN ('cancelled', 'completed')

Step 3: For each existing booking:
        existing_end = existing_start + existing_duration
        
        Check overlap:
        IF (start_time <= existing_start AND end_time > existing_start)
        OR (start_time < existing_end AND end_time >= existing_end)
        OR (start_time >= existing_start AND end_time <= existing_end)
        THEN
            CONFLICT DETECTED
            RETURN error
        END IF

Step 4: No conflicts found
        ALLOW booking creation
```

## Refund Calculation Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                    REFUND ELIGIBILITY                            │
└─────────────────────────────────────────────────────────────────┘

Input: scheduled_at, cancelled_at

hours_until_session = (scheduled_at - cancelled_at) / 3600

IF hours_until_session >= 24:
    refund_percentage = 100%
    eligible = true
    reason = "Cancelled more than 24 hours in advance"

ELSE IF hours_until_session >= 12:
    refund_percentage = 50%
    eligible = true
    reason = "Cancelled 12-24 hours in advance"

ELSE:
    refund_percentage = 0%
    eligible = false
    reason = "Cancelled less than 12 hours in advance"

RETURN {eligible, refund_percentage, reason}
```

## Integration Points

### 1. User Service Integration
- Validate mentee exists
- Validate mentor exists and has mentor role
- Fetch mentor hourly rate

### 2. Stellar Service Integration
- Process payment transactions
- Submit refunds
- Track transaction hashes
- Monitor payment status

### 3. Transaction Service Integration
- Create transaction records
- Link bookings to transactions
- Track payment history

### 4. Notification Service (Future)
- Booking confirmation emails
- Reminder notifications
- Cancellation alerts
- Reschedule notifications

## Error Handling

```
┌─────────────────────────────────────────────────────────────────┐
│                      ERROR SCENARIOS                             │
└─────────────────────────────────────────────────────────────────┘

1. Booking Conflict (409)
   - Mentor has overlapping booking
   - Return conflicting booking details
   - Suggest alternative times

2. Payment Failure (400)
   - Insufficient funds
   - Invalid Stellar address
   - Network timeout
   - Retry with exponential backoff

3. Invalid Time Slot (400)
   - Past date/time
   - Outside business hours
   - Invalid duration
   - Too short notice (<30 min)

4. Authorization Errors (403)
   - Non-mentee trying to book
   - Wrong user updating booking
   - Unauthorized cancellation

5. Not Found (404)
   - Mentor doesn't exist
   - Booking doesn't exist
   - User doesn't exist
```

## Performance Considerations

1. **Database Indexes**
   - mentor_id + scheduled_at for conflict checks
   - mentee_id for user booking lists
   - status for filtering
   - payment_status for payment queries

2. **Caching Strategy**
   - Cache mentor availability
   - Cache user booking lists (5 min TTL)
   - Invalidate on booking changes

3. **Concurrent Booking Prevention**
   - Use database transactions
   - Row-level locking on mentor availability
   - Optimistic locking with version numbers

4. **Scalability**
   - Partition bookings by date range
   - Archive completed bookings older than 1 year
   - Use read replicas for listing queries
