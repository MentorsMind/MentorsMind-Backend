# Escrow API Documentation

## Overview

The Escrow API provides secure payment management for mentorship sessions on the MentorsMind platform. It implements a smart contract-like escrow system that holds funds until services are delivered, with built-in dispute resolution mechanisms.

## Escrow Lifecycle

```
pending → funded → released (to mentor)
                 ↓
                disputed → resolved → released/refunded
                 ↓
                refunded (to learner)
```

## API Endpoints

### 1. Create Escrow Contract

**Endpoint:** `POST /api/v1/escrow`

**Description:** Creates a new escrow contract between a learner and mentor.

**Authentication:** Required (Learner)

**Request Body:**
```json
{
  "mentorId": "uuid",
  "amount": "100.50",
  "currency": "XLM",
  "description": "Python programming mentorship session"
}
```

**Response (201):**
```json
{
  "status": "success",
  "message": "Escrow contract created successfully",
  "data": {
    "id": "uuid",
    "learner_id": "uuid",
    "mentor_id": "uuid",
    "amount": "100.50",
    "currency": "XLM",
    "status": "pending",
    "description": "Python programming mentorship session",
    "created_at": "2024-03-20T10:00:00Z",
    "updated_at": "2024-03-20T10:00:00Z"
  },
  "timestamp": "2024-03-20T10:00:00Z"
}
```

---

### 2. Get Escrow Details

**Endpoint:** `GET /api/v1/escrow/:id`

**Description:** Retrieves detailed information about a specific escrow contract.

**Authentication:** Required (Learner, Mentor, or Admin)

**Response (200):**
```json
{
  "status": "success",
  "message": "Escrow retrieved successfully",
  "data": {
    "id": "uuid",
    "learner_id": "uuid",
    "mentor_id": "uuid",
    "amount": "100.50",
    "currency": "XLM",
    "status": "funded",
    "stellar_tx_hash": "abc123...",
    "description": "Python programming mentorship session",
    "created_at": "2024-03-20T10:00:00Z",
    "updated_at": "2024-03-20T10:05:00Z"
  },
  "timestamp": "2024-03-20T10:10:00Z"
}
```

---

### 3. Release Funds to Mentor

**Endpoint:** `POST /api/v1/escrow/:id/release`

**Description:** Releases escrowed funds to the mentor after successful service delivery.

**Authentication:** Required (Learner only)

**Request Body (Optional):**
```json
{
  "stellarTxHash": "abc123..."
}
```

**Response (200):**
```json
{
  "status": "success",
  "message": "Funds released to mentor successfully",
  "data": {
    "id": "uuid",
    "status": "released",
    "released_at": "2024-03-20T11:00:00Z",
    "stellar_tx_hash": "abc123..."
  },
  "timestamp": "2024-03-20T11:00:00Z"
}
```

**State Requirements:**
- Escrow must be in `funded` or `pending` status
- Only the learner can release funds

---

### 4. Open a Dispute

**Endpoint:** `POST /api/v1/escrow/:id/dispute`

**Description:** Opens a dispute for an escrow contract when there's a disagreement.

**Authentication:** Required (Learner or Mentor)

**Request Body:**
```json
{
  "reason": "Service was not delivered as agreed. The mentor did not show up for the scheduled session."
}
```

**Response (200):**
```json
{
  "status": "success",
  "message": "Dispute opened successfully",
  "data": {
    "escrow": {
      "id": "uuid",
      "status": "disputed",
      "dispute_id": "uuid"
    },
    "disputeId": "uuid"
  },
  "timestamp": "2024-03-20T12:00:00Z"
}
```

**State Requirements:**
- Escrow cannot be in `released`, `refunded`, or `cancelled` status
- Either learner or mentor can open a dispute

---

### 5. Resolve Dispute (Admin Only)

**Endpoint:** `POST /api/v1/escrow/:id/resolve`

**Description:** Resolves a dispute by deciding to release funds to mentor or refund to learner.

**Authentication:** Required (Admin only)

**Request Body:**
```json
{
  "resolution": "release_to_mentor",
  "notes": "Evidence shows service was delivered as agreed.",
  "stellarTxHash": "def456..."
}
```

**Resolution Options:**
- `release_to_mentor` - Release funds to the mentor
- `refund_to_mentee` - Refund funds to the mentee

**Response (200):**
```json
{
  "status": "success",
  "message": "Dispute resolved successfully",
  "data": {
    "id": "uuid",
    "status": "released",
    "released_at": "2024-03-20T13:00:00Z"
  },
  "timestamp": "2024-03-20T13:00:00Z"
}
```

**State Requirements:**
- Escrow must be in `disputed` status
- Only admins can resolve disputes

---

### 6. Check Escrow Status

**Endpoint:** `GET /api/v1/escrow/:id/status`

**Description:** Quick status check for an escrow contract.

**Authentication:** Required (Learner, Mentor, or Admin)

**Response (200):**
```json
{
  "status": "success",
  "message": "Escrow status retrieved successfully",
  "data": {
    "id": "uuid",
    "status": "funded",
    "amount": "100.50",
    "currency": "XLM",
    "createdAt": "2024-03-20T10:00:00Z",
    "updatedAt": "2024-03-20T10:05:00Z"
  },
  "timestamp": "2024-03-20T14:00:00Z"
}
```

---

### 7. Process Refund to Learner

**Endpoint:** `POST /api/v1/escrow/:id/refund`

**Description:** Processes a refund to the learner (typically initiated by mentor).

**Authentication:** Required (Mentor only)

**Request Body (Optional):**
```json
{
  "stellarTxHash": "ghi789..."
}
```

**Response (200):**
```json
{
  "status": "success",
  "message": "Refund processed successfully",
  "data": {
    "id": "uuid",
    "status": "refunded",
    "refunded_at": "2024-03-20T15:00:00Z",
    "stellar_tx_hash": "ghi789..."
  },
  "timestamp": "2024-03-20T15:00:00Z"
}
```

**State Requirements:**
- Escrow cannot be in `released` or `refunded` status
- Only the mentor can initiate a refund

---

### 8. List User Escrows

**Endpoint:** `GET /api/v1/escrow`

**Description:** Lists all escrow contracts for the authenticated user.

**Authentication:** Required

**Query Parameters:**
- `page` (optional, default: 1) - Page number
- `limit` (optional, default: 20, max: 100) - Items per page
- `status` (optional) - Filter by status: `pending`, `funded`, `released`, `disputed`, `resolved`, `refunded`, `cancelled`
- `role` (optional) - Filter by role: `learner`, `mentor`

**Example:** `GET /api/v1/escrow?page=1&limit=20&status=funded&role=learner`

**Response (200):**
```json
{
  "status": "success",
  "message": "Escrows retrieved successfully",
  "data": [
    {
      "id": "uuid",
      "learner_id": "uuid",
      "mentor_id": "uuid",
      "amount": "100.50",
      "currency": "XLM",
      "status": "funded",
      "created_at": "2024-03-20T10:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  },
  "timestamp": "2024-03-20T16:00:00Z"
}
```

---

## Escrow Status Definitions

| Status | Description |
|--------|-------------|
| `pending` | Escrow created, awaiting funding |
| `funded` | Funds deposited and held in escrow |
| `released` | Funds released to mentor |
| `disputed` | Dispute opened, awaiting resolution |
| `resolved` | Dispute resolved by admin |
| `refunded` | Funds returned to learner |
| `cancelled` | Escrow cancelled before funding |

## State Transition Rules

### Valid Transitions

- `pending` → `funded`, `cancelled`
- `funded` → `released`, `disputed`, `refunded`
- `disputed` → `resolved`, `released`, `refunded`
- `resolved` → `released`, `refunded`

### Terminal States

- `released` - No further transitions
- `refunded` - No further transitions
- `cancelled` - No further transitions

## Error Responses

### 400 Bad Request
```json
{
  "status": "fail",
  "message": "Validation failed",
  "errors": [
    {
      "field": "amount",
      "message": "Amount must be greater than 0"
    }
  ],
  "timestamp": "2024-03-20T10:00:00Z"
}
```

### 401 Unauthorized
```json
{
  "status": "error",
  "message": "Authentication required",
  "timestamp": "2024-03-20T10:00:00Z"
}
```

### 403 Forbidden
```json
{
  "status": "error",
  "message": "Only the learner can release funds",
  "timestamp": "2024-03-20T10:00:00Z"
}
```

### 404 Not Found
```json
{
  "status": "error",
  "message": "Escrow not found",
  "timestamp": "2024-03-20T10:00:00Z"
}
```

### 500 Internal Server Error
```json
{
  "status": "error",
  "message": "Failed to create escrow",
  "timestamp": "2024-03-20T10:00:00Z"
}
```

## Security Considerations

1. **Authorization**: Each endpoint validates that the user has permission to perform the action
2. **State Validation**: All state transitions are validated before execution
3. **Audit Logging**: All escrow operations are logged for compliance
4. **Idempotency**: Operations are designed to be idempotent where possible
5. **Rate Limiting**: API endpoints are rate-limited to prevent abuse

## Integration with Stellar

The escrow system integrates with the Stellar blockchain for:
- Recording transaction hashes for transparency
- Verifying payment completion
- Processing actual fund transfers

Transaction hashes can be provided when releasing funds or processing refunds to link on-chain transactions with escrow records.
