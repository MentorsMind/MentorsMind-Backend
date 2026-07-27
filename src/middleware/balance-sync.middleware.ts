/**
 * Balance Sync Middleware
 * 
 * Ensures wallet balances are fresh before critical operations:
 * - Payout requests
 * - Large transactions
 * - Booking payments
 * 
 * Strategy:
 * 1. Check if balance was last synced recently (configurable threshold)
 * 2. If too old, perform pre-operation sync
 * 3. Reject operation if balance is insufficient after sync
 * 4. Log all pre-operation syncs for auditing
 */

import { Request, Response, NextFunction } from 'express';
import { WalletSyncService } from '../services/wallet-sync.service';
import { WalletModel } from '../models/wallet.model';
import { logger } from '../utils/logger.utils';

interface BalanceSyncOptions {
  thresholdMinutes?: number; // How old before re-sync (default: 5)
  requiredBalance?: string; // Minimum balance required (optional)
  asset?: string; // Asset to check (default: XLM)
  strict?: boolean; // Fail if sync fails (default: false, just warn)
}

/**
 * Middleware: Sync balance before critical operation
 * 
 * Usage:
 * router.post('/payouts', ensureBalanceSync({ thresholdMinutes: 1 }), handler);
 */
export function ensureBalanceSync(options: BalanceSyncOptions = {}) {
  const thresholdMinutes = options.thresholdMinutes || 5;
  const strict = options.strict ?? false;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as any).user?.userId;
    if (!userId) {
      next();
      return;
    }

    try {
      // Check if balance sync is needed
      const needsSync = await WalletSyncService.needsPreOperationSync(userId, thresholdMinutes);

      if (needsSync) {
        logger.info('balance_sync_pre_operation', {
          userId,
          operation: `${req.method} ${req.path}`,
          threshold_minutes: thresholdMinutes,
        });

        try {
          // Perform sync
          const syncResult = await WalletSyncService.syncWallet(userId, 'pre_operation');

          // Store result for use in handler
          (req as any).balanceSyncResult = syncResult;

          // Log if drift was detected
          if (syncResult.hadDrift) {
            logger.warn('balance_drift_detected_pre_operation', {
              userId,
              driftedAssets: syncResult.driftedAssets,
              operation: `${req.method} ${req.path}`,
            });
          }

          // Check required balance if specified
          if (options.requiredBalance && options.asset) {
            const balance = syncResult.balances.find(b => b.assetCode === options.asset);
            if (balance) {
              const onChainBalance = parseFloat(balance.onChainBalance);
              const required = parseFloat(options.requiredBalance);

              if (onChainBalance < required) {
                return res.status(422).json({
                  status: 'error',
                  code: 'INSUFFICIENT_FUNDS',
                  message: `Insufficient ${options.asset} balance for this operation`,
                  details: {
                    context: {
                      required: options.requiredBalance,
                      available: balance.onChainBalance,
                      asset: options.asset,
                    },
                  },
                });
              }
            }
          }
        } catch (syncError) {
          logger.error('balance_sync_failed_pre_operation', {
            userId,
            error: syncError instanceof Error ? syncError.message : syncError,
            operation: `${req.method} ${req.path}`,
          });

          if (strict) {
            return res.status(503).json({
              status: 'error',
              code: 'SERVICE_UNAVAILABLE',
              message: 'Could not verify wallet balance',
            });
          }

          // Non-strict: log warning but continue
          logger.warn('balance_sync_error_continuing', { userId });
        }
      }

      next();
    } catch (error) {
      logger.error('balance_sync_middleware_error', {
        userId,
        error: error instanceof Error ? error.message : error,
      });

      if (strict) {
        return res.status(500).json({
          status: 'error',
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Wallet verification failed',
        });
      }

      next();
    }
  };
}

/**
 * Middleware: Validate balance before payout
 * 
 * Usage:
 * router.post('/payouts', validatePayoutBalance(), handler);
 */
export function validatePayoutBalance(options?: BalanceSyncOptions) {
  return ensureBalanceSync({
    thresholdMinutes: 1, // Fresh balance for payouts
    strict: true, // Fail if sync fails
    ...options,
  });
}

/**
 * Middleware: Validate balance before booking payment
 * 
 * Usage:
 * router.post('/bookings/:id/pay', validateBookingBalance(), handler);
 */
export function validateBookingBalance(options?: BalanceSyncOptions) {
  return ensureBalanceSync({
    thresholdMinutes: 2,
    asset: 'XLM',
    strict: false, // Warn but allow
    ...options,
  });
}

/**
 * Middleware: Track balance checks for analytics
 * 
 * Usage:
 * router.use(trackBalanceChecks());
 */
export function trackBalanceChecks() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as any).user?.userId;
    if (!userId) {
      next();
      return;
    }

    const syncResult = (req as any).balanceSyncResult;
    if (syncResult) {
      // Track in analytics/metrics system
      logger.debug('balance_check_tracked', {
        userId,
        operation: `${req.method} ${req.path}`,
        hadDrift: syncResult.hadDrift,
        syncDuration: syncResult.metadata.duration_ms,
      });
    }

    next();
  };
}

/**
 * Utility: Get balance sync result from request
 * 
 * Usage in route handler:
 * const syncResult = getBalanceSyncResult(req);
 */
export function getBalanceSyncResult(req: Request): any {
  return (req as any).balanceSyncResult;
}

/**
 * Utility: Check if balance check was performed
 */
export function wasBalanceCheckPerformed(req: Request): boolean {
  return !!(req as any).balanceSyncResult;
}
