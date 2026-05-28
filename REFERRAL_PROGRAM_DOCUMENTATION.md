# Referral and Affiliate Program Documentation

## Overview

The MentorsMind Referral and Affiliate Program is a comprehensive growth incentive system that rewards users for bringing new members to the platform. The system includes referral code generation, conversion tracking, tiered rewards, affiliate profiles, and automated XLM token payouts.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Database Schema](#database-schema)
3. [API Endpoints](#api-endpoints)
4. [Referral Flow](#referral-flow)
5. [Affiliate Program](#affiliate-program)
6. [Reward Tiers](#reward-tiers)
7. [Payout System](#payout-system)
8. [Integration Guide](#integration-guide)
9. [Security Considerations](#security-considerations)
10. [Testing](#testing)

## System Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Referral System                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Referral   │  │  Affiliate   │  │   Reward     │    │
│  │   Service    │  │   Service    │  │   System     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│         │                  │                  │            │
│         └──────────────────┴──────────────────┘            │
│                           │                                │
│                  ┌────────▼────────┐                       │
│                  │   PostgreSQL    │                       │
│                  │    Database     │                       │
│                  └─────────────────┘                       │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Webhook    │  │    Cache     │  │   Stellar    │    │
│  │   Service    │  │   Service    │  │   Payment    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Features

- **Referral Code Generation**: Unique, collision-resistant codes
- **Multi-Type Codes**: Personal, campaign, and affiliate codes
- **Conversion Tracking**: Track referrals from signup to completion
- **Tiered Rewards**: Bronze to Diamond tiers with increasing benefits
- **Automated Payouts**: Scheduled XLM token distributions
- **Analytics Dashboard**: Real-time performance metrics
- **Webhook Integration**: Real-time event notifications


## Database Schema

### Core Tables

#### 1. referral_codes
Stores unique referral codes for users.

```sql
CREATE TABLE referral_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(50) UNIQUE NOT NULL,
  code_type VARCHAR(20) DEFAULT 'personal',
  is_active BOOLEAN DEFAULT true,
  max_uses INTEGER,
  current_uses INTEGER DEFAULT 0,
  expires_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Fields:**
- `code_type`: 'personal', 'campaign', 'affiliate'
- `max_uses`: NULL for unlimited uses
- `metadata`: Custom data (campaign info, source, etc.)

#### 2. referrals
Tracks individual referral conversions.

```sql
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code_id UUID NOT NULL REFERENCES referral_codes(id),
  referred_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  referred_email VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  conversion_type VARCHAR(50),
  reward_amount DECIMAL(20, 7) DEFAULT 0,
  reward_currency VARCHAR(10) DEFAULT 'XLM',
  reward_paid BOOLEAN DEFAULT false,
  reward_paid_at TIMESTAMP,
  reward_transaction_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  registered_at TIMESTAMP,
  completed_at TIMESTAMP,
  expires_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);
```

**Status Flow:**
1. `pending` - Referral code applied, user not registered
2. `registered` - User created account
3. `completed` - User completed qualifying action
4. `expired` - Referral expired before completion
5. `cancelled` - Referral cancelled


#### 3. reward_tiers
Defines reward tiers based on referral performance.

```sql
CREATE TABLE reward_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL,
  tier_level INTEGER NOT NULL,
  min_referrals INTEGER NOT NULL,
  max_referrals INTEGER,
  reward_multiplier DECIMAL(5, 2) DEFAULT 1.00,
  bonus_amount DECIMAL(20, 7) DEFAULT 0,
  bonus_currency VARCHAR(10) DEFAULT 'XLM',
  perks JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Default Tiers:**
- Bronze (0-9 referrals): 1.0x multiplier
- Silver (10-24 referrals): 1.2x multiplier + 50 XLM bonus
- Gold (25-49 referrals): 1.5x multiplier + 150 XLM bonus
- Platinum (50-99 referrals): 2.0x multiplier + 500 XLM bonus
- Diamond (100+ referrals): 3.0x multiplier + 2000 XLM bonus

#### 4. affiliate_profiles
Extended profiles for affiliate program participants.

```sql
CREATE TABLE affiliate_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending',
  tier_id UUID REFERENCES reward_tiers(id),
  total_referrals INTEGER DEFAULT 0,
  successful_referrals INTEGER DEFAULT 0,
  total_earnings DECIMAL(20, 7) DEFAULT 0,
  total_earnings_currency VARCHAR(10) DEFAULT 'XLM',
  pending_earnings DECIMAL(20, 7) DEFAULT 0,
  paid_earnings DECIMAL(20, 7) DEFAULT 0,
  conversion_rate DECIMAL(5, 2) DEFAULT 0,
  payment_method VARCHAR(50) DEFAULT 'stellar',
  stellar_address VARCHAR(255),
  payment_schedule VARCHAR(20) DEFAULT 'monthly',
  minimum_payout DECIMAL(20, 7) DEFAULT 10.00,
  approved_at TIMESTAMP,
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Status Values:**
- `pending` - Application submitted, awaiting approval
- `active` - Approved and active
- `suspended` - Temporarily suspended
- `terminated` - Permanently terminated


#### 5. reward_configurations
Defines reward amounts for different conversion types.

```sql
CREATE TABLE reward_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type VARCHAR(50) NOT NULL UNIQUE,
  referrer_reward DECIMAL(20, 7) NOT NULL,
  referred_reward DECIMAL(20, 7) DEFAULT 0,
  reward_currency VARCHAR(10) DEFAULT 'XLM',
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Default Configurations:**
- `user_signup`: 5 XLM (referrer), 2 XLM (referred)
- `mentor_signup`: 20 XLM (referrer), 10 XLM (referred)
- `first_booking`: 10 XLM (referrer)
- `subscription_purchase`: 15 XLM (referrer)
- `course_completion`: 8 XLM (referrer)
- `mentor_certification`: 25 XLM (referrer)

#### 6. reward_payouts
Tracks payout transactions.

```sql
CREATE TABLE reward_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  affiliate_id UUID NOT NULL REFERENCES affiliate_profiles(id),
  payout_type VARCHAR(50) NOT NULL,
  amount DECIMAL(20, 7) NOT NULL,
  currency VARCHAR(10) DEFAULT 'XLM',
  status VARCHAR(20) DEFAULT 'pending',
  payment_method VARCHAR(50) DEFAULT 'stellar',
  stellar_address VARCHAR(255),
  transaction_hash VARCHAR(255),
  processed_at TIMESTAMP,
  completed_at TIMESTAMP,
  failed_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Status Flow:**
1. `pending` - Payout requested
2. `processing` - Payment being processed
3. `completed` - Successfully paid
4. `failed` - Payment failed
5. `cancelled` - Payout cancelled


## API Endpoints

### Referral Code Management

#### Create Referral Code
```http
POST /api/v1/referrals/codes
Authorization: Bearer <token>
Content-Type: application/json

{
  "codeType": "personal",
  "customCode": "MENTOR2024",
  "maxUses": 100,
  "expiresAt": "2024-12-31T23:59:59Z",
  "metadata": {
    "campaign": "winter-2024",
    "source": "email"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "code": "MENTOR2024",
    "codeType": "personal",
    "isActive": true,
    "maxUses": 100,
    "currentUses": 0,
    "expiresAt": "2024-12-31T23:59:59Z",
    "metadata": {},
    "createdAt": "2024-01-15T10:00:00Z"
  }
}
```

#### Get User's Referral Codes
```http
GET /api/v1/referrals/codes
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "MENTOR2024",
      "codeType": "personal",
      "currentUses": 15,
      "maxUses": 100,
      "isActive": true
    }
  ]
}
```

#### Validate Referral Code
```http
GET /api/v1/referrals/codes/MENTOR2024/validate
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "code": "MENTOR2024",
    "codeType": "personal"
  }
}
```


### Referral Tracking

#### Apply Referral Code
```http
POST /api/v1/referrals/apply
Content-Type: application/json

{
  "referralCode": "MENTOR2024",
  "referredEmail": "newuser@example.com",
  "metadata": {
    "source": "landing-page",
    "campaign": "winter-2024"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "referrerId": "uuid",
    "referralCodeId": "uuid",
    "referredEmail": "newuser@example.com",
    "status": "pending",
    "createdAt": "2024-01-15T10:00:00Z"
  }
}
```

#### Get User's Referrals
```http
GET /api/v1/referrals?status=completed
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "referredEmail": "user@example.com",
      "status": "completed",
      "conversionType": "mentor_signup",
      "rewardAmount": 20.0,
      "rewardCurrency": "XLM",
      "rewardPaid": true,
      "createdAt": "2024-01-10T10:00:00Z",
      "completedAt": "2024-01-12T15:30:00Z"
    }
  ]
}
```

#### Get Referral Statistics
```http
GET /api/v1/referrals/stats
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalReferrals": 50,
    "successfulReferrals": 35,
    "pendingReferrals": 15,
    "totalEarnings": 750.5,
    "conversionRate": 70.0,
    "recentActivity": [
      {
        "date": "2024-01-15",
        "referrals": 5,
        "conversions": 3
      }
    ]
  }
}
```


### Affiliate Program

#### Create Affiliate Profile
```http
POST /api/v1/referrals/affiliate
Authorization: Bearer <token>
Content-Type: application/json

{
  "stellarAddress": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "paymentSchedule": "monthly",
  "minimumPayout": 10.0
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "status": "pending",
    "stellarAddress": "GXXXXXXX...",
    "paymentSchedule": "monthly",
    "minimumPayout": 10.0,
    "totalEarnings": 0,
    "createdAt": "2024-01-15T10:00:00Z"
  }
}
```

#### Get Affiliate Dashboard
```http
GET /api/v1/referrals/affiliate/{userId}/dashboard
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "status": "active",
      "totalReferrals": 50,
      "successfulReferrals": 35,
      "totalEarnings": 750.5,
      "pendingEarnings": 125.0,
      "paidEarnings": 625.5,
      "conversionRate": 70.0
    },
    "stats": {
      "totalReferrals": 50,
      "successfulReferrals": 35,
      "pendingReferrals": 15,
      "conversionRate": 70.0,
      "totalEarnings": 750.5,
      "pendingEarnings": 125.0,
      "paidEarnings": 625.5,
      "nextPayout": "2024-02-01T00:00:00Z",
      "nextPayoutAmount": 125.0
    },
    "tier": {
      "id": "uuid",
      "name": "Gold",
      "tierLevel": 3,
      "rewardMultiplier": 1.5,
      "bonusAmount": 150.0
    },
    "nextTier": {
      "name": "Platinum",
      "minReferrals": 50
    },
    "referralsToNextTier": 15,
    "recentReferrals": [],
    "recentPayouts": []
  }
}
```


#### Get Reward Tiers
```http
GET /api/v1/referrals/tiers
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Bronze",
      "tierLevel": 1,
      "minReferrals": 0,
      "maxReferrals": 9,
      "rewardMultiplier": 1.0,
      "bonusAmount": 0,
      "perks": ["Basic dashboard access"]
    },
    {
      "id": "uuid",
      "name": "Silver",
      "tierLevel": 2,
      "minReferrals": 10,
      "maxReferrals": 24,
      "rewardMultiplier": 1.2,
      "bonusAmount": 50.0,
      "perks": ["Priority support", "Custom referral codes"]
    }
  ]
}
```

#### Request Payout (Admin)
```http
POST /api/v1/referrals/affiliate/{userId}/payout
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "amount": 125.0,
  "payoutType": "referral",
  "metadata": {
    "period": "2024-01",
    "note": "Monthly payout"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "affiliateId": "uuid",
    "amount": 125.0,
    "currency": "XLM",
    "status": "pending",
    "paymentMethod": "stellar",
    "stellarAddress": "GXXXXXXX...",
    "createdAt": "2024-02-01T00:00:00Z"
  }
}
```


## Referral Flow

### Complete User Journey

```
┌─────────────────────────────────────────────────────────────┐
│                    Referral Journey                         │
└─────────────────────────────────────────────────────────────┘

1. REFERRER CREATES CODE
   ├─ User requests referral code
   ├─ System generates unique code (e.g., "MENTOR2024")
   └─ Code stored in referral_codes table

2. REFERRER SHARES CODE
   ├─ Share via email, social media, or direct link
   └─ Link format: https://mentorsmind.com/signup?ref=MENTOR2024

3. REFERRED USER APPLIES CODE
   ├─ User clicks referral link
   ├─ Code validated (not expired, under max uses)
   ├─ Referral record created (status: pending)
   └─ Code usage incremented

4. REFERRED USER REGISTERS
   ├─ User completes signup
   ├─ Referral updated (status: registered)
   ├─ referred_user_id linked
   └─ Webhook: referral.registered

5. CONVERSION EVENT OCCURS
   ├─ User completes qualifying action (booking, subscription, etc.)
   ├─ Referral updated (status: completed)
   ├─ Reward amount calculated based on conversion type
   └─ Webhook: referral.completed

6. REWARD ASSIGNMENT
   ├─ Reward configuration retrieved
   ├─ Tier multiplier applied
   ├─ Reward amount added to affiliate profile
   └─ pending_earnings updated

7. PAYOUT PROCESSING
   ├─ Scheduled payout triggered (weekly/monthly)
   ├─ Minimum payout threshold checked
   ├─ Stellar transaction initiated
   ├─ Transaction hash recorded
   └─ Webhook: payout.completed
```

### Status Transitions

```
pending → registered → completed → [reward paid]
   ↓
expired (if timeout)
   ↓
cancelled (if fraud detected)
```


## Affiliate Program

### Tier System

The affiliate program uses a 5-tier system that rewards high-performing affiliates:

| Tier | Referrals | Multiplier | Bonus | Perks |
|------|-----------|------------|-------|-------|
| Bronze | 0-9 | 1.0x | 0 XLM | Basic dashboard |
| Silver | 10-24 | 1.2x | 50 XLM | Priority support, Custom codes |
| Gold | 25-49 | 1.5x | 150 XLM | Advanced analytics, API access |
| Platinum | 50-99 | 2.0x | 500 XLM | Dedicated manager, Early features |
| Diamond | 100+ | 3.0x | 2000 XLM | VIP support, Revenue share |

### Tier Progression

Tiers are automatically updated based on successful referrals:

```sql
-- Automatic tier update trigger
CREATE OR REPLACE FUNCTION update_affiliate_tier()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE affiliate_profiles
  SET tier_id = (
    SELECT id FROM reward_tiers
    WHERE NEW.successful_referrals >= min_referrals
      AND (max_referrals IS NULL OR NEW.successful_referrals <= max_referrals)
      AND is_active = true
    ORDER BY tier_level DESC
    LIMIT 1
  )
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Earnings Calculation

```typescript
// Example: Calculate earnings with tier multiplier
const baseReward = 20; // XLM for mentor signup
const tierMultiplier = 1.5; // Gold tier
const finalReward = baseReward * tierMultiplier; // 30 XLM

// Add to affiliate profile
pendingEarnings += finalReward;
totalEarnings += finalReward;
```


## Payout System

### Payment Schedules

Affiliates can choose their payout frequency:

- **Weekly**: Every Monday
- **Biweekly**: 1st and 15th of each month
- **Monthly**: 1st of each month

### Minimum Payout Threshold

Default: 10 XLM (configurable per affiliate)

### Payout Process

```typescript
// Automated payout workflow
async function processScheduledPayouts() {
  // 1. Find eligible affiliates
  const eligibleAffiliates = await pool.query(`
    SELECT * FROM affiliate_profiles
    WHERE status = 'active'
      AND pending_earnings >= minimum_payout
      AND stellar_address IS NOT NULL
  `);

  for (const affiliate of eligibleAffiliates.rows) {
    // 2. Create payout record
    const payout = await createPayout({
      affiliateId: affiliate.id,
      amount: affiliate.pending_earnings,
      payoutType: 'scheduled'
    });

    // 3. Process Stellar payment
    const txHash = await stellarService.sendPayment({
      destination: affiliate.stellar_address,
      amount: affiliate.pending_earnings,
      asset: 'XLM'
    });

    // 4. Update payout status
    await updatePayoutStatus(payout.id, 'completed', txHash);

    // 5. Update affiliate earnings
    await pool.query(`
      UPDATE affiliate_profiles
      SET pending_earnings = 0,
          paid_earnings = paid_earnings + $1
      WHERE id = $2
    `, [affiliate.pending_earnings, affiliate.id]);

    // 6. Send notification
    await sendPayoutNotification(affiliate.user_id, payout);
  }
}
```

### Stellar Integration

```typescript
// Stellar payment example
import { Server, Keypair, TransactionBuilder, Operation, Asset } from 'stellar-sdk';

async function sendXLMPayment(destination: string, amount: number) {
  const server = new Server('https://horizon.stellar.org');
  const sourceKeys = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!);
  
  const account = await server.loadAccount(sourceKeys.publicKey());
  
  const transaction = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.PUBLIC
  })
    .addOperation(Operation.payment({
      destination,
      asset: Asset.native(),
      amount: amount.toString()
    }))
    .setTimeout(30)
    .build();
  
  transaction.sign(sourceKeys);
  const result = await server.submitTransaction(transaction);
  
  return result.hash;
}
```


## Integration Guide

### Frontend Integration

#### 1. Display Referral Code

```typescript
// Fetch user's referral code
const response = await fetch('/api/v1/referrals/codes', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const { data: codes } = await response.json();
const primaryCode = codes[0];

// Display shareable link
const referralLink = `https://mentorsmind.com/signup?ref=${primaryCode.code}`;
```

#### 2. Apply Referral Code During Signup

```typescript
// Extract code from URL
const urlParams = new URLSearchParams(window.location.search);
const referralCode = urlParams.get('ref');

if (referralCode) {
  // Validate code
  const validation = await fetch(`/api/v1/referrals/codes/${referralCode}/validate`);
  const { data } = await validation.json();
  
  if (data.valid) {
    // Store in session/localStorage
    localStorage.setItem('referralCode', referralCode);
    
    // Apply after user registers
    await fetch('/api/v1/referrals/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referralCode,
        referredEmail: userEmail
      })
    });
  }
}
```

#### 3. Display Affiliate Dashboard

```typescript
// Fetch dashboard data
const dashboard = await fetch(`/api/v1/referrals/affiliate/${userId}/dashboard`, {
  headers: { 'Authorization': `Bearer ${token}` }
});

const { data } = await dashboard.json();

// Display metrics
console.log(`Total Earnings: ${data.stats.totalEarnings} XLM`);
console.log(`Conversion Rate: ${data.stats.conversionRate}%`);
console.log(`Current Tier: ${data.tier.name}`);
console.log(`Next Payout: ${data.stats.nextPayout}`);
```


### Backend Integration

#### 1. Track Conversion Events

```typescript
// After user completes qualifying action
import { ReferralService } from './services/referral.service';

// Example: User completes first booking
async function handleBookingCompleted(userId: string, bookingId: string) {
  // Find pending referral for this user
  const { rows } = await pool.query(
    `SELECT id FROM referrals 
     WHERE referred_user_id = $1 AND status = 'registered'`,
    [userId]
  );

  if (rows.length > 0) {
    // Update referral to completed
    await ReferralService.updateReferral(rows[0].id, {
      status: 'completed',
      conversionType: 'first_booking'
    });
  }
}
```

#### 2. Webhook Events

```typescript
// Listen for referral events
import { WebhookService } from './services/webhook.service';

// Trigger webhook on referral completion
await WebhookService.triggerEvent('referral.completed', {
  referralId: referral.id,
  referrerId: referral.referrerId,
  referredUserId: referral.referredUserId,
  conversionType: referral.conversionType,
  rewardAmount: referral.rewardAmount,
  rewardCurrency: referral.rewardCurrency
});

// Trigger webhook on payout
await WebhookService.triggerEvent('payout.completed', {
  payoutId: payout.id,
  affiliateId: payout.affiliateId,
  amount: payout.amount,
  currency: payout.currency,
  transactionHash: payout.transactionHash
});
```

#### 3. Scheduled Jobs

```typescript
// Setup cron jobs for automated payouts
import cron from 'node-cron';

// Weekly payouts (every Monday at 9 AM)
cron.schedule('0 9 * * 1', async () => {
  await processScheduledPayouts('weekly');
});

// Monthly payouts (1st of month at 9 AM)
cron.schedule('0 9 1 * *', async () => {
  await processScheduledPayouts('monthly');
});
```


## Security Considerations

### 1. Fraud Prevention

```typescript
// Detect suspicious patterns
async function detectFraudulentActivity(referrerId: string) {
  // Check for multiple referrals from same IP
  const { rows: ipCheck } = await pool.query(`
    SELECT COUNT(DISTINCT referred_user_id) as count
    FROM referrals r
    JOIN users u ON r.referred_user_id = u.id
    WHERE r.referrer_id = $1
      AND u.last_login_ip IN (
        SELECT last_login_ip FROM users WHERE id = $1
      )
  `, [referrerId]);

  if (ipCheck[0].count > 5) {
    // Flag for review
    await flagAffiliateForReview(referrerId, 'multiple_same_ip');
  }

  // Check for rapid referrals
  const { rows: rapidCheck } = await pool.query(`
    SELECT COUNT(*) as count
    FROM referrals
    WHERE referrer_id = $1
      AND created_at > NOW() - INTERVAL '1 hour'
  `, [referrerId]);

  if (rapidCheck[0].count > 10) {
    await flagAffiliateForReview(referrerId, 'rapid_referrals');
  }
}
```

### 2. Rate Limiting

```typescript
// Limit referral code creation
import rateLimit from 'express-rate-limit';

const createCodeLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 5, // 5 codes per day
  message: 'Too many referral codes created. Try again tomorrow.'
});

router.post('/codes', createCodeLimiter, ReferralController.createReferralCode);
```

### 3. Code Validation

```typescript
// Prevent self-referrals
async function validateReferral(referralCode: string, userId: string) {
  const code = await ReferralService.getReferralCodeByCode(referralCode);
  
  if (!code) {
    throw new Error('Invalid referral code');
  }
  
  if (code.userId === userId) {
    throw new Error('Cannot use your own referral code');
  }
  
  // Check if user already used a referral
  const { rows } = await pool.query(
    'SELECT id FROM referrals WHERE referred_user_id = $1',
    [userId]
  );
  
  if (rows.length > 0) {
    throw new Error('User already referred');
  }
  
  return code;
}
```


### 4. Payout Security

```typescript
// Verify Stellar address before payout
import { StrKey } from 'stellar-sdk';

function validateStellarAddress(address: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

// Implement payout approval workflow
async function requestPayout(affiliateId: string, amount: number) {
  // Check minimum threshold
  const profile = await getAffiliateProfile(affiliateId);
  
  if (amount < profile.minimumPayout) {
    throw new Error(`Minimum payout is ${profile.minimumPayout} XLM`);
  }
  
  // Validate Stellar address
  if (!validateStellarAddress(profile.stellarAddress)) {
    throw new Error('Invalid Stellar address');
  }
  
  // Create payout with pending status
  const payout = await createPayout({
    affiliateId,
    amount,
    status: 'pending'
  });
  
  // Notify admin for approval (for large amounts)
  if (amount > 1000) {
    await notifyAdminForApproval(payout);
  } else {
    // Auto-approve small amounts
    await processPayout(payout.id);
  }
  
  return payout;
}
```

### 5. Data Privacy

```typescript
// Anonymize referral data in analytics
async function getPublicReferralStats() {
  const { rows } = await pool.query(`
    SELECT 
      DATE_TRUNC('day', created_at) as date,
      COUNT(*) as referrals,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as conversions
    FROM referrals
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY date DESC
  `);
  
  // Don't expose user IDs or emails
  return rows;
}
```


## Testing

### Unit Tests

```typescript
// Test referral code generation
describe('ReferralService', () => {
  describe('generateReferralCode', () => {
    it('should generate unique 8-character code', () => {
      const code1 = ReferralService.generateReferralCode('user1');
      const code2 = ReferralService.generateReferralCode('user2');
      
      expect(code1).toHaveLength(8);
      expect(code2).toHaveLength(8);
      expect(code1).not.toBe(code2);
    });
  });

  describe('createReferralCode', () => {
    it('should create referral code for user', async () => {
      const code = await ReferralService.createReferralCode({
        userId: 'test-user-id',
        codeType: 'personal'
      });
      
      expect(code.userId).toBe('test-user-id');
      expect(code.codeType).toBe('personal');
      expect(code.isActive).toBe(true);
    });

    it('should prevent duplicate personal codes', async () => {
      await ReferralService.createReferralCode({
        userId: 'test-user-id',
        codeType: 'personal'
      });
      
      await expect(
        ReferralService.createReferralCode({
          userId: 'test-user-id',
          codeType: 'personal'
        })
      ).rejects.toThrow('User already has an active referral code');
    });
  });
});
```

### Integration Tests

```typescript
// Test complete referral flow
describe('Referral Flow', () => {
  it('should complete full referral journey', async () => {
    // 1. Create referral code
    const code = await request(app)
      .post('/api/v1/referrals/codes')
      .set('Authorization', `Bearer ${referrerToken}`)
      .send({ codeType: 'personal' });
    
    expect(code.status).toBe(201);
    
    // 2. Apply referral code
    const referral = await request(app)
      .post('/api/v1/referrals/apply')
      .send({
        referralCode: code.body.data.code,
        referredEmail: 'newuser@example.com'
      });
    
    expect(referral.status).toBe(201);
    expect(referral.body.data.status).toBe('pending');
    
    // 3. Update to completed
    const updated = await request(app)
      .put(`/api/v1/referrals/${referral.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'completed',
        conversionType: 'user_signup',
        referredUserId: 'new-user-id'
      });
    
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe('completed');
    expect(updated.body.data.rewardAmount).toBeGreaterThan(0);
  });
});
```


### Load Tests

```typescript
// Test referral system under load
import { check } from 'k6';
import http from 'k6/http';

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
};

export default function () {
  // Create referral code
  const createRes = http.post(
    'http://localhost:3000/api/v1/referrals/codes',
    JSON.stringify({ codeType: 'personal' }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${__ENV.TEST_TOKEN}`
      }
    }
  );
  
  check(createRes, {
    'code created': (r) => r.status === 201,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  // Get referral stats
  const statsRes = http.get(
    'http://localhost:3000/api/v1/referrals/stats',
    {
      headers: { 'Authorization': `Bearer ${__ENV.TEST_TOKEN}` }
    }
  );
  
  check(statsRes, {
    'stats retrieved': (r) => r.status === 200,
    'response time < 300ms': (r) => r.timings.duration < 300,
  });
}
```

## Monitoring and Analytics

### Key Metrics to Track

1. **Conversion Metrics**
   - Total referrals created
   - Conversion rate (registered → completed)
   - Average time to conversion
   - Top performing referral codes

2. **Financial Metrics**
   - Total rewards distributed
   - Average reward per referral
   - Pending payout amount
   - Cost per acquisition (CPA)

3. **User Engagement**
   - Active affiliates
   - Referrals per affiliate
   - Tier distribution
   - Churn rate

4. **System Performance**
   - API response times
   - Database query performance
   - Cache hit rates
   - Payout success rate


### Monitoring Dashboard Queries

```sql
-- Daily referral performance
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_referrals,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
  ROUND(AVG(CASE WHEN completed_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (completed_at - created_at))/3600 
  END), 2) as avg_hours_to_complete
FROM referrals
WHERE created_at > CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Top performing affiliates
SELECT 
  ap.user_id,
  u.first_name || ' ' || u.last_name as name,
  ap.successful_referrals,
  ap.total_earnings,
  rt.name as tier,
  ap.conversion_rate
FROM affiliate_profiles ap
JOIN users u ON ap.user_id = u.id
LEFT JOIN reward_tiers rt ON ap.tier_id = rt.id
WHERE ap.status = 'active'
ORDER BY ap.total_earnings DESC
LIMIT 20;

-- Payout summary
SELECT 
  status,
  COUNT(*) as count,
  SUM(amount) as total_amount,
  AVG(amount) as avg_amount
FROM reward_payouts
WHERE created_at > CURRENT_DATE - INTERVAL '30 days'
GROUP BY status;

-- Conversion funnel
SELECT 
  'Total Codes' as stage,
  COUNT(*) as count
FROM referral_codes
WHERE is_active = true
UNION ALL
SELECT 
  'Referrals Created',
  COUNT(*)
FROM referrals
UNION ALL
SELECT 
  'Users Registered',
  COUNT(*)
FROM referrals
WHERE status IN ('registered', 'completed')
UNION ALL
SELECT 
  'Conversions Completed',
  COUNT(*)
FROM referrals
WHERE status = 'completed';
```


## Troubleshooting

### Common Issues

#### 1. Referral Code Not Validating

**Problem**: Code validation returns invalid even though code exists.

**Solutions**:
- Check if code is expired: `SELECT expires_at FROM referral_codes WHERE code = 'XXX'`
- Check if max uses reached: `SELECT current_uses, max_uses FROM referral_codes WHERE code = 'XXX'`
- Verify code is active: `SELECT is_active FROM referral_codes WHERE code = 'XXX'`

#### 2. Rewards Not Being Assigned

**Problem**: Referral completed but no reward amount set.

**Solutions**:
- Check reward configuration exists: `SELECT * FROM reward_configurations WHERE event_type = 'XXX'`
- Verify configuration is active: `SELECT is_active FROM reward_configurations WHERE event_type = 'XXX'`
- Check logs for errors in `assignReward` function

#### 3. Payouts Failing

**Problem**: Payout status stuck in 'processing' or 'failed'.

**Solutions**:
- Verify Stellar address is valid
- Check Stellar network status
- Verify sufficient balance in source account
- Review transaction logs for error messages
- Check `failed_reason` field in reward_payouts table

#### 4. Tier Not Updating

**Problem**: Affiliate tier not updating despite meeting requirements.

**Solutions**:
- Verify trigger is enabled: `SELECT tgenabled FROM pg_trigger WHERE tgname = 'update_affiliate_stats_trigger'`
- Manually trigger update: `UPDATE affiliate_profiles SET successful_referrals = successful_referrals WHERE id = 'XXX'`
- Check tier thresholds: `SELECT * FROM reward_tiers ORDER BY tier_level`

## Best Practices

### 1. Code Generation
- Use collision-resistant algorithms
- Exclude similar characters (0/O, 1/I, etc.)
- Keep codes short but unique (8-12 characters)
- Allow custom codes for campaigns

### 2. Fraud Prevention
- Monitor for suspicious patterns
- Implement rate limiting
- Verify email addresses
- Track IP addresses
- Review high-value payouts manually

### 3. Performance Optimization
- Cache frequently accessed data (tiers, configurations)
- Use database indexes on foreign keys
- Batch process payouts
- Archive old referral records

### 4. User Experience
- Clear communication of rewards
- Real-time dashboard updates
- Email notifications for milestones
- Easy code sharing options
- Transparent tier progression


## Future Enhancements

### Phase 2 Features

1. **Advanced Analytics**
   - Cohort analysis
   - Lifetime value tracking
   - Attribution modeling
   - A/B testing for reward amounts

2. **Campaign Management**
   - Time-limited campaigns
   - Bonus multipliers for events
   - Geographic targeting
   - Custom landing pages

3. **Social Integration**
   - One-click sharing to social media
   - Pre-filled share messages
   - Social media tracking pixels
   - Influencer partnerships

4. **Gamification**
   - Leaderboards
   - Badges and achievements
   - Referral challenges
   - Bonus rewards for milestones

5. **Multi-Currency Support**
   - Support for multiple cryptocurrencies
   - Fiat currency payouts
   - Currency conversion options
   - Dynamic reward pricing

6. **Advanced Fraud Detection**
   - Machine learning models
   - Behavioral analysis
   - Device fingerprinting
   - Network analysis

## Conclusion

The MentorsMind Referral and Affiliate Program provides a comprehensive solution for incentivizing user growth through:

- ✅ Flexible referral code system
- ✅ Automated conversion tracking
- ✅ Tiered reward structure
- ✅ Secure XLM token payouts
- ✅ Real-time analytics dashboard
- ✅ Webhook integration
- ✅ Fraud prevention measures

For questions or support, contact the development team or refer to the API documentation.

---

**Last Updated**: January 2024  
**Version**: 1.0.0  
**Maintained By**: MentorsMind Development Team
