# Verification Submission Bug Fix

## Issue
The `submitVerification` method in `mentors.service.ts` was storing verification documents in the `users.metadata` JSONB column instead of using the dedicated `mentor_verifications` table created by migration `017_create_mentor_verifications.sql`.

### Problems with the old implementation:
1. **Not queryable**: Verification records stored in JSONB metadata cannot be efficiently queried or indexed
2. **Admin workflow broken**: The admin verification workflow queries `mentor_verifications` table but never sees submitted documents
3. **Data loss**: Multiple submissions overwrite each other (only the latest is kept in metadata)
4. **Status not updated**: The user's `status` field was never updated to reflect pending verification

## Solution

### Changes Made

#### 1. Updated `src/services/mentors.service.ts`
Rewrote the `submitVerification` method to:
- **INSERT** verification records into the `mentor_verifications` table with proper columns:
  - `mentor_id`: Reference to the mentor user
  - `document_type`: Type of document submitted
  - `document_url`: URL to the uploaded document
  - `linkedin_url`: Optional LinkedIn profile
  - `additional_notes`: Optional notes from mentor
  - `status`: Set to 'pending' by default
  
- **UPDATE** the user's `status` field to `'pending_verification'` after submission

- **Invalidate cache**: Clear the mentor profile cache to reflect the updated status

- **Add logging**: Log verification submissions for audit trail

#### 2. Updated `src/__tests__/services/mentors.service.unit.test.ts`
Updated the test expectations to verify:
- INSERT query is called with correct parameters for `mentor_verifications` table
- UPDATE query is called to set user status to `'pending_verification'`
- Both queries are executed (not just one)

### Benefits

✅ **Queryable records**: Admin can now query all pending verifications from `mentor_verifications` table

✅ **Multiple submissions**: Each document submission creates a new record (no overwriting)

✅ **Proper indexing**: Leverages existing indexes on `mentor_id` and `status` columns

✅ **Status tracking**: User's status field properly reflects verification state

✅ **Admin workflow**: Admin verification queue now receives and can process submissions

✅ **Audit trail**: All verification attempts are preserved with timestamps

### Database Schema Used

```sql
CREATE TABLE mentor_verifications (
    id UUID PRIMARY KEY,
    mentor_id UUID REFERENCES users(id),
    document_type VARCHAR(50),
    document_url VARCHAR(500),
    linkedin_url VARCHAR(500),
    additional_notes TEXT,
    status verification_status DEFAULT 'pending',
    reviewed_by UUID,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Next Steps for Admin Workflow

The admin verification workflow should query pending verifications using:

```sql
SELECT * FROM mentor_verifications 
WHERE status = 'pending' 
ORDER BY created_at ASC;
```

When reviewing, update the record with:
- `status`: 'approved', 'rejected', or 'more_info_requested'
- `reviewed_by`: Admin user ID
- `reviewed_at`: Current timestamp
- `rejection_reason`: If rejected

After approval, update the user record:
- Set `is_verified = true`
- Set `status = 'active'`
