/**
 * Wallet Reconciliation Pre-Payout Middleware
 *
 * Middleware that automatically reconciles wallet balances before
 * payout operations to ensure accuracy. Prevents:
 * - Incorrect payout calculations due to stale balances
 * - Overdraft attempts against wrong balance
 * - Trust issues when balance differs from on-chain
 *
 * Usage:
 *   router.post('/payouts', walletReconciliationMiddleware, payoutHandler);
 */

import { Request, Response, NextFunction } from "express";
import { WalletReconciliationService } from "../services/wallet-reconciliation.service";
import { logger } from "../utils/logger.utils";

export interface ReconciliationContext {
  balancesReconciled: boolean;
  reconciliationErrors?: string[];
  discrepanciesFound?: number;
}

/**
 * Middleware to reconcile wallet before payout operations
 *
 * - Detects discrepancies between PostgreSQL and Stellar
 * - Corrects balances automatically
 * - Logs all corrections for audit trail
 * - Continues even if reconciliation fails (logs warning)
 */
export async function walletReconciliationPrePayoutMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = (req as any).user?.userId || (req as any).user?.id;

  if (!userId) {
    return next();
  }

  const context: ReconciliationContext = {
    balancesReconciled: false,
  };

  try {
    logger.debug("Running pre-payout wallet reconciliation", { userId });

    // Perform reconciliation
    const result = await WalletReconciliationService.reconcileWallet(userId);

    context.balancesReconciled = true;
    context.discrepanciesFound = result.discrepancies.length;

    if (result.discrepancies.length > 0) {
      logger.info("Wallet reconciliation found and corrected discrepancies", {
        userId,
        discrepanciesFound: result.discrepancies.length,
        corrected: result.corrected,
        correctedAssets: result.correctionDetails?.correctedAssets || [],
      });
    }
  } catch (err) {
    // Don't block payout on reconciliation failure, but warn
    context.reconciliationErrors = [String(err)];
    logger.warn("Pre-payout wallet reconciliation failed", {
      userId,
      error: String(err),
    });
  }

  // Attach reconciliation context to request
  (req as any).walletReconciliation = context;
  next();
}

/**
 * Middleware to verify wallet balance has been reconciled
 * Can be used in handlers to ensure payout balance is current
 *
 * Usage:
 *   router.post('/payouts', ensureWalletReconciled, payoutHandler);
 */
export async function ensureWalletReconciled(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const context = (req as any).walletReconciliation as
    | ReconciliationContext
    | undefined;

  if (!context || !context.balancesReconciled) {
    logger.warn("Payout requested without wallet reconciliation", {
      userId: (req as any).user?.userId,
      hasContext: !!context,
    });

    return res.status(400).json({
      status: "error",
      code: "PAYMENT_WALLET_UNVERIFIED",
      message:
        "Wallet balance could not be verified. Please try again or contact support.",
      details: {
        action: "Please refresh and retry the payout",
      },
    });
  }

  if (context.reconciliationErrors && context.reconciliationErrors.length > 0) {
    logger.warn("Payout requested with reconciliation errors", {
      userId: (req as any).user?.userId,
      errors: context.reconciliationErrors,
    });

    return res.status(503).json({
      status: "error",
      code: "SERVICE_UNAVAILABLE",
      message:
        "Wallet balance verification is temporarily unavailable. Please try again.",
      details: {
        action: "Please retry the payout in a few moments",
      },
    });
  }

  next();
}

/**
 * Attach reconciliation context to response for debugging
 * Only included in development or when explicitly requested
 */
export function includeReconciliationContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    const context = (req as any).walletReconciliation;

    if (context && (process.env.NODE_ENV === "development" || req.query.debug === "true")) {
      if (typeof data === "object" && data !== null) {
        data._wallet_reconciliation = {
          balancesReconciled: context.balancesReconciled,
          discrepanciesFound: context.discrepanciesFound,
          errors: context.reconciliationErrors,
        };
      }
    }

    return originalJson(data);
  };

  next();
}
