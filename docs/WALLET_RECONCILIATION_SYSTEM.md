# Wallet Reconciliation System

## Overview

The wallet reconciliation system detects and corrects discrepancies between PostgreSQL wallet_balances and the authoritative Stellar network. This ensures users always see accurate balances regardless of how transactions occurred (via platform, direct wallet transfers, or missed events).

## Problem Statement

Previously, wallet balances could drift from Stellar's authoritative state if:
1. **Direct XLM payments** were sent to wallet outside platform
2. **Horizon stream missed events** during network issues
3. **Platform wallet received direct payments** not tied to bookings
4. **External transactions** bypassed platform tracking

Result: Mentors saw outdated balances in dashboard, causing:
- ❌ Incorrect payout calculations
- ❌ Overdraft attempts against wrong balance
- ❌ Trust issues when balance differs from on-chain
- ❌ Duplicate correction attempts

## Solution Architecture

### Three-Layer Approach

1. **Detection Layer** - Identifies discrepancies
2. **Correction Layer** - Updates PostgreSQL to match Stellar
3. **Monitoring Layer** - Tracks corrections and alerts

### Discrepancy Types Identified

| Type | Cause | Action |
|------|-------|--------|
| **Direct Payment** | XLM sent to wallet outside platform | Add to balance (increase) |
| **Missed Event** | Horizon stream missed event | Correct to match Stellar |
| **External Transaction** | Transaction from wallet outside platform | Subtract from balance (decrease) |
| **Unknown** | Unclassified discrepancy | Log for investigation |

## Core Components

### 1. Wallet Reconciliation Service

**File:** `src/services/wallet-reconciliation.service.ts` (606 lines)

**Main Methods:**

- `checkForDiscrepancies(userId)` - Detect without correcting
- `reconcileWallet(userId)` - Detect and correct
- `reconcileAsset(userId, assetCode)` - Single asset reconciliation
- `reconcileAllWallets(maxCount, maxAgeHours)` - Batch reconciliation
- `getReconciliationHistory(userId)` - View past reconciliations
- `getReconciliationStats()` - Platform-wide statistics

**Example Usage:**

```typescript
import { WalletReconciliationService } from './services/wallet-reconciliation.service';

// Check for discrepancies
const discrepancies = await WalletReconciliationService.checkForDiscrepancies(userId);

// Detect and correct discrepancies
const result = await WalletReconciliationService.reconcileWallet(userId);

if (result.corrected) {
  console.log(`Corrected ${result.correctionDetails?.totalCorrectedAssets} assets`);
}
```

### 2. Pre-Payout Reconciliation Middleware

**File:** `src/middleware/wallet-reconciliation-pre-payout.middleware.ts` (159 lines)

Automatically reconciles wallet before payout operations:

```typescript
router.post(
  '/payouts',
  walletReconciliationPrePayoutMiddleware,
  payoutHandler
);
```

**Features:**
- Automatic reconciliation before payout
- Detects and corrects balance discrepancies
- Logs all corrections for audit trail
- Continues even if reconciliation fails (with warning)

### 3. Background Jobs

**File:** `src/jobs/wallet-reconciliation.job.ts` (296 lines)

Scheduled tasks running automatically:

| Job | Schedule | Purpose |
|-----|----------|---------|
| **ReconcileStaleWallets** | Every 6 hours | Reconcile wallets not checked in 24 hours |
| **CheckCriticalDiscrepancies** | Every hour | Monitor for large discrepancies |
| **DailyReconciliationReport** | Daily @ 2 AM | Generate platform-wide report |

**Starting Jobs:**

```typescript
import { startWalletReconciliationJobs } from './jobs/wallet-reconciliation.job';

// In app initialization
startWalletReconciliationJobs();
```

### 4. Admin Dashboard

**File:** `src/routes/admin/wallet-reconciliation.routes.ts` (313 lines)

**Endpoints:**

- `GET /admin/wallets/reconciliation/status` - Overall platform status
- `POST /admin/wallets/:userId/reconcile` - Manual reconciliation
- `GET /admin/wallets/:userId/discrepancies` - View discrepancies
- `GET /admin/wallets/:userId/reconciliation-history` - View history
- `POST /admin/wallets/reconciliation/batch` - Batch reconciliation
- `POST /admin/wallets/:userId/reconcile-asset` - Single asset reconciliation

### 5. Database Tables

**File:** `database/migrations/2026_wallet_reconciliation_tables.sql`

**Tables:**

- `wallet_reconciliation_logs` - Reconciliation events
- `wallet_balance_discrepancies` - Audit trail of discrepancies
- `wallet_notifications` - Balance update notifications
- View `wallet_reconciliation_summary` - Quick status overview

## Reconciliation Process

### Step 1: Detect

```
PostgreSQL Balance (stale)    vs    Stellar Balance (authoritative)
XLM: 50.00                         XLM: 75.00
USDC: 100.00                       USDC: 100.00
                                   EUR: 50.00 (new)
```

**Discrepancies Found:**
- XLM: -25.00 (direct payment received)
- EUR: +50.00 (new asset)

### Step 2: Classify

| Asset | Difference | Reason | Action |
|-------|-----------|--------|--------|
| XLM | +25 | Stellar > PostgreSQL | Direct payment (increase) |
| EUR | +50 | Not in PostgreSQL | New direct payment (add) |

### Step 3: Correct

```sql
UPDATE wallet_balances SET balance = 75.00 WHERE user_id = X AND asset_code = 'XLM';
INSERT INTO wallet_balances VALUES (X, 'EUR', null, 50.00);
```

### Step 4: Log

```
- Record discrepancy: { assetCode, postgresBalance, stellarBalance, reason }
- Record correction: { user_id, corrected_count, status }
- Notify user: "Your balance was updated"
```

## Usage Examples

### Manual Reconciliation (Admin)

```bash
# Check for discrepancies
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  GET /admin/wallets/{userId}/discrepancies

# Trigger reconciliation
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  -X POST /admin/wallets/{userId}/reconcile
```

### In Payout Flow

```typescript
// Automatically reconciles before calculating payout
router.post(
  '/api/v1/payouts',
  authenticate,
  walletReconciliationPrePayoutMiddleware,
  async (req, res) => {
    // At this point, wallet is reconciled
    const { balancesReconciled, discrepanciesFound } = 
      req.walletReconciliation;
    
    // Proceed with payout calculation using current balance
  }
);
```

### Programmatic Reconciliation

```typescript
const result = await WalletReconciliationService.reconcileWallet(userId);

if (result.corrected) {
  // Send notification to user
  console.log(`Balance updated for ${result.correctionDetails.correctedAssets.length} assets`);
  
  // Log for audit
  console.log(`Corrected at: ${result.timestamp}`);
}
```

## Configuration

### Environment Variables

```bash
# Enable/disable background reconciliation jobs
WALLET_RECONCILIATION_JOB_ENABLED=true

# Optional: Configure reconciliation schedule (cron expressions)
WALLET_RECON_SCHEDULE_6H="0 */6 * * *"      # Every 6 hours
WALLET_RECON_SCHEDULE_HOURLY="0 * * * *"    # Every hour
WALLET_RECON_SCHEDULE_DAILY="0 2 * * *"     # Daily at 2 AM
```

### Job Configuration

```typescript
// src/jobs/wallet-reconciliation.job.ts
const config = {
  maxReconciliationsPerRun: 100,  // How many wallets per batch
  maxAgeHours: 24,                 // Reconcile if not checked in 24 hours
  alertThresholds: {
    discrepanciesPercentage: 10,  // Alert if > 10% of wallets affected
    averageDiscrepancyAmount: 100, // Alert if avg discrepancy > 100 XLM
  }
};
```

## Monitoring & Alerts

### Key Metrics

```bash
# Check reconciliation status
curl /admin/wallets/reconciliation/status

# Response includes:
{
  "totalWallets": 1500,
  "walletsReconciled": 1495,
  "walletsNeedingReconciliation": 5,
  "averageDiscrepancies": 0.5,
  "totalDiscrepanciesCorrected": 247
}
```

### Recommended Alerts

```yaml
alerts:
  - name: "High Discrepancy Rate"
    condition: "walletsNeedingReconciliation / totalWallets > 5%"
    severity: "warning"
    
  - name: "Reconciliation Job Failed"
    condition: "job_error_count > threshold"
    severity: "critical"
    
  - name: "Large Individual Discrepancy"
    condition: "discrepancy_amount > 1000 XLM"
    severity: "warning"
```

## Audit Trail

All reconciliations are logged in `wallet_reconciliation_logs` table:

```sql
SELECT 
  id,
  user_id,
  discrepancies_found,
  corrected_count,
  status,
  completed_at
FROM wallet_reconciliation_logs
WHERE user_id = $1
ORDER BY completed_at DESC;
```

Each discrepancy is recorded in `wallet_balance_discrepancies`:

```sql
SELECT 
  asset_code,
  postgres_balance,
  stellar_balance,
  discrepancy_amount,
  discrepancy_reason,
  was_corrected,
  created_at
FROM wallet_balance_discrepancies
WHERE user_id = $1;
```

## Performance Considerations

### Database Queries

- Wallet queries: O(1) - Direct user_id lookup
- Stellar API: ~500ms - Horizon network call (cached 5s)
- Batch reconciliation: O(n) - Linear per wallet

### Optimization Strategies

1. **Caching** - Stellar account balances cached 5 seconds
2. **Batch Operations** - Reconcile 100 wallets at a time
3. **Targeted Reconciliation** - Only reconcile stale wallets (24+ hours)
4. **Index Strategy** - Indexed on reconciliation status and timestamps

## Troubleshooting

### Q: Why is balance still showing old value?

**A:** Wallet may not have been reconciled yet. Background jobs run every 6 hours. For immediate reconciliation:
```bash
curl -X POST /admin/wallets/{userId}/reconcile
```

### Q: How do I verify a balance correction?

**A:** Check reconciliation history:
```bash
curl /admin/wallets/{userId}/reconciliation-history
```

### Q: What if reconciliation keeps failing?

**A:** Check logs for Stellar API errors. Verify:
1. Stellar public key is valid
2. Horizon server is reachable
3. Network connectivity is stable

### Q: Can I manually override a correction?

**A:** Not recommended - Stellar is the authoritative source. If correction is wrong:
1. Document the issue
2. Contact support team
3. Investigate root cause with full transaction history

## Integration Checklist

- [ ] Database migrations applied (creates reconciliation tables)
- [ ] `WalletReconciliationService` imported in appropriate services
- [ ] Pre-payout middleware added to payout routes
- [ ] Background jobs started in app initialization
- [ ] Admin routes mounted under `/admin/wallets`
- [ ] Environment variables configured
- [ ] Monitoring and alerts set up
- [ ] Tested with sample wallets (direct payments, missed events)

## API Examples

### Check for Discrepancies (No Correction)

```typescript
const discrepancies = await WalletReconciliationService.checkForDiscrepancies(userId);

if (discrepancies && discrepancies.length > 0) {
  discrepancies.forEach(d => {
    console.log(`${d.assetCode}: ${d.postgresBalance} → ${d.stellarBalance} (${d.discrepancyReason})`);
  });
}
```

### Reconcile and Correct

```typescript
const result = await WalletReconciliationService.reconcileWallet(userId);

console.log(`Discrepancies: ${result.discrepancies.length}`);
if (result.corrected) {
  console.log(`Corrected: ${result.correctionDetails.correctedAssets}`);
}
```

### Batch Reconciliation

```typescript
const batchResult = await WalletReconciliationService.reconcileAllWallets(
  100,  // Max wallets
  24    // Max age (hours)
);

console.log(`Processed: ${batchResult.processed}`);
console.log(`Corrected: ${batchResult.corrected}`);
console.log(`Failed: ${batchResult.failed}`);
```

## Related Documentation

- [Stellar Integration](./STELLAR_SERVICE.md)
- [Wallet Management](./WALLET_MANAGEMENT.md)
- [Payout System](./PAYOUT_SYSTEM.md)
