import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { validate } from "../middleware/validation.middleware";
import { WalletActivationController } from "../controllers/walletActivation.controller";
import { WalletsController } from "../controllers/wallets.controller";
import { walletTransferSchema } from "../validators/schemas/wallet.schemas";

const router = Router();

/**
 * @swagger
 * /wallets/activate:
 *   post:
 *     summary: Activate Stellar wallet
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet activated successfully
 */
router.post(
  "/activate",
  authenticate,
  asyncHandler(WalletActivationController.activate),
);

/**
 * @swagger
 * /wallets/{id}/transfer:
 *   post:
 *     summary: Transfer funds from wallet
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - destinationAddress
 *             properties:
 *               amount:
 *                 type: string
 *                 description: Amount to transfer (up to 7 decimal places)
 *               destinationAddress:
 *                 type: string
 *                 description: Stellar destination address
 *               assetCode:
 *                 type: string
 *                 default: XLM
 *                 description: Asset code (1-12 alphanumeric characters)
 *               memo:
 *                 type: string
 *                 description: Optional memo (max 28 characters)
 *     responses:
 *       202:
 *         description: Transfer initiated successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Wallet not found
 */
router.post(
  "/:id/transfer",
  authenticate,
  validate(walletTransferSchema),
  asyncHandler(WalletsController.transfer),
);

router.post(
  "/defi/sync",
  authenticate,
  asyncHandler(WalletsController.syncDeFiPositions),
);

router.get(
  "/defi/positions",
  authenticate,
  asyncHandler(WalletsController.getDeFiPositions),
);

export default router;
