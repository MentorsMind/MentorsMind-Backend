/**
 * Wallet Reconciliation Service
 *
 * Detects and corrects discrepancies between PostgreSQL wallet_balances
 * and the authoritative Stellar network. Handles:
 * - Direct XLM payments to wallet (outside platform)
 * - Missed Horizon stream events
 * - Transactions processed outside platform
 * - Multiple asset balances per wallet
 *
 * Reconciliation is triggered by:
 * 1. Manual reconciliation requests (admin/user dashboard)
 * 2. Automatic periodic checks (background job)
 * 3. Pre-payout verification (before calculating payouts)
 * 4. Balance anomaly detection
 */

import { db } from "../config/database";
import { stellarService } from "./stellar.service";
import { WalletModel, type Wallet } from "../models/wallet.model";
import { logger } from "../utils/logger.utils";
import { AppError, ExternalServiceError } from "../types/error.types";
import { SERVICE_CODES, PAYMENT_CODES } from "../constants/error-codes";

export interface WalletBalance {
  asset_code: string;
  asset_issuer: string | null;
  balance: string;
  updated_at: Date;
}

export interface StellarBalance {
  assetCode: string;
  assetIssuer: string | null;
  balance: string;
}

export interface BalanceDiscrepancy {
  assetCode: string;
  assetIssuer: string | null;
  postgresBalance: string;
  stellarBalance: string;
  discrepancyAmount: string;
  discrepancyReason:
    | "direct_payment"
    | "missed_event"
    | "external_transaction"
    | "unknown";
  shouldCorrect: boolean;
}

export interface ReconciliationResult {
  userId: string;
  wallet: Wallet;
  timestamp: Date;
  discrepancies: BalanceDiscrepancy[];
  corrected: boolean;
  correctionDetails?: {
    correctedAssets: string[];
    totalCorrectedAssets: number;
    updatedAt: Date;
  };
  errors?: string[];
}

/**
 * Get all balances for a wallet from PostgreSQL
 */
async function getPostgresBalances(userId: string): Promise<WalletBalance[]> {
  const query = `
    SELECT 
      asset_code,
      asset_issuer,
      balance,
      updated_at
    FROM wallet_balances
    WHERE user_id = $1
    ORDER BY asset_code ASC;
  `;

  const { rows } = await db.query(query, [userId]);
  return rows;
}

/**
 * Get all balances for a wallet from Stellar network
 * Fetches account info and parses all trustlines
 */
async function getStellarBalances(
  stellarPublicKey: string
): Promise<StellarBalance[]> {
  try {
    const account = await stellarService.getAccount(stellarPublicKey);

    const balances: StellarBalance[] = [];

    // Add native XLM balance
    if (account.balances.native) {
      balances.push({
        assetCode: "XLM",
        assetIssuer: null,
        balance: account.balances.native,
      });
    }

    // Add issued asset balances
    for (const [assetCode, assets] of Object.entries(
      account.balances.issued || {}
    )) {
      for (const asset of assets) {
        balances.push({
          assetCode,
          assetIssuer: asset.issuer,
          balance: asset.balance,
        });
      }
    }

    return balances;
  } catch (err) {
    logger.error("Failed to fetch Stellar balances", {
      stellarPublicKey,
      error: String(err),
    });
    throw new ExternalServiceError(
      "Stellar",
      SERVICE_CODES.EXTERNAL_API_ERROR,
      "Failed to fetch wallet balances from Stellar",
      err as Error,
      { stellarPublicKey }
    );
  }
}

/**
 * Compare PostgreSQL and Stellar balances to detect discrepancies
 */
function detectDiscrepancies(
  postgresBalances: WalletBalance[],
  stellarBalances: StellarBalance[]
): BalanceDiscrepancy[] {
  const discrepancies: BalanceDiscrepancy[] = [];

  // Create maps for easier lookup
  const pgMap = new Map(
    postgresBalances.map((b) => [
      `${b.asset_code}:${b.asset_issuer || "null"}`,
      b,
    ])
  );

  const stellarMap = new Map(
    stellarBalances.map((b) => [`${b.assetCode}:${b.assetIssuer || "null"}`, b])
  );

  // Check for differences in existing assets
  for (const [key, pgBalance] of pgMap) {
    const stellarBalance = stellarMap.get(key);

    if (!stellarBalance) {
      // Asset exists in PostgreSQL but not on Stellar (removed/revoked)
      discrepancies.push({
        assetCode: pgBalance.asset_code,
        assetIssuer: pgBalance.asset_issuer,
        postgresBalance: pgBalance.balance,
        stellarBalance: "0",
        discrepancyAmount: pgBalance.balance,
        discrepancyReason: "missed_event", // Trustline was revoked/removed
        shouldCorrect: true,
      });
    } else if (pgBalance.balance !== stellarBalance.balance) {
      // Balance mismatch - determine reason
      const pgBal = parseFloat(pgBalance.balance);
      const stellarBal = parseFloat(stellarBalance.balance);
      const difference = stellarBal - pgBal;

      let reason: BalanceDiscrepancy["discrepancyReason"] = "unknown";

      // If Stellar balance is higher, likely direct payment
      if (difference > 0) {
        reason = "direct_payment";
      } else if (difference < 0) {
        // If Stellar balance is lower, likely external transaction
        reason = "external_transaction";
      }

      discrepancies.push({
        assetCode: pgBalance.asset_code,
        assetIssuer: pgBalance.asset_issuer,
        postgresBalance: pgBalance.balance,
        stellarBalance: stellarBalance.balance,
        discrepancyAmount: Math.abs(difference).toString(),
        discrepancyReason: reason,
        shouldCorrect: true,
      });
    }
  }

  // Check for new assets on Stellar (not yet in PostgreSQL)
  for (const [key, stellarBalance] of stellarMap) {
    if (!pgMap.has(key)) {
      discrepancies.push({
        assetCode: stellarBalance.assetCode,
        assetIssuer: stellarBalance.assetIssuer,
        postgresBalance: "0",
        stellarBalance: stellarBalance.balance,
        discrepancyAmount: stellarBalance.balance,
        discrepancyReason: "direct_payment",
        shouldCorrect: true,
      });
    }
  }

  return discrepancies;
}

/**
 * Update wallet balances in PostgreSQL to match Stellar
 */
async function updateWalletBalances(
  userId: string,
  stellarBalances: StellarBalance[]
): Promise<string[]> {
  const correctedAssets: string[] = [];

  // Start transaction
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Delete all existing balances for this user
    await client.query("DELETE FROM wallet_balances WHERE user_id = $1", [
      userId,
    ]);

    // Insert new balances from Stellar
    const insertQuery = `
      INSERT INTO wallet_balances (user_id, asset_code, asset_issuer, balance)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, asset_code, asset_issuer)
      DO UPDATE SET balance = $4, updated_at = CURRENT_TIMESTAMP;
    `;

    for (const balance of stellarBalances) {
      await client.query(insertQuery, [
        userId,
        balance.assetCode,
        balance.assetIssuer,
        balance.balance,
      ]);
      correctedAssets.push(
        `${balance.assetCode}${balance.assetIssuer ? `:${balance.assetIssuer}` : ""}`
      );
    }

    // Log reconciliation event
    const eventQuery = `
      INSERT INTO wallet_reconciliation_logs 
      (user_id, discrepancies_found, corrected_count, status)
      VALUES ($1, $2, $3, 'completed')
    `;
    await client.query(eventQuery, [
      userId,
      stellarBalances.length,
      correctedAssets.length,
    ]);

    await client.query("COMMIT");

    logger.info("Wallet reconciliation completed", {
      userId,
      correctedAssets: correctedAssets.length,
      details: correctedAssets,
    });

    return correctedAssets;
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Wallet reconciliation failed", {
      userId,
      error: String(err),
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Trigger balance update notification to user
 */
async function notifyBalanceUpdate(
  userId: string,
  discrepancies: BalanceDiscrepancy[]
): Promise<void> {
  try {
    // Log notification event
    const query = `
      INSERT INTO wallet_notifications 
      (user_id, notification_type, data)
      VALUES ($1, 'balance_corrected', $2)
    `;

    await db.query(query, [userId, JSON.stringify({ discrepancies })]);

    logger.info("Balance update notification queued", {
      userId,
      discrepancyCount: discrepancies.length,
    });
  } catch (err) {
    logger.warn("Failed to queue balance notification", {
      userId,
      error: String(err),
    });
    // Don't throw - notification failure shouldn't block reconciliation
  }
}

export const WalletReconciliationService = {
  /**
   * Check if a wallet needs reconciliation
   * Detects significant discrepancies without correcting
   */
  async checkForDiscrepancies(
    userId: string
  ): Promise<BalanceDiscrepancy[] | null> {
    try {
      // Get wallet
      const wallet = await WalletModel.findByUserId(userId);
      if (!wallet) {
        return null;
      }

      // Get balances from both sources
      const pgBalances = await getPostgresBalances(userId);
      const stellarBalances = await getStellarBalances(wallet.stellar_public_key);

      // Detect discrepancies
      const discrepancies = detectDiscrepancies(pgBalances, stellarBalances);

      if (discrepancies.length > 0) {
        logger.warn("Wallet discrepancies detected", {
          userId,
          discrepancyCount: discrepancies.length,
          details: discrepancies,
        });
      }

      return discrepancies;
    } catch (err) {
      logger.error("Failed to check wallet discrepancies", {
        userId,
        error: String(err),
      });
      throw err;
    }
  },

  /**
   * Perform full reconciliation: detect discrepancies and correct them
   * This is the main reconciliation endpoint
   */
  async reconcileWallet(userId: string): Promise<ReconciliationResult> {
    const timestamp = new Date();

    try {
      // Get wallet
      const wallet = await WalletModel.findByUserId(userId);
      if (!wallet) {
        throw new AppError(
          "NOT_FOUND_WALLET" as any,
          "Wallet not found",
          { userId }
        );
      }

      // Get balances from both sources
      const pgBalances = await getPostgresBalances(userId);
      const stellarBalances = await getStellarBalances(
        wallet.stellar_public_key
      );

      // Detect discrepancies
      const discrepancies = detectDiscrepancies(pgBalances, stellarBalances);

      const result: ReconciliationResult = {
        userId,
        wallet,
        timestamp,
        discrepancies,
        corrected: false,
      };

      // If no discrepancies, return early
      if (discrepancies.length === 0) {
        logger.info("Wallet reconciliation - no discrepancies found", {
          userId,
        });
        return result;
      }

      // Correct discrepancies
      const correctedAssets = await updateWalletBalances(userId, stellarBalances);

      result.corrected = true;
      result.correctionDetails = {
        correctedAssets,
        totalCorrectedAssets: correctedAssets.length,
        updatedAt: new Date(),
      };

      // Notify user of balance changes
      await notifyBalanceUpdate(userId, discrepancies);

      logger.info("Wallet reconciliation completed successfully", {
        userId,
        discrepanciesFound: discrepancies.length,
        corrected: correctedAssets.length,
      });

      return result;
    } catch (err) {
      logger.error("Wallet reconciliation failed", {
        userId,
        error: String(err),
      });

      throw err;
    }
  },

  /**
   * Reconcile a specific asset balance only
   * Useful for post-payment verification
   */
  async reconcileAsset(
    userId: string,
    assetCode: string,
    assetIssuer?: string
  ): Promise<BalanceDiscrepancy | null> {
    try {
      const wallet = await WalletModel.findByUserId(userId);
      if (!wallet) {
        return null;
      }

      const pgBalances = await getPostgresBalances(userId);
      const stellarBalances = await getStellarBalances(
        wallet.stellar_public_key
      );

      const discrepancies = detectDiscrepancies(pgBalances, stellarBalances);
      const assetDiscrepancy = discrepancies.find(
        (d) =>
          d.assetCode === assetCode &&
          d.assetIssuer === (assetIssuer || null)
      );

      if (assetDiscrepancy) {
        logger.warn("Asset balance discrepancy detected", {
          userId,
          assetCode,
          assetIssuer,
          discrepancy: assetDiscrepancy,
        });
      }

      return assetDiscrepancy || null;
    } catch (err) {
      logger.error("Asset reconciliation failed", {
        userId,
        assetCode,
        error: String(err),
      });
      throw err;
    }
  },

  /**
   * Reconcile all wallets in batch (background job)
   * Reconciles wallets that haven't been checked recently
   */
  async reconcileAllWallets(
    maxReconciliations: number = 100,
    maxAgeHours: number = 24
  ): Promise<{
    processed: number;
    corrected: number;
    failed: number;
    errors: Array<{ userId: string; error: string }>;
  }> {
    const query = `
      SELECT w.user_id
      FROM wallets w
      LEFT JOIN wallet_reconciliation_logs wrl ON w.user_id = wrl.user_id
      WHERE w.status = 'active'
        AND (wrl.completed_at IS NULL OR wrl.completed_at < NOW() - INTERVAL '${maxAgeHours} hours')
      ORDER BY wrl.completed_at ASC NULLS FIRST
      LIMIT $1;
    `;

    const { rows } = await db.query(query, [maxReconciliations]);

    let processed = 0;
    let corrected = 0;
    let failed = 0;
    const errors: Array<{ userId: string; error: string }> = [];

    logger.info("Starting batch wallet reconciliation", {
      walletsToReconcile: rows.length,
    });

    for (const row of rows) {
      try {
        const result = await this.reconcileWallet(row.user_id);
        processed++;
        if (result.corrected) {
          corrected++;
        }
      } catch (err) {
        failed++;
        errors.push({
          userId: row.user_id,
          error: String(err),
        });
        logger.warn("Batch reconciliation failed for user", {
          userId: row.user_id,
          error: String(err),
        });
      }
    }

    logger.info("Batch wallet reconciliation completed", {
      processed,
      corrected,
      failed,
      errorCount: errors.length,
    });

    return { processed, corrected, failed, errors };
  },

  /**
   * Get reconciliation history for a wallet
   */
  async getReconciliationHistory(
    userId: string,
    limit: number = 50
  ): Promise<
    Array<{
      timestamp: Date;
      discrepanciesFound: number;
      correctedCount: number;
      status: string;
    }>
  > {
    const query = `
      SELECT 
        completed_at as timestamp,
        discrepancies_found,
        corrected_count,
        status
      FROM wallet_reconciliation_logs
      WHERE user_id = $1
      ORDER BY completed_at DESC
      LIMIT $2;
    `;

    const { rows } = await db.query(query, [userId, limit]);
    return rows;
  },

  /**
   * Get statistics on wallet reconciliation across platform
   */
  async getReconciliationStats(): Promise<{
    totalWallets: number;
    walletsReconciled: number;
    walletsNeedingReconciliation: number;
    averageDiscrepancies: number;
    totalDiscrepanciesCorrected: number;
  }> {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM wallets WHERE status = 'active') as total_wallets,
        (SELECT COUNT(DISTINCT user_id) FROM wallet_reconciliation_logs WHERE status = 'completed') as reconciled_wallets,
        (SELECT COUNT(DISTINCT w.user_id) 
         FROM wallets w 
         LEFT JOIN wallet_reconciliation_logs wrl ON w.user_id = wrl.user_id 
         WHERE w.status = 'active' AND wrl.completed_at IS NULL) as needs_reconciliation,
        (SELECT COALESCE(AVG(discrepancies_found), 0) FROM wallet_reconciliation_logs) as avg_discrepancies,
        (SELECT COALESCE(SUM(corrected_count), 0) FROM wallet_reconciliation_logs) as total_corrected;
    `;

    const { rows } = await db.query(query);
    const stats = rows[0];

    return {
      totalWallets: parseInt(stats.total_wallets, 10),
      walletsReconciled: parseInt(stats.reconciled_wallets, 10),
      walletsNeedingReconciliation: parseInt(stats.needs_reconciliation, 10),
      averageDiscrepancies: parseFloat(stats.avg_discrepancies),
      totalDiscrepanciesCorrected: parseInt(stats.total_corrected, 10),
    };
  },
};
