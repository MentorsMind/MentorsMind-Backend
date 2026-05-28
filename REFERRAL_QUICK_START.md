# Referral Program - Quick Start Guide

## 🚀 Getting Started in 5 Minutes

### Step 1: Run Database Migration
```bash
psql -U postgres -d mentorsmind -f database/migrations/024_referral_program.sql
```

### Step 2: Configure Environment Variables
Add to your `.env` file:
```bash
# Stellar Network (use testnet for development)
STELLAR_NETWORK=testnet
STELLAR_SECRET_KEY=your_secret_key_here
STELLAR_PUBLIC_KEY=your_public_key_here
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org

# Referral Configuration
REFERRAL_CODE_LENGTH=8
REFERRAL_MIN_PAYOUT=10.0
ENABLE_REFERRAL_SYSTEM=true
```

### Step 3: Start Your Server
```bash
npm run dev
```

### Step 4: Test the API
```bash
# Get reward tiers (no auth required)
curl http://localhost:3000/api/v1/referrals/tiers

# Create referral code (requires auth)
curl -X POST http://localhost:3000/api/v1/referrals/codes \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"codeType": "personal"}'
```

## 📋 API Endpoints Cheat Sheet

### Referral Codes
```
POST   /api/v1/referrals/codes              Create code
GET    /api/v1/referrals/codes              Get user's codes
GET    /api/v1/referrals/codes/:code/validate   Validate code
```

### Referrals
```
POST   /api/v1/referrals/apply              Apply referral code
GET    /api/v1/referrals                    Get user's referrals
GET    /api/v1/referrals/stats              Get statistics
PUT    /api/v1/referrals/:id                Update referral (admin)
```

### Affiliate Program
```
POST   /api/v1/referrals/affiliate          Create profile
GET    /api/v1/referrals/affiliate/:userId  Get profile
PUT    /api/v1/referrals/affiliate/:userId  Update profile
GET    /api/v1/referrals/affiliate/:userId/dashboard   Get dashboard
POST   /api/v1/referrals/affiliate/:userId/approve     Approve (admin)
```

### Rewards & Payouts
```
GET    /api/v1/referrals/tiers              Get reward tiers
POST   /api/v1/referrals/affiliate/:userId/payout   Request payout (admin)
```


## 🎯 Common Use Cases

### Use Case 1: User Shares Referral Code
```typescript
// 1. User gets their referral code
GET /api/v1/referrals/codes
Response: { code: "MENTOR2024", ... }

// 2. Share link: https://mentorsmind.com/signup?ref=MENTOR2024
```

### Use Case 2: New User Signs Up with Referral
```typescript
// 1. Validate code during signup
GET /api/v1/referrals/codes/MENTOR2024/validate
Response: { valid: true }

// 2. After user registers, apply code
POST /api/v1/referrals/apply
Body: { referralCode: "MENTOR2024", referredEmail: "new@example.com" }
```

### Use Case 3: Track Conversion
```typescript
// When user completes qualifying action (e.g., first booking)
PUT /api/v1/referrals/:referralId
Body: {
  status: "completed",
  conversionType: "first_booking",
  referredUserId: "user-uuid"
}
// Reward automatically calculated and assigned
```

### Use Case 4: Affiliate Checks Dashboard
```typescript
GET /api/v1/referrals/affiliate/:userId/dashboard
Response: {
  profile: { totalEarnings: 750.5, tier: "Gold", ... },
  stats: { conversionRate: 70.0, nextPayout: "2024-02-01", ... },
  recentReferrals: [...],
  recentPayouts: [...]
}
```

## 🏆 Reward Tiers

| Tier | Referrals | Multiplier | Bonus |
|------|-----------|------------|-------|
| 🥉 Bronze | 0-9 | 1.0x | 0 XLM |
| 🥈 Silver | 10-24 | 1.2x | 50 XLM |
| 🥇 Gold | 25-49 | 1.5x | 150 XLM |
| 💎 Platinum | 50-99 | 2.0x | 500 XLM |
| 👑 Diamond | 100+ | 3.0x | 2000 XLM |

**Tiers update automatically!**

## 💰 Default Rewards

| Event | Referrer | Referred |
|-------|----------|----------|
| User Signup | 5 XLM | 2 XLM |
| Mentor Signup | 20 XLM | 10 XLM |
| First Booking | 10 XLM | - |
| Subscription | 15 XLM | - |
| Course Complete | 8 XLM | - |
| Certification | 25 XLM | - |

**Example**: Gold tier (1.5x) mentor signup = 20 × 1.5 = **30 XLM**


## 🔧 Frontend Integration

### React Component Example
```typescript
import { useState, useEffect } from 'react';

function ReferralDashboard() {
  const [dashboard, setDashboard] = useState(null);
  
  useEffect(() => {
    fetch(`/api/v1/referrals/affiliate/${userId}/dashboard`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setDashboard(data.data));
  }, []);
  
  if (!dashboard) return <div>Loading...</div>;
  
  return (
    <div>
      <h2>Affiliate Dashboard</h2>
      
      {/* Tier Badge */}
      <div className="tier-badge">
        {dashboard.tier.name} Tier
        <span>{dashboard.tier.rewardMultiplier}x multiplier</span>
      </div>
      
      {/* Stats */}
      <div className="stats">
        <div>Total Referrals: {dashboard.stats.totalReferrals}</div>
        <div>Conversion Rate: {dashboard.stats.conversionRate}%</div>
        <div>Total Earnings: {dashboard.stats.totalEarnings} XLM</div>
        <div>Pending: {dashboard.stats.pendingEarnings} XLM</div>
      </div>
      
      {/* Next Tier Progress */}
      {dashboard.nextTier && (
        <div className="progress">
          <p>Next Tier: {dashboard.nextTier.name}</p>
          <p>{dashboard.referralsToNextTier} more referrals needed</p>
          <progress 
            value={dashboard.profile.successfulReferrals} 
            max={dashboard.nextTier.minReferrals}
          />
        </div>
      )}
      
      {/* Recent Referrals */}
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Status</th>
            <th>Reward</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.recentReferrals.map(ref => (
            <tr key={ref.id}>
              <td>{ref.referredEmail}</td>
              <td>{ref.status}</td>
              <td>{ref.rewardAmount} XLM</td>
              <td>{new Date(ref.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### Signup Flow Integration
```typescript
// Extract referral code from URL
const urlParams = new URLSearchParams(window.location.search);
const referralCode = urlParams.get('ref');

if (referralCode) {
  // Validate code
  const response = await fetch(
    `/api/v1/referrals/codes/${referralCode}/validate`
  );
  const { data } = await response.json();
  
  if (data.valid) {
    // Show bonus message
    showMessage(`Sign up with code ${referralCode} and earn 2 XLM!`);
    
    // Store for later
    localStorage.setItem('referralCode', referralCode);
  }
}

// After successful registration
const storedCode = localStorage.getItem('referralCode');
if (storedCode) {
  await fetch('/api/v1/referrals/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      referralCode: storedCode,
      referredEmail: userEmail
    })
  });
  localStorage.removeItem('referralCode');
}
```


## 🐛 Troubleshooting

### Issue: "User already has an active referral code"
**Solution**: Each user can only have one active personal code. Use campaign codes for multiple codes.

### Issue: "Invalid or expired referral code"
**Check**:
```sql
SELECT code, is_active, expires_at, current_uses, max_uses 
FROM referral_codes 
WHERE code = 'YOUR_CODE';
```

### Issue: Rewards not being assigned
**Check**:
```sql
-- Verify reward configuration exists
SELECT * FROM reward_configurations WHERE event_type = 'user_signup';

-- Check if referral was updated to completed
SELECT status, conversion_type, reward_amount 
FROM referrals 
WHERE id = 'referral-uuid';
```

### Issue: Tier not updating
**Solution**: Tiers update automatically via trigger. Manually trigger:
```sql
UPDATE affiliate_profiles 
SET successful_referrals = successful_referrals 
WHERE user_id = 'user-uuid';
```

## 📊 Useful Queries

### Check User's Referral Performance
```sql
SELECT 
  u.email,
  COUNT(r.id) as total_referrals,
  COUNT(CASE WHEN r.status = 'completed' THEN 1 END) as completed,
  COALESCE(SUM(r.reward_amount), 0) as total_rewards
FROM users u
LEFT JOIN referrals r ON u.id = r.referrer_id
WHERE u.id = 'user-uuid'
GROUP BY u.email;
```

### View Pending Payouts
```sql
SELECT 
  ap.user_id,
  u.email,
  ap.pending_earnings,
  ap.payment_schedule,
  ap.minimum_payout
FROM affiliate_profiles ap
JOIN users u ON ap.user_id = u.id
WHERE ap.status = 'active'
  AND ap.pending_earnings >= ap.minimum_payout
ORDER BY ap.pending_earnings DESC;
```

### Top Performers
```sql
SELECT 
  u.email,
  ap.successful_referrals,
  ap.total_earnings,
  rt.name as tier
FROM affiliate_profiles ap
JOIN users u ON ap.user_id = u.id
LEFT JOIN reward_tiers rt ON ap.tier_id = rt.id
WHERE ap.status = 'active'
ORDER BY ap.total_earnings DESC
LIMIT 10;
```

## 📚 Documentation

- **Full Documentation**: `REFERRAL_PROGRAM_DOCUMENTATION.md` (56 pages)
- **Implementation Summary**: `REFERRAL_IMPLEMENTATION_SUMMARY.md`
- **This Guide**: `REFERRAL_QUICK_START.md`

## 🆘 Need Help?

- **API Issues**: Check logs in `logs/` directory
- **Database Issues**: Review migration file `024_referral_program.sql`
- **Integration Help**: See full documentation
- **Bug Reports**: Create issue in repository

---

**Quick Links**:
- Database Migration: `database/migrations/024_referral_program.sql`
- Models: `src/models/referral.model.ts`
- Services: `src/services/referral.service.ts`, `src/services/affiliate.service.ts`
- Controller: `src/controllers/referral.controller.ts`
- Routes: `src/routes/referral.routes.ts`

**Status**: ✅ Ready for Production  
**Version**: 1.0.0
