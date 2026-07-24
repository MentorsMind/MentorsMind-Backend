# Referral System Quick Start Guide

## 🚀 5-Minute Setup

### 1. Run Database Migrations
```bash
cd database
migrate.bat  # Windows
# or
./migrate.sh  # Linux/Mac
```

This creates:
- `referral_codes` table
- `referral_events` table (audit trail)
- Adds `referred_by` to `users` table
- Adds `referral_reward` transaction type

### 2. Configure Environment
Add to your `.env`:
```bash
REFERRAL_REWARD_XLM=5.0
REFERRAL_HOLD_DAYS=7
```

### 3. Register Routes
In your main `app.ts` or `routes/index.ts`:
```typescript
import referralRoutes from './routes/referral.routes';

app.use('/api/v1/referrals', referralRoutes);
```

### 4. Start the Worker
In your worker startup file (e.g., `workers/index.ts`):
```typescript
import './referral-payout.worker';
```

### 5. Update User Registration
In your signup/registration endpoint:
```typescript
// After creating new user
if (req.body.referralCode) {
  await EnhancedReferralService.applyReferralCode(
    req.body.referralCode,
    newUser.id,
    {
      refereeEmail: newUser.email,
      refereeIp: req.ip,
      deviceFingerprint: req.headers['x-device-fingerprint'] as string
    }
  );
}
```

### 6. Test It!

#### Generate Your Referral Code
```bash
curl -X GET http://localhost:5000/api/v1/referrals/code \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Response:
```json
{
  "success": true,
  "data": {
    "code": "A3K9Z7M2",
    "shareUrl": "https://mentorsmind.com/signup?ref=A3K9Z7M2"
  }
}
```

#### Apply Referral Code
```bash
curl -X POST http://localhost:5000/api/v1/referrals/apply \
  -H "Authorization: Bearer NEW_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"referralCode": "A3K9Z7M2"}'
```

#### Check Your Stats
```bash
curl -X GET http://localhost:5000/api/v1/referrals/stats \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 📊 How It Works

### User Journey
```
1. User A gets referral code: A3K9Z7M2
2. User A shares: mentorsmind.com/signup?ref=A3K9Z7M2
3. User B signs up with code
   → Fraud detection runs
   → If valid: User B linked to User A
4. User B completes first booking
   → Reward qualification detected
   → Reward held for 7 days
5. After 7 days:
   → System verifies no disputes
   → Transfers 5 XLM to User A's Stellar wallet
   → Records in transactions table
```

### Fraud Detection
Automatically blocks:
- Self-referral (same user)
- Same IP address
- Same device fingerprint
- Accounts created <60 seconds apart
- Suspicious email patterns (user+1@)
- >10 referrals in 24 hours
- Disposable email providers
- IP used by >5 accounts

**Risk threshold**: Score ≥70 = Rejected

## 🔍 Monitoring

### Check Fraud Detection Rate
```sql
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN array_length(fraud_flags, 1) > 0 THEN 1 END) as blocked,
  COUNT(CASE WHEN array_length(fraud_flags, 1) > 0 THEN 1 END) * 100.0 / COUNT(*) as fraud_rate
FROM referral_events
WHERE event_type = 'code_applied'
AND created_at > NOW() - INTERVAL '7 days';
```

### View Pending Payouts
```sql
SELECT 
  re.referrer_id,
  u.email as referrer_email,
  re.reward_amount,
  re.payout_scheduled_at,
  re.payout_scheduled_at - NOW() as time_until_payout
FROM referral_events re
JOIN users u ON re.referrer_id = u.id
WHERE re.reward_status = 'held'
ORDER BY re.payout_scheduled_at;
```

### Check Payout Success Rate
```sql
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN reward_status = 'paid' THEN 1 END) as successful,
  COUNT(CASE WHEN reward_status = 'rejected' THEN 1 END) as failed
FROM referral_events
WHERE event_type = 'reward_paid'
AND created_at > NOW() - INTERVAL '30 days';
```

## 🐛 Troubleshooting

### "Referral code applied successfully" but no reward later?

**Check if it was the user's first booking:**
```sql
SELECT COUNT(*) FROM bookings 
WHERE (mentee_id = 'USER_ID' OR mentor_id = 'USER_ID')
AND status = 'completed';
```
Only first booking triggers reward.

### Reward not paid after 7 days?

**Check worker logs:**
```bash
# Look for: "Referral payout job completed"
grep "referral payout" logs/worker.log
```

**Check queue:**
```typescript
const jobs = await referralRewardQueue.getJobs(['delayed', 'waiting']);
console.log(jobs);
```

**Check for disputes:**
```sql
SELECT * FROM disputes 
WHERE booking_id = 'BOOKING_ID'
AND status IN ('pending', 'investigating');
```

### Legitimate user blocked?

**View fraud flags:**
```sql
SELECT fraud_flags, metadata 
FROM referral_events 
WHERE referee_id = 'USER_ID'
AND event_type = 'fraud_detected';
```

**Manual override** (use carefully):
```sql
UPDATE users 
SET referred_by = 'REFERRER_ID' 
WHERE id = 'REFEREE_ID';
```

## 📈 Key Metrics

Track these in your analytics dashboard:

1. **Conversion Rate**: Code Applied → First Booking
2. **Fraud Detection Rate**: Blocked / Total (target: 95%+)
3. **Payout Success Rate**: Paid / Scheduled (target: 98%+)
4. **Average Time to Conversion**: Days from code applied to first booking
5. **Total Rewards Paid**: Sum of all successful payouts

## 🎯 API Endpoints Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/referrals/code` | GET | Get/create your referral code |
| `/api/v1/referrals/apply` | POST | Apply a referral code |
| `/api/v1/referrals/stats` | GET | View earnings (total, pending, paid) |
| `/api/v1/referrals/history` | GET | View all referral events |

All endpoints require authentication (JWT token).

## 🔐 Security Notes

1. **Rate Limit** the `/apply` endpoint (suggested: 5 attempts per hour per IP)
2. **Validate** referral codes are uppercase, 8 characters, alphanumeric
3. **Log** all fraud detection events for analysis
4. **Monitor** for unusual patterns (e.g., one referrer with 100+ referrals)
5. **Review** high-earning referrers manually

## 📚 Full Documentation

For complete details, see:
- `docs/REFERRAL_PROGRAM.md` - Full program documentation
- `IMPLEMENTATION_SUMMARY.md` - Technical implementation details

## 💡 Tips

- **Promote your code**: Add it to email signatures, social media profiles
- **Track performance**: Use the `/stats` endpoint regularly
- **Encourage quality**: Reward referrers who bring active users
- **Test fraud detection**: Try self-referral to see it blocked
- **Monitor payouts**: Check BullMQ dashboard for queue health

---

**Questions?** Check the full documentation or contact the engineering team.

**Version**: 1.0.0  
**Last Updated**: 2026-07-24
