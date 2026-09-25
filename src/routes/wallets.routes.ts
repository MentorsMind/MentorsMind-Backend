import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { WalletActivationController } from "../controllers/walletActivation.controller";
import { WalletsController } from "../controllers/wallets.controller";

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
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post(
  "/activate",
  authenticate,
  asyncHandler(WalletActivationController.activate),
);

/**
 * @swagger
 * /wallets/defi/sync:
 *   post:
 *     summary: Sync DeFi positions
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: DeFi positions synced successfully
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post(
  "/defi/sync",
  authenticate,
  asyncHandler(WalletsController.syncDeFiPositions),
);

/**
 * @swagger
 * /wallets/defi/positions:
 *   get:
 *     summary: Get DeFi positions
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: DeFi positions retrieved successfully
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/defi/positions",
  authenticate,
  asyncHandler(WalletsController.getDeFiPositions),
);

/**
 * @swagger
 * /wallets/me:
 *   get:
 *     summary: Get current user wallet info
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WalletInfo'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/me",
  authenticate,
  asyncHandler(WalletsController.getWalletInfo),
);

/**
 * @swagger
 * /wallets/me/balance:
 *   get:
 *     summary: Get user wallet balance
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: assetCode
 *         schema:
 *           type: string
 *         description: Asset code to query
 *       - in: query
 *         name: assetIssuer
 *         schema:
 *           type: string
 *         description: Asset issuer address
 *     responses:
 *       200:
 *         description: Balance retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WalletBalanceResponse'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/me/balance",
  authenticate,
  asyncHandler(WalletsController.getBalance),
);

/**
 * @swagger
 * /wallets/me/transactions:
 *   get:
 *     summary: Get user transaction history
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Transaction history retrieved successfully
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/me/transactions",
  authenticate,
  asyncHandler(WalletsController.getTransactions),
);

/**
 * @swagger
 * /wallets/payout:
 *   post:
 *     summary: Request a payout / transfer
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: string
 *               assetCode:
 *                 type: string
 *               assetIssuer:
 *                 type: string
 *               destinationAddress:
 *                 type: string
 *               memo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payout request created successfully
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post(
  "/payout",
  authenticate,
  asyncHandler(WalletsController.requestPayout),
);

/**
 * @swagger
 * /wallets/trustline:
 *   post:
 *     summary: Add trustline for an asset
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assetCode:
 *                 type: string
 *               assetIssuer:
 *                 type: string
 *               limit:
 *                 type: string
 *     responses:
 *       200:
 *         description: Trustline operation prepared successfully
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.post(
  "/trustline",
  authenticate,
  asyncHandler(WalletsController.addTrustline),
);

/**
 * @swagger
 * /wallets/me/earnings:
 *   get:
 *     summary: Get earnings summary
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: assetCode
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Earnings summary retrieved successfully
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/me/earnings",
  authenticate,
  asyncHandler(WalletsController.getEarnings),
);

/**
 * @swagger
 * /wallets/me/payouts:
 *   get:
 *     summary: Get payout requests
 *     tags: [Wallets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Payout requests retrieved successfully
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/me/payouts",
  authenticate,
  asyncHandler(WalletsController.getPayoutRequests),
);

export default router;
