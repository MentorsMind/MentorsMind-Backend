# Booking API Documentation

## Overview

The Booking API provides endpoints for creating, managing, and tracking mentoring sessions with integrated payment processing via the Stellar blockchain.

## Base URL

```
/api/v1/bookings
```

## Authentication

All endpoints require authentication via Bearer token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## Endpoints

### 1. Create Booking

Create a new mentoring session booking.

**Endpoint:** `POST /api/v1/bookings`

**Request Body:**
```json
{
  "mentorId": "uuid-v4",
  "scheduledAt": "2026-03-25T14:00:00Z",
  "durationMinutes": 60,
  "topic": "Career guidance and resume review",
  "notes": "Looking for advice on transitioning to senior role"
}
```

**Response:** `201 Created`
```json
{
  "status": "success",
  "message": "Booking created successfully",
  "data": {
    "id": "booking-uuid",
    "mentee_id": "user-uuid",
    "mentor_id": "mentor-uuid",
    "scheduled_at": "2026-03-25T14:00:00Z",
    "duration_minutes": 60,
    "topic": "Career guidance and resume review",
    "notes": "Looking for advice on transitioning to senior role",
    "status": "pending",
    "amount": "50.0000000",
    "currency": "XLM",
    "payment_status": "pending",
    "created_at": "2026-03-24T10:00:00Z"
  }
}
```

**Errors:**
- `400` - Validation error (invalid data)
- `404` - Mentor not found
- `409` - Booking conflict (mentor unavailable)

---

### 2. Get Booking Details

Retrieve details of a specific booking.

**Endpoint:** `GET /api/v1/bookings/:id`

**Response:** `200 OK`
```json
{
  "status": "success",
  "message": "Booking retrieved successfully",
  "data": {
    "id": "booking-uuid",
    "mentee_id": "user-uuid",
    "mentor_id": "mentor-uuid",
    "scheduled_at": "2026-03-25T14:00:00Z",
    "duration_minutes": 60,
    "topic": "Career guidance",
    "status": "confirmed",
    "payment_status": "paid",
    "amount": "50.0000000",
    "currency": "XLM"
  }
}
```

**Errors:**
- `404` - Booking not found
- `403` - Access denied (not mentee or mentor)

---

### 3. Update Booking

Update booking details (mentee only, before confirmation).

**Endpoint:** `PUT /api/v1/bookings/:id`

**Request Body:**
```json
{
  "scheduledAt": "2026-03-25T15:00:00Z",
  "durationMinutes": 90,
  "topic": "Updated topic",
  "notes": "Additional notes"
}
```

**Response:** `200 OK`

**Errors:**
- `400` - Cannot update booking in current status
- `403` - Only mentee can update
- `409` - New time conflicts with existing booking

---

### 4. Cancel Booking

Cancel a booking with optional refund.

**Endpoint:** `DELETE /api/v1/bookings/:id`

**Request Body:**
```json
{
  "reason": "Schedule conflict"
}
```

**Response:** `200 OK`
```json
{
  "status": "success",
  "message": "Booking cancelled successfully",
  "data": {
    "id": "booking-uuid",
    "status": "cancelled",
    "payment_status": "refunded",
    "cancellation_reason": "Schedule conflict"
  }
}
```

**Refund Policy:**
- **24+ hours before session:** 100% refund
- **12-24 hours before session:** 50% refund
- **Less than 12 hours:** No refund

---

### 5. List User Bookings

Get all bookings for the authenticated user (as mentee or mentor).

**Endpoint:** `GET /api/v1/bookings`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `status` (optional): Filter by status (pending, confirmed, completed, cancelled, rescheduled)

**Response:** `200 OK`
```json
{
  "status": "success",
  "message": "Bookings retrieved successfully",
  "data": [
    {
      "id": "booking-uuid",
      "scheduled_at": "2026-03-25T14:00:00Z",
      "status": "confirmed",
      "topic": "Career guidance"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

### 6. Confirm Booking

Confirm a booking (mentor only, after payment).

**Endpoint:** `POST /api/v1/bookings/:id/confirm`

**Response:** `200 OK`

**Errors:**
- `400` - Booking not in pending status or payment not completed
- `403` - Only mentor can confirm

---

### 7. Complete Booking

Mark a booking as completed (after session ends).

**Endpoint:** `POST /api/v1/bookings/:id/complete`

**Response:** `200 OK`

**Errors:**
- `400` - Booking not confirmed or session hasn't ended yet
- `403` - Access denied

---

### 8. Reschedule Booking

Reschedule a booking to a new time.

**Endpoint:** `POST /api/v1/bookings/:id/reschedule`

**Request Body:**
```json
{
  "scheduledAt": "2026-03-26T14:00:00Z",
  "reason": "Mentor requested reschedule"
}
```

**Response:** `200 OK`

**Errors:**
- `400` - Cannot reschedule in current status
- `409` - New time conflicts with existing booking

---

### 9. Check Payment Status

Get payment status for a booking.

**Endpoint:** `GET /api/v1/bookings/:id/payment-status`

**Response:** `200 OK`
```json
{
  "status": "success",
  "message": "Payment status retrieved successfully",
  "data": {
    "paymentStatus": "paid",
    "amount": "50.0000000",
    "currency": "XLM",
    "stellarTxHash": "abc123...",
    "transactionId": "transaction-uuid"
  }
}
```

---

## Booking Status Flow

```
pending → confirmed → completed
   ↓           ↓
cancelled  cancelled
   ↓
rescheduled → pending
```

## Payment Status Flow

```
pending → paid → refunded
   ↓
failed
```

## Conflict Detection

The system automatically detects booking conflicts:

1. Checks mentor's existing bookings
2. Validates time slot availability
3. Considers booking duration
4. Excludes cancelled/completed bookings

**Conflict occurs when:**
- New booking overlaps with existing active booking
- Time slots intersect in any way

## Business Rules

1. **Minimum booking time:** 15 minutes
2. **Maximum booking time:** 240 minutes (4 hours)
3. **Minimum advance booking:** 30 minutes
4. **Cancellation window:** Up to session start time
5. **Refund eligibility:** Based on cancellation timing

## Error Responses

All errors follow this format:

```json
{
  "status": "error",
  "message": "Error description",
  "timestamp": "2026-03-24T10:00:00Z"
}
```

**Common Status Codes:**
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (booking overlap)
- `500` - Internal Server Error

## Rate Limiting

All booking endpoints are subject to rate limiting:
- **Standard users:** 100 requests per 15 minutes
- **Authenticated users:** 1000 requests per 15 minutes

## Best Practices

1. **Check availability** before creating bookings
2. **Handle conflicts** gracefully with user feedback
3. **Verify payment** before confirming bookings
4. **Implement retry logic** for network failures
5. **Cache booking lists** to reduce API calls
6. **Use webhooks** for real-time payment updates (future feature)

## Integration Example

```typescript
// Create a booking
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
    topic: 'Career guidance'
  })
});

const booking = await response.json();

// Process payment via Stellar
// ... payment logic ...

// Check payment status
const paymentStatus = await fetch(
  `/api/v1/bookings/${booking.data.id}/payment-status`,
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);
```

## Future Enhancements

- Real-time availability calendar
- Recurring bookings
- Group sessions
- Video conferencing integration
- Automated reminders
- Review and rating system
