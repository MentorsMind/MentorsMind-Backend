# Referral Program Documentation

## Overview

The MentorsMind Referral Program rewards users who bring new mentors and learners to the platform. When a referred user completes their first paid session, the referrer receives **5 XLM** (configurable) as a reward via Stellar blockchain transaction.

## Key Features

### 1. Referral Codes
- **8-character alphanumeric codes** (e.g., `A3K9Z7M2`)
- Automatically generated for each user
- Can have usage limits and expiration dates
- Shareable via URL: `https://mentorsmind.com/signup?ref=A3K9Z7M2`

### 2. Fraud Detection
The system implements comprehensive fraud prevention to block self-referral and account farming:

#### Fraud Detection Rules
1. **Self-Referral Block**: Instant rejection if referrer and referee are the same user
2. **IP Address Matching**: Rejects if referee IP matches referrer's last 5 login IPs
3. **Device Fingerprint**: Blocks same device usage across accounts
4. **Rapid Account Creation**: Flags accounts created within 60 seconds of each other
5. **Email Pattern Detection**: Identifies suspicious patterns like `user+1@example.com`
6. **Velocity Limits**: Blocks referrers with >10 referrals in 24 hours
7. **Disposable Emails**: Rejects common temporary email providers
8. **IP Abuse Detection**: Flags IPs used by >5 referee accounts in 7 days

#### Risk Scoring
- Each fraud indicator adds to a risk score (0-100)
- Threshold: **Risk Score ≥ 70 = Rejected**
- Fraud flags are logged in `referral_events` table for audit

### 3. Reward Payout Process

#### Timeline
```
Day 0: Referee completes first paid session
  ↓
  Reward qualification detected
  ↓
  Reward status: HELD (7-day hold period)
  ↓
Day 7: Payout job executes
  ↓
  Verification checks:
  - Booking still completed
  - No disputes/chargebacks
  - Referrer has valid Stellar wallet
  ↓
  Stellar XLM transfer
  ↓
  Reward status: PAID
```

#### Payout Verification
Before payout, the system verifies:
1. **Booking Status**: Must still be "completed"
2. **Dispute Check**: No pending/active disputes on the booking
3. **Stellar Wallet**: Referrer must have valid `stellar_public_key`
4. **Chargeback Protection**: 7-day hold allows time for payment disputes

#### Retry Logic
- **Max Attempts**: 5
- **Backoff**: Exponential (5s → 10s → 20s → 40s → 80s)
- **Failure Scenarios**:
  - Stellar network down → Retry
  - Dispute detected → Delay another 7 days
  - Max retries exceeded → Mark as rejected

### 4. Reward Recording
All successful payouts are recorded in two tables:

#### `transactions` Table
```sql
{
  user_id: referrer_id,
  type: 'referral_reward',
  status: 'completed',
  amount: 5.0,
  currency: 'XLM',
  stellar_tx_hash: 'abc123...',
  booking_id: qualifying_booking_id,
  metadata: {
    referee_id: '...',
    reward_type: 'first_booking'
  }
}
```

#### `referral_events` Table
Full audit trail with:
- Event type: `code_generated`, `code_applied`, `reward_qualified`, `reward_held`, `reward_paid`, `fraud_detected`
- Fraud flags
- Payout timestamps
- Stellar transaction hash

## API Endpoints

### GET `/api/v1/referrals/code`
Get or create referral code for authenticated user.

**Response:**
```json
{
  "success": true,
  "data": {
    "code": "A3K9Z7M2",
    "usesRemaining": null,
    "currentUses": 5,
    "expiresAt": null,
    "shareUrl": "https://mentorsmind.com/signup?ref=A3K9Z7M2"
  }
}
```

### POST `/api/v1/referrals/apply`
Apply referral code during user registration.

**Request:**
```json
{
  "referralCode": "A3K9Z7M2"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Referral code applied successfully"
}
```

**Response (Fraud Detected):**
```json
{
  "success": false,
  "message": "Referral cannot be applied due to suspicious activity",
  "fraudFlags": ["same_ip", "rapid_creation"]
}
```

### GET `/api/v1/referrals/stats`
Get referral statistics for authenticated user.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalEarnings": 50.0,
    "pendingRewards": 15.0,
    "paidRewards": 35.0,
    "totalReferrals": 10,
    "successfulReferrals": 7,
    "failedReferrals": 1,
    "averageReward": 5.0
  }
}
```

### GET `/api/v1/referrals/history`
Get referral event history with pagination.

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 20)

**Response:**
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "uuid",
        "eventType": "reward_paid",
        "rewardAmount": 5.0,
        "rewardCurrency": "XLM",
        "rewardStatus": "paid",
        "payoutScheduledAt": "2026-07-17T12:00:00Z",
        "payoutCompletedAt": "2026-07-24T12:05:23Z",
        "stellarTxHash": "abc123...",
        "fraudFlags": [],
        "createdAt": "2026-07-10T12:00:00Z",
        "referee": {
          "firstName": "Jane",
          "lastName": "Doe",
          "email": "jane@example.com"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 10
    }
  }
}
```

## Configuration

### Environment Variables

Add to `.env`:

```bash
# Referral Reward Configuration
REFERRAL_REWARD_XLM=5.0          # XLM amount per successful referral
REFERRAL_HOLD_DAYS=7             # Days to hold reward before payout
```

### Database Migrations

Run in order:
1. `112_referral_codes_and_events.sql` - Creates core tables
2. `113_add_referral_reward_transaction_type.sql` - Adds transaction type enum

```bash
# Windows
cd database
migrate.bat

# Linux/Mac
cd database
./migrate.sh
```

## Integration Points

### 1. User Registration
When a user signs up with a referral code:
```typescript
await EnhancedReferralService.applyReferralCode(
  referralCode,
  newUserId,
  {
    refereeEmail: user.email,
    refereeIp: req.ip,
    deviceFingerprint: req.headers['x-device-fingerprint']
  }
);
```

### 2. Booking Completion
Automatically triggered in `bookings.service.ts`:
```typescript
// After booking marked as completed
EnhancedReferralService.processReferralReward(bookingId, userId);
```

### 3. Worker Process
Start the referral payout worker:
```typescript
import "./workers/referral-payout.worker";
```

## Fraud Detection Performance

### Target: ≥95% synthetic abuse detection

Test scenarios and expected results:

| Scenario | Detection Method | Expected Outcome |
|----------|-----------------|------------------|
| Self-referral (same user ID) | Direct comparison | ✅ 100% blocked |
| Same IP address | Last 5 login IPs | ✅ 100% blocked |
| Same device fingerprint | Device metadata | ✅ 100% blocked |
| Accounts created 30s apart | Timestamp comparison | ✅ 100% blocked |
| Email pattern (user+1@...) | Regex + base comparison | ✅ 100% blocked |
| 15 referrals in 1 hour | Velocity limiting | ✅ 100% blocked |
| Disposable email | Domain blacklist | ✅ 100% blocked |
| 10 accounts from same IP | IP abuse detection | ✅ 100% blocked |

## Monitoring and Analytics

### Key Metrics to Track
1. **Conversion Rate**: Referrals → First Booking
2. **Fraud Detection Rate**: Blocked / Total Attempts
3. **Payout Success Rate**: Successful / Total Scheduled
4. **Average Time to Conversion**: Code Applied → First Booking
5. **Top Referrers**: Users with most successful referrals

### Database Queries

#### Fraud Detection Statistics
```sql
SELECT 
  COUNT(*) as total_attempts,
  COUNT(CASE WHEN array_length(fraud_flags, 1) > 0 THEN 1 END) as fraud_detected,
  COUNT(CASE WHEN array_length(fraud_flags, 1) > 0 THEN 1 END) * 100.0 / COUNT(*) as fraud_rate
FROM referral_events
WHERE event_type = 'code_applied'
AND created_at > NOW() - INTERVAL '30 days';
```

#### Payout Success Rate
```sql
SELECT 
  COUNT(*) as total_payouts,
  COUNT(CASE WHEN reward_status = 'paid' THEN 1 END) as successful,
  COUNT(CASE WHEN reward_status = 'rejected' THEN 1 END) as failed,
  COUNT(CASE WHEN reward_status = 'paid' THEN 1 END) * 100.0 / COUNT(*) as success_rate
FROM referral_events
WHERE event_type = 'reward_paid'
AND created_at > NOW() - INTERVAL '30 days';
```

## Security Considerations

### 1. Rate Limiting
- Apply rate limits to referral code application endpoint
- Prevent brute-force code guessing

### 2. IP Spoofing
- Use `X-Forwarded-For` header carefully
- Validate with request origin

### 3. Device Fingerprinting
- Implement client-side fingerprinting
- Send via `X-Device-Fingerprint` header

### 4. Audit Logging
- All events logged in `referral_events`
- Fraud attempts logged for analysis
- IP addresses stored for investigation

## Troubleshooting

### Issue: Reward not paid after 7 days

**Check:**
1. Worker process running: `referral-payout.worker.ts`
2. Queue job scheduled: Check BullMQ dashboard
3. Stellar wallet valid: `SELECT stellar_public_key FROM users WHERE id = ?`
4. No disputes: `SELECT * FROM disputes WHERE booking_id = ?`

### Issue: Legitimate referral blocked

**Check fraud flags:**
```sql
SELECT fraud_flags, metadata 
FROM referral_events 
WHERE referee_id = ? 
AND event_type = 'fraud_detected';
```

**Resolution:**
- Review fraud flags
- Adjust risk thresholds if needed
- Manual override: Update `users.referred_by` directly

### Issue: Payout failed with Stellar error

**Check transaction logs:**
```sql
SELECT * FROM referral_events 
WHERE referrer_id = ?
AND event_type = 'reward_paid'
ORDER BY created_at DESC;
```

**Common causes:**
1. Stellar network downtime → Auto-retry
2. Invalid Stellar address → Update user wallet
3. Insufficient platform balance → Fund platform wallet

## Future Enhancements

### Planned Features
1. **Tiered Rewards**: Higher rewards for referrers who bring multiple users
2. **Referral Campaigns**: Time-limited bonus rewards
3. **Two-Sided Rewards**: Bonus for both referrer and referee
4. **Milestone Bonuses**: Extra rewards at 10, 50, 100 referrals
5. **Referral Leaderboard**: Gamification and top referrer showcase

### Performance Optimizations
1. **Batch Payouts**: Process multiple rewards in single Stellar transaction
2. **Cache Warming**: Pre-compute referral stats
3. **Async Validation**: Move fraud checks to background job

---

**Last Updated**: 2026-07-24
**Version**: 1.0
**Maintainer**: MentorsMind Engineering Team
