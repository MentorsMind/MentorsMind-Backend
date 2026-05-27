# Mentor Verification Workflow Implementation

**Issue:** #448  
**Description:** Complete mentor identity and credential verification process.

## Overview

The mentor verification workflow is fully implemented and allows mentors to submit identity and credential documents for admin review. Upon approval, mentors receive verified status for one year with automatic expiry handling.

## Acceptance Criteria

- ✅ POST /api/v1/mentors/verification/submit - submit docs
- ✅ GET /api/v1/admin/verifications - admin list
- ✅ PUT /api/v1/admin/verifications/:id/approve - approve
- ✅ PUT /api/v1/admin/verifications/:id/reject - reject
- ✅ Send email notifications at each step
- ✅ Verification expires after 1 year

## Architecture

### Verification Status Flow

```
pending → approved → expired
pending → rejected
pending → more_info_requested → pending
```

### Database Schema

**Table:** `mentor_verifications`

**Columns:**
- `id` - UUID primary key
- `mentor_id` - Reference to users table
- `document_type` - Type of ID document (passport, national_id, drivers_license)
- `document_url` - URL to uploaded ID document
- `credential_url` - Optional URL to credential/certificate
- `linkedin_url` - Optional LinkedIn profile URL
- `additional_notes` - Optional additional information
- `status` - verification_status enum (pending, approved, rejected, more_info_requested, expired)
- `reviewed_by` - Admin user ID who reviewed
- `reviewed_at` - Timestamp of review
- `rejection_reason` - Reason for rejection
- `additional_info_request` - Message when requesting more info
- `on_chain_tx_hash` - Stellar transaction hash for on-chain verification
- `on_chain_pending` - Boolean flag for pending on-chain verification
- `expires_at` - Expiration date (1 year after approval)
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

**Users Table:**
- `is_verified` - Boolean flag indicating verified status

## Implementation Details

### 1. Verification Service

**File:** `src/services/verification.service.ts`

**Methods:**
- `submit()` - Submit verification documents
- `list()` - List all verifications with pagination and filtering
- `getStatusByMentorId()` - Get latest verification status for a mentor
- `getById()` - Get verification by ID
- `approve()` - Approve verification (sets 1-year expiry, triggers on-chain verification)
- `reject()` - Reject verification with reason
- `requestMoreInfo()` - Request additional documents from mentor
- `flagExpiredVerifications()` - Mark expired verifications and remove verified status
- `retryPendingOnChainVerifications()` - Retry failed on-chain verifications
- `sendStatusEmail()` - Send email notifications at each status change
- `triggerOnChainVerification()` - Trigger Stellar blockchain verification

### 2. Verification Controller

**File:** `src/controllers/verification.controller.ts`

**Endpoints:**
- `submit()` - POST /api/v1/mentors/verification/submit
- `listVerifications()` - GET /api/v1/admin/verifications
- `approve()` - PUT /api/v1/admin/verifications/:id/approve
- `reject()` - PUT /api/v1/admin/verifications/:id/reject
- `requestMoreInfo()` - PUT /api/v1/admin/verifications/:id/request-more
- `getVerificationStatus()` - GET /api/v1/mentors/:id/verification-status

### 3. Routes

**Files:**
- `src/routes/mentors.routes.ts` - Mentor-facing routes
- `src/routes/admin.routes.ts` - Admin-facing routes

**Mentor Routes:**
- POST /api/v1/mentors/verification/submit
- GET /api/v1/mentors/:id/verification-status

**Admin Routes:**
- GET /api/v1/admin/verifications
- PUT /api/v1/admin/verifications/:id/approve
- PUT /api/v1/admin/verifications/:id/reject
- PUT /api/v1/admin/verifications/:id/request-more

### 4. Scheduled Job

**File:** `src/jobs/verificationExpiry.job.ts`

**Function:** `runVerificationExpiryJob()`

**Schedule:** Daily (via BullMQ repeatable job)

**Purpose:**
- Finds all approved verifications past their expiry date
- Updates status to 'expired'
- Removes verified status from users table
- Logs count of expired verifications

### 5. Database Migrations

**Migration 017:** `database/migrations/017_create_mentor_verifications.sql`
- Creates mentor_verifications table
- Creates verification_status enum
- Adds is_verified column to users table
- Creates indexes for performance

**Migration 061:** `database/migrations/061_add_on_chain_pending_to_verifications.sql`
- Adds on_chain_pending column to track pending on-chain verifications
- Creates index for pending verifications

### 6. Email Notifications

**Status Emails:**
- **pending:** "Verification Submission Received"
- **approved:** "Your Verification Has Been Approved"
- **rejected:** "Verification Update — Action Required"
- **more_info_requested:** "Additional Information Needed for Verification"
- **expired:** "Your Verification Has Expired"

**Implementation:** Uses `enqueueEmail()` from email queue with appropriate subject and body for each status.

## API Endpoints

### Submit Verification (Mentor)

```http
POST /api/v1/mentors/verification/submit
Authorization: Bearer <mentor-token>
Content-Type: application/json

{
  "documentType": "passport",
  "documentUrl": "https://example.com/document.pdf",
  "credentialUrl": "https://example.com/credential.pdf",
  "linkedinUrl": "https://linkedin.com/in/mentor",
  "additionalNotes": "Optional notes"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Verification submitted successfully",
  "data": {
    "id": "verification-uuid",
    "mentor_id": "mentor-uuid",
    "status": "pending",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

### List Verifications (Admin)

```http
GET /api/v1/admin/verifications?status=pending&page=1&limit=20
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Verifications retrieved successfully",
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Approve Verification (Admin)

```http
PUT /api/v1/admin/verifications/:id/approve
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Verification approved",
  "data": {
    "id": "verification-uuid",
    "status": "approved",
    "expires_at": "2025-01-01T00:00:00Z",
    "reviewed_by": "admin-uuid",
    "reviewed_at": "2024-01-01T00:00:00Z"
  }
}
```

### Reject Verification (Admin)

```http
PUT /api/v1/admin/verifications/:id/reject
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "reason": "Document is unclear or invalid"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Verification rejected",
  "data": {
    "id": "verification-uuid",
    "status": "rejected",
    "rejection_reason": "Document is unclear or invalid",
    "reviewed_by": "admin-uuid",
    "reviewed_at": "2024-01-01T00:00:00Z"
  }
}
```

### Request More Information (Admin)

```http
PUT /api/v1/admin/verifications/:id/request-more
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "message": "Please provide a clearer photo of your ID document"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Additional information requested",
  "data": {
    "id": "verification-uuid",
    "status": "more_info_requested",
    "additional_info_request": "Please provide a clearer photo of your ID document",
    "reviewed_by": "admin-uuid",
    "reviewed_at": "2024-01-01T00:00:00Z"
  }
}
```

### Get Verification Status (Public)

```http
GET /api/v1/mentors/:id/verification-status
```

**Response:**
```json
{
  "success": true,
  "message": "Verification status retrieved",
  "data": {
    "id": "verification-uuid",
    "mentor_id": "mentor-uuid",
    "status": "approved",
    "expires_at": "2025-01-01T00:00:00Z"
  }
}
```

## Verification Expiry

### Automatic Expiry

- Approved verifications expire 1 year after approval
- Daily scheduled job checks for expired verifications
- Expired verifications are marked with status 'expired'
- User's `is_verified` flag is set to FALSE
- Email notification sent to mentor about expiry

### Renewal Process

- Mentors with expired verifications can submit new verification documents
- New submission supersedes previous pending submissions
- Approved verification resets expiry to 1 year from new approval date

## On-Chain Verification

### Stellar Blockchain Integration

When a verification is approved:
1. Service attempts to trigger on-chain verification via Stellar contract
2. Transaction hash stored in `on_chain_tx_hash`
3. If transaction fails or is pending, `on_chain_pending` flag is set
4. Background job retries pending on-chain verifications

### Configuration

Required environment variables:
- `SOROBAN_RPC_URL` - Stellar Soroban RPC endpoint
- `VERIFICATION_CONTRACT_ADDRESS` - Stellar contract address for verification
- `PLATFORM_SECRET_KEY` - Platform signing key (optional)
- `PLATFORM_PUBLIC_KEY` - Platform public key
- `STELLAR_NETWORK` - 'mainnet' or 'testnet'

## Security Considerations

1. **Authentication:** All endpoints require authentication
2. **Authorization:** Admin endpoints require admin role
3. **Document Storage:** Documents should be stored in secure S3 with presigned URLs
4. **PII Protection:** Sensitive information should be encrypted at rest
5. **Audit Trail:** All status changes are logged with reviewer information

## Testing

### Integration Tests

**File:** `src/__tests__/services/verification.integration.test.ts`

**Test Coverage:**
- Submit verification documents
- Approve verification with 1-year expiry
- Reject verification with reason
- Flag expired verifications

### Unit Tests

**File:** `src/__tests__/services/verification.service.unit.test.ts`

**Test Coverage:**
- Service method functionality
- Email notification triggers
- On-chain verification logic

## Deployment Steps

1. **Run Database Migrations**
   ```bash
   npm run migrate:up
   ```

2. **Configure Environment Variables**
   - Set Stellar blockchain configuration
   - Configure email service

3. **Register Scheduled Job**
   - Add `runVerificationExpiryJob` to BullMQ worker
   - Configure daily repeat schedule

4. **Test Endpoints**
   - Submit verification as mentor
   - Approve/reject as admin
   - Verify email notifications
   - Check expiry after 1 year (or manually test)

## Monitoring

### Key Metrics

- Verification submission rate
- Approval/rejection rate
- Average time to review
- Expiry rate
- On-chain verification success rate

### Queries

**Pending verifications:**
```sql
SELECT COUNT(*) FROM mentor_verifications WHERE status = 'pending';
```

**Verifications expiring soon (next 30 days):**
```sql
SELECT COUNT(*) FROM mentor_verifications 
WHERE status = 'approved' 
AND expires_at BETWEEN NOW() AND NOW() + INTERVAL '30 days';
```

**Verification approval rate:**
```sql
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM mentor_verifications
GROUP BY status;
```

## Future Enhancements

- Bulk approval/rejection for admins
- Verification document preview in admin panel
- Integration with third-party identity verification services
- Multi-factor verification process
- Verification badge display on mentor profiles
- Automated document validation using AI
- Verification history tracking
