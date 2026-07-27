/**
 * Wallet Synchronization Service
 * 
 * Reconciles PostgreSQL wallet_balances with authoritative Stellar blockchain state.
 * Handles drift detection, reconciliation, and audit logging.
 * 
 * Drift causes:
 * 1. Direct on-chain transfers to user wallet (outside platform)
 * 2. Missed Horizon stream events
 * 3. Failed broadcast but confirmed transaction
 * 4. Multi-sig account transfers
 */

import { db } from '../config/database';
import { stellarService } from './stellar.service';
import { WalletModel } from '../models/wallet.model';
import { logger } from '../utils/logger.utils';
import { AppError, ErrorCode } from '../utils/app-error';

interface WalletBalance {
  assetCode: string;
  assetIssuer?: string;
  onChainBalance: string;
  dbBalance: string;
  drift: string; // difference
  driftPercentage: number;
  hasDrift: boolean;
}

interface SyncResult {
  userId: string;
  stellarAddress: string;
  balances: WalletBalance[];
  hadDrift: boolean;
  reconciled: boolean;
  driftedAssets: string[];
  metadata: {
    timestamp: string;
    source: 'manual' | 'scheduled' | 'pre_operation';
    duration_ms: number;
  };
}

interface DriftAudit {
  id: string;
  user_id: string;
  asset_code: string;
  on_chain_balance: string;
  db_balance: string;
  drift_amount: string;
  drift_percentage: number;
  reconciliation_action: 'auto_corrected' | 'flagged_for_review' | 'manual_intervention';
  sync_source: 'manual' | 'scheduled' | 'pre_operation';
  created_at: Date;
  resolved_at?: Date;
  resolution_notes?: string;
}

/**
 * Wallet balance synchronization service
 */
export const WalletSyncService = {
  /**
   * Sync a single wallet - fetch on-chain balances and compare with DB
   * 
   * @param userId - User ID to sync
   * @param source - Where sync was initiated (manual, scheduled, or pre_operation)
   * @returns Sync result with balance comparison and reconciliation status
   */
  async syncWallet(
    userId: string,
    source: 'manual' | 'scheduled' | 'pre_operation' = 'manual'
  ): Promise<SyncResult> {
    const startTime = Date.now();

    try {
      // Get user's wallet
      const wallet = await WalletModel.findByUserId(userId);
      if (!wallet) {
        throw AppError.notFound('Wallet', { userId });
      }

      // Fetch on-chain balances from Stellar
      const onChainBalances = await stellarService.getAccountBalances(wallet.stellar_public_key);

      // Fetch DB balances
      const dbBalances = await this.getWalletBalancesFromDB(userId);

      // Compare and detect drift
      const balanceComparison = await this.compareBalances(
        userId,
        wallet.stellar_public_key,
        onChainBalances,
        dbBalances
      );

      // Check if any balances have drifted
      const hadDrift = balanceComparison.some(b => b.hasDrift);

      // If drift detected, create audit records
      if (hadDrift) {
        await this.auditDrift(userId, source, balanceComparison);
      }

      // Reconcile: update DB with on-chain values (auto-correct)
      if (hadDrift && source !== 'manual') {
        await this.reconcileBalances(userId, onChainBalances);
      }

      const result: SyncResult = {
        userId,
        stellarAddress: wallet.stellar_public_key,
        balances: balanceComparison,
        hadDrift,
        reconciled: hadDrift && source !== 'manual',
        driftedAssets: balanceComparison
          .filter(b => b.hasDrift)
          .map(b => b.assetCode),
        metadata: {
          timestamp: new Date().toISOString(),
          source,
          duration_ms: Date.now() - startTime,
        },
      };

      // Log the sync
      logger.info('wallet_sync_completed', {
        userId,
        hadDrift,
        reconciled: result.reconciled,
        driftedAssets: result.driftedAssets,
        duration_ms: result.metadata.duration_ms,
        source,
      });

      return result;
    } catch (error) {
      logger.error('wallet_sync_failed', {
        userId,
        source,
        error: error instanceof Error ? error.message : error,
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  },

  /**
   * Sync multiple wallets (for batch operations)
   * 
   * @param userIds - Array of user IDs to sync
   * @param source - Where sync was initiated
   * @param options - Sync options
   * @returns Array of sync results
   */
  async syncWallets(
    userIds: string[],
    source: 'manual' | 'scheduled' | 'pre_operation' = 'manual',
    options?: {
      concurrency?: number;
      stopOnError?: boolean;
    }
  ): Promise<SyncResult[]> {
    const concurrency = options?.concurrency || 5;
    const stopOnError = options?.stopOnError ?? false;
    const results: SyncResult[] = [];
    const errors: Map<string, Error> = new Map();

    // Process in batches
    for (let i = 0; i < userIds.length; i += concurrency) {
      const batch = userIds.slice(i, i + concurrency);
      const batchPromises = batch.map(userId =>
        this.syncWallet(userId, source)
          .then(result => {
            results.push(result);
            return result;
          })
          .catch(error => {
            errors.set(userId, error as Error);
            if (stopOnError) {
              throw error;
            }
          })
      );

      try {
        await Promise.all(batchPromises);
      } catch (error) {
        if (stopOnError) throw error;
      }
    }

    logger.info('batch_wallet_sync_completed', {
      total: userIds.length,
      successful: results.length,
      failed: errors.size,
      duration_ms: Date.now(),
      source,
    });

    return results;
  },

  /**
   * Get wallet balances from database
   */
  async getWalletBalancesFromDB(userId: string): Promise<Record<string, string>> {
    const query = `
      SELECT asset_code, balance 
      FROM wallet_balances 
      WHERE user_id = $1
    `;
    const { rows } = await db.query(query, [userId]);

    const balances: Record<string, string> = {};
    for (const row of rows) {
      balances[row.asset_code] = row.balance;
    }
    return balances;
  },

  /**
   * Compare on-chain and DB balances to detect drift
   */
  async compareBalances(
    userId: string,
    stellarAddress: string,
    onChainBalances: Record<string, string>,
    dbBalances: Record<string, string>
  ): Promise<WalletBalance[]> {
    const comparison: WalletBalance[] = [];
    const DRIFT_THRESHOLD_PERCENT = 0.01; // 0.01% tolerance

    // Check all assets from both sources
    const allAssets = new Set([
      ...Object.keys(onChainBalances),
      ...Object.keys(dbBalances),
    ]);

    for (const asset of allAssets) {
      const onChain = onChainBalances[asset] || '0';
      const dbValue = dbBalances[asset] || '0';

      const onChainNum = parseFloat(onChain);
      const dbNum = parseFloat(dbValue);
      const drift = Math.abs(onChainNum - dbNum);
      const driftPercentage = dbNum > 0 ? (drift / dbNum) * 100 : drift > 0 ? 100 : 0;

      comparison.push({
        assetCode: asset,
        onChainBalance: onChain,
        dbBalance: dbValue,
        drift: drift.toString(),
        driftPercentage,
        hasDrift: driftPercentage > DRIFT_THRESHOLD_PERCENT,
      });
    }

    return comparison;
  },

  /**
   * Create audit record for detected drift
   */
  async auditDrift(
    userId: string,
    source: 'manual' | 'scheduled' | 'pre_operation',
    balances: WalletBalance[]
  ): Promise<void> {
    const driftedBalances = balances.filter(b => b.hasDrift);

    for (const balance of driftedBalances) {
      const driftAmount = Math.abs(
        parseFloat(balance.onChainBalance) - parseFloat(balance.dbBalance)
      );

      const query = `
        INSERT INTO wallet_balance_audits (
          user_id,
          asset_code,
          on_chain_balance,
          db_balance,
          drift_amount,
          drift_percentage,
          reconciliation_action,
          sync_source,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `;

      const reconciliationAction =
        source === 'manual' ? 'flagged_for_review' : 'auto_corrected';

      await db.query(query, [
        userId,
        balance.assetCode,
        balance.onChainBalance,
        balance.dbBalance,
        driftAmount.toString(),
        balance.driftPercentage,
        reconciliationAction,
        source,
      ]);
    }

    logger.warn('wallet_drift_detected', {
      userId,
      driftedCount: driftedBalances.length,
      source,
      details: driftedBalances.map(b => ({
        asset: b.assetCode,
        drift: b.drift,
        percentage: b.driftPercentage.toFixed(2),
      })),
    });
  },

  /**
   * Reconcile DB balances with on-chain values
   * Updates wallet_balances table with authoritative Stellar data
   */
  async reconcileBalances(
    userId: string,
    onChainBalances: Record<string, string>
  ): Promise<void> {
    // Use transaction to ensure atomicity
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Delete existing balances for this user
      await client.query('DELETE FROM wallet_balances WHERE user_id = $1', [userId]);

      // Insert updated balances from on-chain
      for (const [asset, balance] of Object.entries(onChainBalances)) {
        await client.query(
          `
          INSERT INTO wallet_balances (user_id, asset_code, balance, updated_at)
          VALUES ($1, $2, $3, NOW())
          `,
          [userId, asset, balance]
        );
      }

      await client.query('COMMIT');

      logger.info('wallet_balances_reconciled', {
        userId,
        assetsUpdated: Object.keys(onChainBalances).length,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Get drift audit history for a wallet
   */
  async getDriftHistory(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<DriftAudit[]> {
    const query = `
      SELECT * FROM wallet_balance_audits
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const { rows } = await db.query(query, [userId, limit, offset]);
    return rows;
  },

  /**
   * Get unresolved drift issues
   */
  async getUnresolvedDriftIssues(limit = 50): Promise<DriftAudit[]> {
    const query = `
      SELECT * FROM wallet_balance_audits
      WHERE reconciliation_action = 'flagged_for_review'
      AND resolved_at IS NULL
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const { rows } = await db.query(query, [limit]);
    return rows;
  },

  /**
   * Mark a drift issue as resolved
   */
  async resolveDriftIssue(
    auditId: string,
    action: 'confirmed_correct' | 'corrected' | 'ignored',
    notes?: string
  ): Promise<void> {
    const query = `
      UPDATE wallet_balance_audits
      SET resolved_at = NOW(),
          resolution_notes = $2,
          reconciliation_action = $3
      WHERE id = $1
    `;
    await db.query(query, [auditId, notes, action]);

    logger.info('drift_issue_resolved', {
      auditId,
      action,
      notes,
    });
  },

  /**
   * Get wallet sync statistics
   */
  async getSyncStatistics(days = 7): Promise<{
    totalWallets: number;
    walletsWithDrift: number;
    driftPercentage: number;
    mostCommonlyDriftedAssets: Array<{ asset: string; count: number }>;
    averageDriftAmount: string;
  }> {
    const driftQuery = `
      SELECT 
        COUNT(DISTINCT user_id) as drifted_count,
        asset_code,
        AVG(drift_amount::numeric) as avg_drift,
        COUNT(*) as occurrence_count
      FROM wallet_balance_audits
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY asset_code
      ORDER BY occurrence_count DESC
      LIMIT 10
    `;

    const totalQuery = `
      SELECT COUNT(DISTINCT id) as total
      FROM wallets
      WHERE status = 'active'
    `;

    const { rows: driftRows } = await db.query(driftQuery);
    const { rows: totalRows } = await db.query(totalQuery);

    const totalWallets = parseInt(totalRows[0]?.total || '0', 10);
    const walletsWithDrift = driftRows.length > 0
      ? parseInt(driftRows[0]?.drifted_count || '0', 10)
      : 0;

    const driftPercentage =
      totalWallets > 0 ? (walletsWithDrift / totalWallets) * 100 : 0;

    const mostCommonlyDriftedAssets = driftRows.map((row: any) => ({
      asset: row.asset_code,
      count: parseInt(row.occurrence_count, 10),
    }));

    const avgDrift =
      driftRows.length > 0 && driftRows[0]?.avg_drift
        ? parseFloat(driftRows[0].avg_drift).toFixed(8)
        : '0';

    return {
      totalWallets,
      walletsWithDrift,
      driftPercentage,
      mostCommonlyDriftedAssets,
      averageDriftAmount: avgDrift,
    };
  },

  /**
   * Check if wallet needs sync before critical operation
   * Returns true if balance was last synced > threshold ago
   */
  async needsPreOperationSync(userId: string, thresholdMinutes = 5): Promise<boolean> {
    const query = `
      SELECT MAX(created_at) as last_sync
      FROM wallet_balance_audits
      WHERE user_id = $1
      AND created_at > NOW() - INTERVAL '${thresholdMinutes} minutes'
    `;
    const { rows } = await db.query(query, [userId]);
    return !rows[0]?.last_sync;
  },
};

export default WalletSyncService;
