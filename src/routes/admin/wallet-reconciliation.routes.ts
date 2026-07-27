/**
 * Admin API Routes for Wallet Reconciliation
 *
 * Endpoints for monitoring and triggering wallet reconciliations:
 * - GET /admin/wallets/reconciliation/status - Overall reconciliation status
 * - POST /admin/wallets/:userId/reconcile - Trigger manual reconciliation
 * - GET /admin/wallets/:userId/discrepancies - View detected discrepancies
 * - GET /admin/wallets/:userId/reconciliation-history - View reconciliation history
 * - POST /admin/wallets/reconciliation/batch - Trigger batch reconciliation
 */

import { Router, Request, Response, NextFunction } from "express";
import { requireAdmin } from "../../middleware/auth.middleware";
import { WalletReconciliationService } from "../../services/wallet-reconciliation.service";
import { WalletModel } from "../../models/wallet.model";
import { logger } from "../../utils/logger.utils";
import { AppError } from "../../types/error.types";
import { NOT_FOUND_CODES } from "../../constants/error-codes";

const router = Router();

/**
 * Apply admin authentication to all routes
 */
router.use(requireAdmin);

/**
 * GET /admin/wallets/reconciliation/status
 *
 * Returns overall reconciliation status across platform
 */
router.get(
  "/reconciliation/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats =
        await WalletReconciliationService.getReconciliationStats();

      res.status(200).json({
        status: "success",
        data: {
          timestamp: new Date().toISOString(),
          stats,
          recommendations:
            stats.walletsNeedingReconciliation > 0
              ? [
                  {
                    severity: "high",
                    message: `${stats.walletsNeedingReconciliation} wallets need reconciliation`,
                    action: "POST /admin/wallets/reconciliation/batch",
                  },
                ]
              : [],
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /admin/wallets/:userId/reconcile
 *
 * Trigger manual reconciliation for a specific wallet
 * Detects and corrects discrepancies between PostgreSQL and Stellar
 */
router.post(
  "/:userId/reconcile",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;

      // Verify wallet exists
      const wallet = await WalletModel.findByUserId(userId);
      if (!wallet) {
        throw new AppError(
          NOT_FOUND_CODES.WALLET_NOT_FOUND as any,
          "Wallet not found",
          { userId }
        );
      }

      logger.info("Manual wallet reconciliation requested", {
        userId,
        requestedBy: (req as any).user?.email,
      });

      // Perform reconciliation
      const result =
        await WalletReconciliationService.reconcileWallet(userId);

      res.status(200).json({
        status: "success",
        data: {
          result,
          summary: {
            discrepanciesFound: result.discrepancies.length,
            discrepanciesCorrected: result.corrected
              ? result.correctionDetails?.totalCorrectedAssets || 0
              : 0,
            action: result.corrected ? "corrected" : "none_needed",
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /admin/wallets/:userId/discrepancies
 *
 * Check for discrepancies without correcting them
 * Useful for investigation before applying corrections
 */
router.get(
  "/:userId/discrepancies",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;

      const discrepancies =
        await WalletReconciliationService.checkForDiscrepancies(userId);

      if (discrepancies === null) {
        throw new AppError(
          NOT_FOUND_CODES.WALLET_NOT_FOUND as any,
          "Wallet not found",
          { userId }
        );
      }

      res.status(200).json({
        status: "success",
        data: {
          userId,
          discrepancies,
          summary: {
            totalDiscrepancies: discrepancies.length,
            totalAmountAffected: discrepancies
              .reduce((sum, d) => sum + parseFloat(d.discrepancyAmount), 0)
              .toString(),
            byReason: {
              direct_payment: discrepancies.filter(
                (d) => d.discrepancyReason === "direct_payment"
              ).length,
              missed_event: discrepancies.filter(
                (d) => d.discrepancyReason === "missed_event"
              ).length,
              external_transaction: discrepancies.filter(
                (d) => d.discrepancyReason === "external_transaction"
              ).length,
              unknown: discrepancies.filter((d) => d.discrepancyReason === "unknown")
                .length,
            },
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /admin/wallets/:userId/reconciliation-history
 *
 * View reconciliation history for a specific wallet
 */
router.get(
  "/:userId/reconciliation-history",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

      // Verify wallet exists
      const wallet = await WalletModel.findByUserId(userId);
      if (!wallet) {
        throw new AppError(
          NOT_FOUND_CODES.WALLET_NOT_FOUND as any,
          "Wallet not found",
          { userId }
        );
      }

      const history =
        await WalletReconciliationService.getReconciliationHistory(
          userId,
          limit
        );

      res.status(200).json({
        status: "success",
        data: {
          userId,
          reconciliationCount: history.length,
          history,
          statistics: {
            totalDiscrepancies: history.reduce(
              (sum, h) => sum + h.discrepanciesFound,
              0
            ),
            totalCorrected: history.reduce((sum, h) => sum + h.correctedCount, 0),
            averageDiscrepancies: (
              history.reduce((sum, h) => sum + h.discrepanciesFound, 0) /
              (history.length || 1)
            ).toFixed(2),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /admin/wallets/reconciliation/batch
 *
 * Trigger batch reconciliation for wallets that need it
 * Useful as a background job or maintenance task
 */
router.post(
  "/reconciliation/batch",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { maxReconciliations = 100, maxAgeHours = 24 } = req.body;

      logger.info("Batch wallet reconciliation started", {
        maxReconciliations,
        maxAgeHours,
        requestedBy: (req as any).user?.email,
      });

      const result =
        await WalletReconciliationService.reconcileAllWallets(
          maxReconciliations,
          maxAgeHours
        );

      res.status(200).json({
        status: "success",
        data: {
          result,
          summary: {
            processed: result.processed,
            corrected: result.corrected,
            failed: result.failed,
            successRate: (
              ((result.processed - result.failed) / result.processed) *
              100
            ).toFixed(2) + "%",
            recommendedAction:
              result.failed > 0
                ? `Review ${result.failed} failed reconciliations`
                : "All reconciliations completed successfully",
          },
          errors: result.errors.length > 0 ? result.errors : undefined,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /admin/wallets/:userId/reconcile-asset
 *
 * Reconcile a specific asset for a wallet
 * Useful for post-payment verification of a single asset
 */
router.post(
  "/:userId/reconcile-asset",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      const { assetCode, assetIssuer } = req.body;

      if (!assetCode) {
        throw new AppError(
          "VALIDATION_MISSING_REQUIRED_FIELD" as any,
          "assetCode is required"
        );
      }

      const discrepancy =
        await WalletReconciliationService.reconcileAsset(
          userId,
          assetCode,
          assetIssuer
        );

      res.status(200).json({
        status: "success",
        data: {
          userId,
          assetCode,
          assetIssuer: assetIssuer || null,
          discrepancy: discrepancy || null,
          hasDiscrepancy: discrepancy !== null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
