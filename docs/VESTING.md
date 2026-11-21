# Vesting Schedule Management

## Overview

The MentorsMind platform integrates with a Soroban smart contract to manage token vesting schedules for team members, advisors, mentors, and other stakeholders. This document describes the complete vesting system architecture, API usage, and operational procedures.

## Table of Contents

1. [Architecture](#architecture)
2. [Smart Contract](#smart-contract)
3. [API Reference](#api-reference)
4. [Data Model](#data-model)
5. [Sync Worker](#sync-worker)
6. [Security](#security)
7. [Common Operations](#common-operations)
8. [Troubleshooting](#troubleshooting)

---

## Architecture

### Components

1. **Soroban Smart Contract** (`contracts/vesting/src/lib.rs`)
   - Source of truth for vesting schedules
   - Handles token locking and distribution
   - Enforces cliff and vesting rules

2. **PostgreSQL Mirror** (`vesting_schedules` table)
   - Fast queryable copy of on-chain data
   - Enables filtering, pagination, and reporting
   - Synced periodically with contract state

3. **Backend Service** (`src/services/vesting.service.ts`)
   - Wraps Soroban RPC calls
   - Manages PostgreSQL mirror
   - Provides business logic

4. **Sync Worker** (`src/workers/vesting-sync.worker.ts`)
   - Reconciles PostgreSQL with on-chain data
   - Runs every 6 hours automatically
   - Can be triggered manually for specific schedules

5. **REST API** (`src/controllers/vesting.controller.ts`)
   - Admin endpoints for schedule creation/management
   - Beneficiary endpoints for viewing and claiming
   - Public query endpoints

### Data Flow

```
Admin Action → Backend API → Soroban Contract → On-chain Storage
                     ↓
              PostgreSQL Mirror ← Sync Worker ← On-chain State
                     ↓
         Beneficiary Queries (fast, no on-chain call)
```

### Sync Strategy

- **Write-through**: Schedule creation immediately writes to both contract and DB
- **Periodic sync**: Worker reconciles every 6 hours for drift correction
- **On-demand sync**: After claim operations, immediate sync
- **Lazy sync**: Queries use DB cache; sync happens asynchronously

---

## Smart Contract

### Contract Location
- **Source**: `contracts/vesting/src/lib.rs`
- **Address**: Set via `SOROBAN_VESTING_CONTRACT_ADDRESS` environment variable

### Key Constants

```rust
MIN_CLIFF_SECS: 3600       // 1 hour minimum cliff
MIN_VESTING_SECS: 86400    // 1 day minimum vesting
MAX_VESTING_SECS: 315360000 // 10 years maximum vesting
TIMESTAMP_TOLERANCE_SECS: 60 // 1 minute tolerance for cliff checks
```

### Contract Methods

#### `initialize(admin: Address, token: Address)`
Initialize the contract (one-time only).

#### `create_schedule(beneficiary, total_amount, cliff_seconds, vesting_seconds, start) → schedule_id`
Create a new vesting schedule.

**Parameters:**
- `beneficiary`: Stellar address of recipient
- `total_amount`: Total tokens in stroops (1 XLM = 10,000,000 stroops)
- `cliff_seconds`: Duration before any tokens vest (0 or ≥ 3600)
- `vesting_seconds`: Total vesting duration (≥ 86400, ≤ 315360000)
- `start`: Start timestamp (0 = now, or specific Unix timestamp)

**Returns:** On-chain schedule ID (integer)

#### `claim(schedule_id)`
Claim all currently vested tokens for a schedule.

**Authorization:** Only the beneficiary can call this.

#### `revoke(schedule_id)`
Revoke a schedule and return unvested tokens to admin.

**Authorization:** Only admin can call this.

#### `get_schedule(schedule_id) → VestingSchedule`
Get schedule details from contract.

#### `claimable_amount(schedule_id) → i128`
Calculate currently claimable amount.

#### `get_schedules_by_beneficiary(address) → Vec<u32>`
Get all schedule IDs for a beneficiary.

### Vesting Calculation

The contract uses **linear vesting**:

1. **Before cliff**: No tokens claimable
2. **Between cliff and vesting_end**: Linear interpolation
3. **After vesting_end**: All tokens claimable

Formula (after cliff):
```
vested_amount = total_amount × (current_time - cliff_end) / (vesting_end - cliff_end)
claimable = vested_amount - claimed
```

### Timestamp Tolerance

The contract applies a 60-second tolerance to cliff checks to absorb validator clock drift. This means tokens become claimable 60 seconds *after* the cliff timestamp.

---

## API Reference

### Admin Endpoints

#### Create Vesting Schedule

```http
POST /api/v1/admin/vesting/schedules
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "beneficiaryAddress": "GABC...",
  "totalAmount": "10000000",
  "cliffDuration": 7776000,
  "vestingDuration": 31536000,
  "vestingType": "team",
  "notes": "Engineer vesting schedule",
  "beneficiaryUserId": "uuid-if-user-exists"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "scheduleId": 1,
    "beneficiaryAddress": "GABC...",
    "totalAmount": "10000000",
    "claimedAmount": "0",
    "cliffEnd": 1735689600,
    "vestingEnd": 1767225600,
    "start": 1727913600,
    "status": "active",
    "vestingType": "team",
    "claimableNow": "0",
    "claimablePercent": 0,
    "isCliffPassed": false,
    "isFullyVested": false
  }
}
```

**Validation Rules:**
- `cliffDuration`: 0 or ≥ 3600 (1 hour)
- `vestingDuration`: ≥ 86400 (1 day), ≤ 315360000 (10 years)
- `cliffDuration` ≤ `vestingDuration`

**HTTP 422** if validation fails.

#### List All Schedules

```http
GET /api/v1/admin/vesting/schedules?status=active&limit=50&offset=0
Authorization: Bearer <admin_token>
```

**Query Parameters:**
- `status`: Filter by `active`, `revoked`, or `completed`
- `vestingType`: Filter by vesting type
- `limit`: Results per page (default 50)
- `offset`: Pagination offset (default 0)

**Response:**
```json
{
  "success": true,
  "data": [ /* array of schedules */ ],
  "pagination": {
    "total": 100,
    "limit": 50,
    "offset": 0
  }
}
```

#### Get Schedule by ID

```http
GET /api/v1/admin/vesting/schedules/:id
Authorization: Bearer <admin_token>
```

#### Revoke Schedule

```http
DELETE /api/v1/admin/vesting/schedules/:id
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "reason": "Employee termination"
}
```

Unvested tokens are returned to the admin wallet.

### Beneficiary Endpoints

#### Get My Schedules

```http
GET /api/v1/vesting/my-schedules
Authorization: Bearer <user_token>
```

Returns all schedules for the authenticated user (by user ID or wallet address).

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "scheduleId": 1,
      "totalAmount": "10000000",
      "claimedAmount": "2500000",
      "claimableNow": "1250000",
      "claimablePercent": 37.5,
      "isCliffPassed": true,
      "isFullyVested": false,
      "cliffEnd": 1735689600,
      "vestingEnd": 1767225600,
      "status": "active"
    }
  ]
}
```

#### Claim Vesting

```http
POST /api/v1/vesting/schedules/:id/claim
Authorization: Bearer <user_token>
```

Claims all currently vested tokens for the schedule.

**Requirements:**
- User must be the beneficiary
- User must have a wallet address linked
- Claimable amount must be > 0

**Response:**
```json
{
  "success": true,
  "data": {
    "scheduleId": 1,
    "amountClaimed": "1250000",
    "claimedAt": "2024-01-15T10:30:00Z",
    "txHash": "abc123...",
    "beneficiaryAddress": "GABC..."
  }
}
```

#### Get Claim History

```http
GET /api/v1/vesting/schedules/:id/claims
Authorization: Bearer <user_token>
```

Returns all past claims for a schedule (beneficiary or admin only).

### Public Endpoints

#### Get Schedules by Address

```http
GET /api/v1/vesting/schedules/by-address/:address
```

Returns all vesting schedules for a Stellar address (public query for wallet integration).

---

## Data Model

### `vesting_schedules` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `schedule_id` | INTEGER | On-chain schedule ID (unique) |
| `beneficiary_address` | VARCHAR(56) | Stellar address |
| `beneficiary_user_id` | UUID | Link to users table (nullable) |
| `total_amount` | BIGINT | Total vesting amount (stroops) |
| `claimed_amount` | BIGINT | Amount claimed so far |
| `cliff_end_timestamp` | BIGINT | Unix timestamp when cliff ends |
| `vesting_end_timestamp` | BIGINT | Unix timestamp when fully vested |
| `start_timestamp` | BIGINT | Unix timestamp when vesting started |
| `contract_address` | VARCHAR(56) | Soroban contract address |
| `status` | VARCHAR(20) | `active`, `revoked`, `completed` |
| `vesting_type` | VARCHAR(50) | Category (team, advisor, etc.) |
| `notes` | TEXT | Admin notes |
| `created_by` | UUID | Admin who created it |
| `revoked_by` | UUID | Admin who revoked it (nullable) |
| `revoked_at` | TIMESTAMPTZ | When revoked (nullable) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |
| `last_synced_at` | TIMESTAMPTZ | Last sync with contract |

### `vesting_claims` Table (Audit Trail)

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `schedule_id` | INTEGER | References `vesting_schedules.schedule_id` |
| `amount_claimed` | BIGINT | Amount claimed in this transaction |
| `claimed_at` | TIMESTAMPTZ | Claim timestamp |
| `tx_hash` | VARCHAR(64) | Soroban transaction hash |
| `beneficiary_address` | VARCHAR(56) | Claimer's address |
| `notes` | TEXT | Optional notes |

### `vesting_sync_log` Table

Tracks sync job performance for monitoring.

---

## Sync Worker

### Schedule

The vesting sync worker runs **every 6 hours** to reconcile the PostgreSQL mirror with on-chain state.

### What It Does

1. Queries all `active` schedules from DB (oldest `last_synced_at` first)
2. For each schedule:
   - Calls `get_schedule(schedule_id)` on contract
   - Updates `claimed_amount` in DB
   - Updates `last_synced_at` timestamp
3. Logs sync stats to `vesting_sync_log` table

### Configuration

Set in `.env`:
```env
SOROBAN_VESTING_CONTRACT_ADDRESS=CABC...
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
PLATFORM_SECRET_KEY=SABC...
```

### Manual Trigger

To sync all schedules immediately:
```bash
npm run worker:sync-vesting
```

To sync a specific schedule (via API):
```typescript
import { scheduleVestingScheduleSync } from './queues/vesting-sync.queue';
await scheduleVestingScheduleSync(scheduleId);
```

---

## Security

### Authorization

- **Admin endpoints**: Require `admin` or `super_admin` role
- **Beneficiary endpoints**: Require authentication + ownership check
- **Public endpoints**: Read-only queries (no sensitive data)

### Smart Contract Security

- **Cliff validation**: Prevents gaming via short cliffs
- **Timestamp tolerance**: Absorbs validator clock drift
- **Replay protection**: Rejects stale `start` timestamps
- **Revocation**: Only admin can revoke schedules

### Database Security

- **Foreign keys**: Link to `users` table with `ON DELETE SET NULL`
- **Constraints**: Enforce valid amounts and timestamps
- **Indexes**: Optimized for common queries
- **Audit trail**: All claims logged in `vesting_claims`

---

## Common Operations

### Creating a Team Member Schedule

**Scenario**: Grant 100,000 XLM to an engineer with 3-month cliff and 4-year vesting.

```bash
curl -X POST https://api.mentorsmind.com/api/v1/admin/vesting/schedules \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "beneficiaryAddress": "GABC...",
    "beneficiaryUserId": "uuid-of-engineer",
    "totalAmount": "1000000000000",
    "cliffDuration": 7776000,
    "vestingDuration": 126144000,
    "vestingType": "team",
    "notes": "Senior Backend Engineer - hired Jan 2024"
  }'
```

**Durations:**
- Cliff: 3 months = 90 days × 86400 = 7,776,000 seconds
- Vesting: 4 years = 1461 days × 86400 = 126,144,000 seconds

### Checking Claimable Amount

**For beneficiary:**
```bash
curl https://api.mentorsmind.com/api/v1/vesting/my-schedules \
  -H "Authorization: Bearer $USER_TOKEN"
```

Look for `claimableNow` field.

### Claiming Tokens

```bash
curl -X POST https://api.mentorsmind.com/api/v1/vesting/schedules/1/claim \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Revoking a Schedule

**Scenario**: Employee leaves before vesting completes.

```bash
curl -X DELETE https://api.mentorsmind.com/api/v1/admin/vesting/schedules/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Voluntary resignation - effective March 2024"
  }'
```

Unvested tokens are returned to admin wallet.

---

## Troubleshooting

### Schedule Not Found After Creation

**Cause**: Sync delay or transaction failure.

**Solution:**
1. Check transaction hash in response
2. Verify transaction on Stellar explorer
3. Manually trigger sync: `await scheduleVestingScheduleSync(scheduleId)`

### Claimable Amount is 0

**Possible causes:**
1. Cliff not yet passed (check `isCliffPassed`)
2. All tokens already claimed (check `claimedAmount`)
3. Sync lag (trigger manual sync)

**Check:**
```bash
curl https://api.mentorsmind.com/api/v1/admin/vesting/schedules/:id \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### HTTP 422: Cliff duration too short

**Cause**: Cliff is < 3600 seconds (1 hour) and not 0.

**Solution**: Use `cliffDuration: 0` for no cliff, or `≥ 3600` for a cliff.

### HTTP 422: Vesting duration too short

**Cause**: Vesting is < 86400 seconds (1 day).

**Solution**: Use at least 86400 seconds (1 day) for vesting duration.

### Sync Worker Failures

**Check logs:**
```bash
docker logs mentorsmind-backend | grep "vesting-sync"
```

**Common issues:**
- RPC endpoint unreachable → check `SOROBAN_RPC_URL`
- Invalid contract address → verify `SOROBAN_VESTING_CONTRACT_ADDRESS`
- Rate limiting → reduce concurrency or add delays

**Manual recovery:**
```sql
-- Find schedules not synced in 24 hours
SELECT schedule_id, last_synced_at
FROM vesting_schedules
WHERE status = 'active'
  AND last_synced_at < NOW() - INTERVAL '24 hours';
```

Then trigger manual sync for each.

---

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SOROBAN_VESTING_CONTRACT_ADDRESS` | Yes | Deployed contract address | `CABC123...` |
| `SOROBAN_RPC_URL` | No | RPC endpoint; validated as a URL (default: testnet) | `https://soroban-testnet.stellar.org` |
| `PLATFORM_SECRET_KEY` | Yes, when a vesting contract is configured | Valid Stellar admin signing seed | `SABC123...` |
| `PLATFORM_PUBLIC_KEY` | No | Admin public key (derived if not set) | `GABC123...` |
| `STELLAR_NETWORK` | No | `testnet` or `mainnet` (default: testnet) | `testnet` |

---

## Testing

### Unit Tests

```bash
npm run test:vesting
```

### Integration Tests

```bash
npm run test:integration:vesting
```

### Manual Testing (Testnet)

1. Deploy contract to testnet
2. Set `SOROBAN_VESTING_CONTRACT_ADDRESS` in `.env.development`
3. Create a test schedule via API
4. Check DB: `SELECT * FROM vesting_schedules;`
5. Advance time (wait or use contract helpers)
6. Claim via API
7. Verify claim in `vesting_claims` table

---

## Monitoring

### Metrics to Track

- **Schedules created**: Count per day/week
- **Claims processed**: Count and total amount
- **Sync success rate**: `schedules_synced / (schedules_synced + schedules_failed)`
- **Sync latency**: `sync_duration_ms` from `vesting_sync_log`

### Alerts

Set up alerts for:
- Sync failures > 5% over 24 hours
- No sync completed in 12 hours
- Claims failing repeatedly

### Dashboard Queries

**Active schedules by type:**
```sql
SELECT vesting_type, COUNT(*)
FROM vesting_schedules
WHERE status = 'active'
GROUP BY vesting_type;
```

**Total vested value:**
```sql
SELECT SUM(claimed_amount) / 10000000.0 AS total_claimed_xlm
FROM vesting_schedules;
```

**Recent claims:**
```sql
SELECT *
FROM vesting_claims
ORDER BY claimed_at DESC
LIMIT 10;
```

---

## Future Enhancements

1. **Batch creation**: API to create multiple schedules at once
2. **CSV import**: Upload schedules from spreadsheet
3. **Email notifications**: Alert beneficiaries when cliff passes
4. **Vesting preview**: Calculate future claimable amounts
5. **Multi-token support**: Support different token types
6. **Partial revocation**: Revoke only unvested portion
7. **Transfer beneficiary**: Allow schedule transfer (requires contract upgrade)

---

## References

- [Soroban Documentation](https://soroban.stellar.org/docs)
- [Stellar SDK](https://github.com/stellar/js-stellar-sdk)
- [Vesting Contract Source](../contracts/vesting/src/lib.rs)
- [Backend Service](../src/services/vesting.service.ts)
- [API Routes](../src/routes/vesting.routes.ts)

---

## Support

For issues or questions:
- GitHub Issues: [mentorsmind/backend/issues](https://github.com/mentorsmind/backend/issues)
- Slack: `#vesting-support`
- Email: dev@mentorsmind.com
