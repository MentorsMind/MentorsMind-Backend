/**
 * WalletReconciliationService
 *
 * Reconciles PostgreSQL `wallet_balances` against the Stellar network, which is
 * the authoritative source of truth for XLM and token balances. Drift occurs
 * when a Stellar transaction is processed outside the platform, the Horizon
 * stream misses an event, or the platform wallet receives a direct XLM payment
 * not associated with any booking.
 *
 * Features:
 *   - syncWallet(walletId): compares on-chain balances with stored balances,
 *     corrects discrepant rows, and logs every correction to
 *     wallet_reconciliation_log.
 *   - Idempotent: discrepancies are detected and corrected inside a single
 *     `SELECT ... FOR UPDATE` transaction, so running syncWallet twice for an
 *     already-synced wallet creates no duplicate log rows.
 *   - Emits `wallet:balance_discrepancy` to the admin Socket.IO room when a
 *     native XLM discrepancy exceeds 1 XLM.
 *   - Increments Prometheus counters on every reconciliation and discrepancy.
 *   - reconcileAll(): full nightly sweep of every active wallet.
 */

import { randomUUID } from "crypto";
import pool from "../config/database";
import { stellarService } from "./stellar.service";
import { SocketService } from "./socket.service";
import { logger } from "../utils/logger.utils";
import {
  walletReconciliationsTotal,
  walletDiscrepanciesTotal,
} from "../config/metrics";

/** A native (XLM) discrepancy larger than this (in XLM) triggers an admin alert. */
const DISCREPANCY_ALERT_XLM = 1;
/** Balances are stored with 7 decimal places; treat anything below this as equal. */
const EPSILON = 1e-7;

export interface AssetReconciliation {
  assetType: string;
  assetCode: string | null;
  assetIssuer: string | null;
  beforeBalance: number;
  afterBalance: number;
  discrepancy: number;
  changed: boolean;
  alerted: boolean;
}

export interface SyncResult {
  walletId: string;
  stellarPublicKey: string | null;
  status: "success" | "no_wallet" | "error";
  reconciledAssets: number;
  changedAssets: number;
  discrepancies: number;
  alerted: boolean;
  durationMs: number;
  details: AssetReconciliation[];
  error?: string;
}

export interface ReconcileAllResult {
  triggeredAt: string;
  totalWallets: number;
  processed: number;
  failed: number;
  totalChanges: number;
  totalDiscrepancies: number;
  totalAlerts: number;
  durationMs: number;
}

function assetKey(
  assetType: string,
  assetCode: string | null,
  assetIssuer: string | null,
): string {
  return `${assetType}|${assetCode ?? ""}|${assetIssuer ?? ""}`;
}

export const WalletReconciliationService = {
  /**
   * Reconcile a single wallet's balances against the Stellar network.
   * Corrects discrepant rows and logs each correction idempotently.
   */
  async syncWallet(walletId: string): Promise<SyncResult> {
    const start = Date.now();
    const runId = randomUUID();

    const walletRes = await pool.query(
      `SELECT id, stellar_public_key, status
       FROM wallets
       WHERE id = $1 AND deleted_at IS NULL`,
      [walletId],
    );
    const wallet = walletRes.rows[0];

    if (!wallet || !wallet.stellar_public_key) {
      walletReconciliationsTotal.inc({ status: "no_wallet" });
      return {
        walletId,
        stellarPublicKey: wallet?.stellar_public_key ?? null,
        status: "no_wallet",
        reconciledAssets: 0,
        changedAssets: 0,
        discrepancies: 0,
        alerted: false,
        durationMs: Date.now() - start,
        details: [],
      };
    }

    const details: AssetReconciliation[] = [];
    let changedAssets = 0;
    let discrepancies = 0;
    let alerted = false;

    try {
      const account = await stellarService.getAccount(
        wallet.stellar_public_key,
      );
      const onchainMap = new Map<string, number>();
      for (const b of account.balances) {
        const balance = parseFloat(b.balance);
        onchainMap.set(
          assetKey(b.assetType, b.assetCode ?? null, b.assetIssuer ?? null),
          balance,
        );
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 1) On-chain assets → compare against stored balances.
        for (const b of account.balances) {
          const result = await this.applyAsset(client, walletId, runId, {
            assetType: b.assetType,
            assetCode: b.assetCode ?? null,
            assetIssuer: b.assetIssuer ?? null,
            onchainBalance: parseFloat(b.balance),
          });
          details.push(result);
          if (result.changed) changedAssets++;
          if (result.discrepancy !== 0) discrepancies++;
          if (result.alerted) alerted = true;
        }

        // 2) Stored assets with no on-chain counterpart (trustline removed /
        //    balance drained to 0) → reconcile to 0.
        const storedRes = await client.query(
          `SELECT asset_type, asset_code, asset_issuer
           FROM wallet_balances
           WHERE wallet_id = $1
           FOR UPDATE`,
          [walletId],
        );
        for (const row of storedRes.rows) {
          const key = assetKey(
            row.asset_type,
            row.asset_code ?? null,
            row.asset_issuer ?? null,
          );
          if (!onchainMap.has(key)) {
            const result = await this.applyAsset(
              client,
              walletId,
              runId,
              {
                assetType: row.asset_type,
                assetCode: row.asset_code ?? null,
                assetIssuer: row.asset_issuer ?? null,
                onchainBalance: 0,
              },
            );
            details.push(result);
            if (result.changed) changedAssets++;
            if (result.discrepancy !== 0) discrepancies++;
            if (result.alerted) alerted = true;
          }
        }

        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("WalletReconciliationService.syncWallet failed", {
        walletId,
        error: message,
      });
      walletReconciliationsTotal.inc({ status: "error" });
      return {
        walletId,
        stellarPublicKey: wallet.stellar_public_key,
        status: "error",
        reconciledAssets: details.length,
        changedAssets,
        discrepancies,
        alerted,
        durationMs: Date.now() - start,
        details,
        error: message,
      };
    }

    walletReconciliationsTotal.inc({ status: "success" });
    return {
      walletId,
      stellarPublicKey: wallet.stellar_public_key,
      status: "success",
      reconciledAssets: details.length,
      changedAssets,
      discrepancies,
      alerted,
      durationMs: Date.now() - start,
      details,
    };
  },

  /**
   * Compare and (if different) correct a single asset balance inside the
   * caller's transaction. Returns the reconciliation outcome. Idempotent: when
   * the stored balance already matches the on-chain value, nothing is written.
   */
  async applyAsset(
    client: any,
    walletId: string,
    runId: string,
    asset: {
      assetType: string;
      assetCode: string | null;
      assetIssuer: string | null;
      onchainBalance: number;
    },
  ): Promise<AssetReconciliation> {
    const { assetType, assetCode, assetIssuer, onchainBalance } = asset;

    const existingRes = await client.query(
      `SELECT id, balance FROM wallet_balances
       WHERE wallet_id = $1 AND asset_type = $2
         AND (asset_code IS NOT DISTINCT FROM $3)
         AND (asset_issuer IS NOT DISTINCT FROM $4)
       FOR UPDATE`,
      [walletId, assetType, assetCode, assetIssuer],
    );
    const existing = existingRes.rows[0];
    const beforeBalance = existing ? parseFloat(existing.balance) : 0;
    const discrepancy = onchainBalance - beforeBalance;

    if (Math.abs(discrepancy) <= EPSILON) {
      return {
        assetType,
        assetCode,
        assetIssuer,
        beforeBalance,
        afterBalance: beforeBalance,
        discrepancy: 0,
        changed: false,
        alerted: false,
      };
    }

    // Correct the stored balance.
    if (existing) {
      await client.query(
        `UPDATE wallet_balances
         SET balance = $1, last_updated = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [onchainBalance, existing.id],
      );
    } else {
      await client.query(
        `INSERT INTO wallet_balances
           (wallet_id, asset_type, asset_code, asset_issuer, balance, is_authorized, last_updated, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW(), NOW())`,
        [walletId, assetType, assetCode, assetIssuer, onchainBalance],
      );
    }

    // Real-time admin alert for material native (XLM) discrepancies.
    const isNative = assetType === "native";
    const discrepancyXlm = isNative ? discrepancy : null;
    let alerted = false;
    if (isNative && Math.abs(discrepancy) > DISCREPANCY_ALERT_XLM) {
      alerted = true;
      SocketService.emitToRoom("admin", "wallet:balance_discrepancy", {
        walletId,
        assetType,
        assetCode,
        assetIssuer,
        beforeBalance,
        afterBalance: onchainBalance,
        discrepancy,
        thresholdXlm: DISCREPANCY_ALERT_XLM,
        syncedAt: new Date().toISOString(),
      });
    }

    // Persist the correction (idempotent: only written because a real diff existed).
    await client.query(
      `INSERT INTO wallet_reconciliation_log
         (wallet_id, reconciliation_run_id, asset_type, asset_code, asset_issuer,
          before_balance, after_balance, discrepancy, discrepancy_xlm, alerted, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        walletId,
        runId,
        assetType,
        assetCode,
        assetIssuer,
        beforeBalance,
        onchainBalance,
        discrepancy,
        discrepancyXlm,
        alerted,
      ],
    );

    walletDiscrepanciesTotal.inc({ asset_type: assetType });

    return {
      assetType,
      assetCode,
      assetIssuer,
      beforeBalance,
      afterBalance: onchainBalance,
      discrepancy,
      changed: true,
      alerted,
    };
  },

  /**
   * Full reconciliation sweep across every active wallet. Intended to be run
   * nightly by the scheduler. Processes wallets in bounded concurrency to avoid
   * overloading Horizon.
   */
  async reconcileAll(batchSize = 10): Promise<ReconcileAllResult> {
    const start = Date.now();
    const { rows } = await pool.query(
      `SELECT id FROM wallets
       WHERE status = 'active' AND stellar_public_key IS NOT NULL AND deleted_at IS NULL`,
    );
    const walletIds = rows.map((r: { id: string }) => r.id);
    const totalWallets = walletIds.length;

    let processed = 0;
    let failed = 0;
    let totalChanges = 0;
    let totalDiscrepancies = 0;
    let totalAlerts = 0;

    for (let i = 0; i < walletIds.length; i += batchSize) {
      const batch = walletIds.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((id) =>
          this.syncWallet(id).catch((err) => {
            logger.error(
              "WalletReconciliationService.reconcileAll wallet error",
              { walletId: id, error: (err as Error).message },
            );
            failed++;
            return null;
          }),
        ),
      );
      for (const r of results) {
        if (!r) continue;
        processed++;
        totalChanges += r.changedAssets;
        totalDiscrepancies += r.discrepancies;
        if (r.alerted) totalAlerts++;
      }
    }

    const result: ReconcileAllResult = {
      triggeredAt: new Date().toISOString(),
      totalWallets,
      processed,
      failed,
      totalChanges,
      totalDiscrepancies,
      totalAlerts,
      durationMs: Date.now() - start,
    };

    logger.info("WalletReconciliationService.reconcileAll complete", result);
    return result;
  },
};
