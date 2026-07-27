# Wallet Reconciliation - Quick Start

## 5-Minute Setup

### 1. Apply Database Migrations

```bash
# Run migration to create reconciliation tables
psql -U postgres -d mentorminds < database/migrations/2026_wallet_reconciliation_tables.sql

# Verify tables created
\dt wallet_reconciliation_logs
\dt wallet_balance_discrepancies
\dt wallet_notifications
```

### 2. Add to App Initialization

```typescript
// src/server.ts or app.ts
import { startWalletReconciliationJobs } from './jobs/wallet-reconciliation.job';

// On app startup
startWalletReconciliationJobs();
```

### 3. Mount Admin Routes

```typescript
import reconciliationRoutes from './routes/admin/wallet-reconciliation.routes';

app.use('/admin/wallets', reconciliationRoutes);
```

### 4. Add Pre-Payout Middleware

```typescript
import { walletReconciliationPrePayoutMiddleware } from './middleware/wallet-reconciliation-pre-payout.middleware';

// On payout route
router.post(
  '/payouts',
  authenticate,
  walletReconciliationPrePayoutMiddleware,
  payoutHandler
);
```

## Admin Commands

### Check Platform Status

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://api.example.com/admin/wallets/reconciliation/status
```

**Response shows:**
- Total wallets
- Wallets already reconciled
- Wallets needing reconciliation
- Average discrepancies
- Total corrected

### Trigger Manual Reconciliation

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://api.example.com/admin/wallets/{userId}/reconcile
```

**Response includes:**
- Discrepancies found
- Corrections made
- Assets updated

### View Discrepancies

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://api.example.com/admin/wallets/{userId}/discrepancies
```

**Shows:**
- Current discrepancies
- Reason classification
- Asset and amount

### View History

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://api.example.com/admin/wallets/{userId}/reconciliation-history
```

**Shows past reconciliations with statistics**

### Batch Reconciliation

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxReconciliations": 100, "maxAgeHours": 24}' \
  http://api.example.com/admin/wallets/reconciliation/batch
```

## Programmatic Usage

### Check for Discrepancies

```typescript
import { WalletReconciliationService } from './services/wallet-reconciliation.service';

const discrepancies = await WalletReconciliationService.checkForDiscrepancies(userId);

if (discrepancies && discrepancies.length > 0) {
  console.log(`Found ${discrepancies.length} discrepancies`);
  discrepancies.forEach(d => {
    console.log(`${d.assetCode}: ${d.postgresBalance} → ${d.stellarBalance}`);
  });
}
```

### Reconcile Wallet

```typescript
const result = await WalletReconciliationService.reconcileWallet(userId);

if (result.corrected) {
  console.log(`Corrected ${result.correctionDetails.totalCorrectedAssets} assets`);
}
```

### Batch Reconciliation

```typescript
const batchResult = await WalletReconciliationService.reconcileAllWallets(100, 24);

console.log(`Processed: ${batchResult.processed}`);
console.log(`Corrected: ${batchResult.corrected}`);
console.log(`Failed: ${batchResult.failed}`);
```

### Check History

```typescript
const history = await WalletReconciliationService.getReconciliationHistory(userId, 50);

history.forEach(entry => {
  console.log(`${entry.timestamp}: Found ${entry.discrepanciesFound}, corrected ${entry.correctedCount}`);
});
```

### Platform Statistics

```typescript
const stats = await WalletReconciliationService.getReconciliationStats();

console.log(`Total wallets: ${stats.totalWallets}`);
console.log(`Reconciled: ${stats.walletsReconciled}`);
console.log(`Needing reconciliation: ${stats.walletsNeedingReconciliation}`);
console.log(`Total corrected: ${stats.totalDiscrepanciesCorrected}`);
```

## How It Works

### Automatic (Pre-Payout)

```
User requests payout
        ↓
Pre-payout middleware runs
        ├─ Fetch PostgreSQL balance
        ├─ Fetch Stellar balance
        ├─ Compare and classify discrepancies
        ├─ Correct PostgreSQL if needed
        └─ Attach context to request
        ↓
Payout handler
        ├─ Read corrected balance
        ├─ Calculate payout
        └─ Execute
```

### Manual (Admin)

```
Admin clicks "Reconcile Now"
        ↓
POST /admin/wallets/{userId}/reconcile
        ↓
Reconciliation Service
        ├─ Fetch PostgreSQL balance
        ├─ Fetch Stellar balance
        ├─ Detect discrepancies
        ├─ Correct balances
        ├─ Log corrections
        └─ Return result
        ↓
Admin sees results
```

### Background (Scheduled)

```
Every 6 hours
        ↓
Background job runs
        ├─ Find wallets not reconciled in 24 hours
        ├─ Process up to 100 wallets
        ├─ Reconcile each wallet
        ├─ Log results
        └─ Alert if issues
        ↓
Platform remains synchronized
```

## Troubleshooting

### Q: Balance still showing old value

**A:** Scheduled jobs run every 6 hours. For immediate update:
```bash
curl -X POST /admin/wallets/{userId}/reconcile
```

### Q: How do I verify a correction?

**A:** Check history:
```bash
curl /admin/wallets/{userId}/reconciliation-history
```

### Q: What if reconciliation keeps failing?

**A:** Check logs for Stellar API errors. Verify:
1. Stellar public key is valid
2. Horizon server is reachable
3. Network connectivity is stable

### Q: Can I disable background jobs?

**A:** Set environment variable:
```bash
WALLET_RECONCILIATION_JOB_ENABLED=false
```

### Q: What does each discrepancy reason mean?

| Reason | Meaning | Action |
|--------|---------|--------|
| `direct_payment` | Money received externally | Add to balance |
| `missed_event` | Platform missed an event | Correct to Stellar value |
| `external_transaction` | Money sent externally | Subtract from balance |
| `unknown` | Unclear cause | Investigate manually |

## Environment Variables

```bash
# Enable/disable background jobs (default: true)
WALLET_RECONCILIATION_JOB_ENABLED=true

# Optional: Custom job schedules (cron format)
WALLET_RECON_SCHEDULE_6H="0 */6 * * *"      # Every 6 hours
WALLET_RECON_SCHEDULE_HOURLY="0 * * * *"    # Every hour
WALLET_RECON_SCHEDULE_DAILY="0 2 * * *"     # Daily at 2 AM
```

## Monitoring

### Check Job Health

```bash
# View recent reconciliation logs
SELECT * FROM wallet_reconciliation_logs 
ORDER BY created_at DESC 
LIMIT 10;

# Count by status
SELECT status, COUNT(*) 
FROM wallet_reconciliation_logs 
GROUP BY status;
```

### View Discrepancy Patterns

```bash
# Most common discrepancies
SELECT 
  discrepancy_reason, 
  COUNT(*) as count,
  AVG(discrepancy_amount::numeric) as avg_amount
FROM wallet_balance_discrepancies
GROUP BY discrepancy_reason
ORDER BY count DESC;
```

### Wallets Needing Reconciliation

```bash
SELECT w.user_id, w.stellar_public_key
FROM wallets w
WHERE NOT EXISTS (
  SELECT 1 FROM wallet_reconciliation_logs wrl
  WHERE wrl.user_id = w.user_id
    AND wrl.status = 'completed'
    AND wrl.completed_at > NOW() - INTERVAL '24 hours'
);
```

## Documentation

- [Full System Guide](docs/WALLET_RECONCILIATION_SYSTEM.md)
- [Implementation Details](WALLET_RECONCILIATION_IMPLEMENTATION.md)
- [API Reference](docs/WALLET_RECONCILIATION_SYSTEM.md#api-examples)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review [Full Documentation](docs/WALLET_RECONCILIATION_SYSTEM.md)
3. Check reconciliation logs in database
4. Review Stellar API connectivity
