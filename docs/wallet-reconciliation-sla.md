# Wallet Reconciliation — SLA & Operations

This document defines the service-level expectations and operating procedures
for the wallet balance reconciliation described in issue #771.

## Source of truth

The **Stellar network** is authoritative for XLM and token balances. The
PostgreSQL `wallet_balances` table is a cache that can drift when:

1. A Stellar transaction is processed outside the platform.
2. The Horizon stream misses an event.
3. The platform wallet receives a direct XLM payment not tied to a booking.

`WalletReconciliationService.syncWallet(walletId)` is the single entry point
that re-aligns the two.

## Triggers

| Trigger | Mechanism | Code |
| --- | --- | --- |
| Nightly full sweep | BullMQ repeatable job `wallet-reconciliation-recurring` (cron `0 3 * * *` UTC) on `maintenance-queue` | `scheduler.ts` → `maintenance.worker.ts` → `reconcileAll()` |
| On-demand admin sync | `POST /api/v1/admin/wallets/:id/sync` | `WalletReconciliationController.syncWallet` |
| Pre-payout verification | Called inside `WalletsService.createPayoutRequest` before balance checks | `wallets.service.ts` |

## SLAs

| Metric | Target | Notes |
| --- | --- | --- |
| Nightly full reconciliation completes | every 24h, all active wallets | Runs at 03:00 UTC; bounded concurrency (10 wallets/batch) |
| PostgreSQL ↔ Stellar parity | within **60s** of nightly sync | A single `syncWallet` corrects drift immediately on the next run |
| On-demand sync latency | **< 5s** per wallet | One Horizon `getAccount` + a few DB ops; cached 5s by `StellarService` |
| Discrepancy alert latency | **real-time** (< 1s) | Emitted to the `admin` Socket.IO room as `wallet:balance_discrepancy` |
| Admin alert threshold | native (XLM) discrepancy **> 1 XLM** | Token discrepancies are corrected + logged but not alerted |

## Idempotency

- Each asset correction is detected and applied inside a single
  `SELECT … FOR UPDATE` transaction on `wallet_balances`.
- A log row in `wallet_reconciliation_log` is written **only** when a real
  difference exists (`|discrepancy| > 1e-7`).
- Consequence: running `syncWallet` twice for an already-synced wallet produces
  **no duplicate log entries** — the second run observes the corrected balance
  and finds nothing to change.

## Metrics

| Counter | Labels | Increments |
| --- | --- | --- |
| `wallet_reconciliations_total` | `status` (`success`/`no_wallet`/`error`) | once per `syncWallet` call |
| `wallet_discrepancies_total` | `asset_type` (`native`/`credit_alphanum4`/…) | once per corrected asset |

Both are registered in `src/config/metrics.ts` and exported via the standard
Prometheus registry.

## Admin event

```json
{
  "event": "wallet:balance_discrepancy",
  "room": "admin",
  "payload": {
    "walletId": "uuid",
    "assetType": "native",
    "assetCode": null,
    "assetIssuer": null,
    "beforeBalance": 12.5,
    "afterBalance": 18.5,
    "discrepancy": 6.0,
    "thresholdXlm": 1,
    "syncedAt": "2026-08-25T03:00:12.000Z"
  }
}
```

## Troubleshooting

- **`status: "no_wallet"`** — wallet id unknown or soft-deleted; check `wallets.id`.
- **`status: "error"`** — usually Horizon unreachable. The job fails soft; the
  next nightly run retries. `wallet_reconciliations_total{status="error"}` tracks this.
- **Drift recurs quickly** — indicates a missing stream handler or an off-platform
  payment path; review `stellar-stream.service.ts` and payout flows.
