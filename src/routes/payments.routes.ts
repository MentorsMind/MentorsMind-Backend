/**
 * Payment Routes
 * POST   /api/v1/payments           - Initiate payment
 * GET    /api/v1/payments           - List user payments
 * GET    /api/v1/payments/history   - Payment history
 * POST   /api/v1/payments/webhook   - Stellar webhook
 * GET    /api/v1/payments/:id       - Get payment details
 * GET    /api/v1/payments/:id/status - Check payment status
 * POST   /api/v1/payments/:id/confirm - Confirm payment
 * POST   /api/v1/payments/:id/refund  - Process refund
 */

import { Router } from "express";
import { PaymentsController } from "../controllers/payments.controller";
import { authenticate } from "../middleware/auth.middleware";
import { idempotency } from "../middleware/idempotency.middleware";
import { validate } from "../middleware/validation.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import {
  initiatePaymentSchema,
  confirmPaymentSchema,
  refundPaymentSchema,
  webhookPaymentSchema,
  listPaymentsSchema,
  getPaymentByIdSchema,
} from "../validators/schemas/payments.schemas";
import { FeeEstimateController } from "../controllers/feeEstimate.controller";

const router = Router();

/**
 * @swagger
 * /payments/webhook:
 *   post:
 *     summary: Handle Stellar webhook events
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *               transaction_hash:
 *                 type: string
 *               from:
 *                 type: string
 *               to:
 *                 type: string
 *               amount:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post(
  "/webhook",
  validate(webhookPaymentSchema),
  asyncHandler(PaymentsController.handleWebhook),
);

// All routes below require authentication
router.use(authenticate);

/**
 * @swagger
 * /payments:
 *   post:
 *     summary: Initiate a payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Unique key to prevent duplicate payments
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingId, amount]
 *             properties:
 *               bookingId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: string
 *                 example: "100.0000000"
 *               currency:
 *                 type: string
 *                 default: XLM
 *               description:
 *                 type: string
 *               fromAddress:
 *                 type: string
 *               toAddress:
 *                 type: string
 *     responses:
 *       201:
 *         description: Payment initiated
 */
router.post(
  "/",
  idempotency,
  validate(initiatePaymentSchema),
  asyncHandler(PaymentsController.initiatePayment),
);

/**
 * @swagger
 * /payments:
 *   get:
 *     summary: List user payments
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, processing, completed, failed, cancelled, refunded]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [payment, refund, platform_fee, mentor_payout, escrow_hold, escrow_release]
 *     responses:
 *       200:
 *         description: List of payments
 */
router.get(
  "/",
  validate(listPaymentsSchema),
  asyncHandler(PaymentsController.listPayments),
);

/**
 * @swagger
 * /payments/history:
 *   get:
 *     summary: Get payment history (completed payments only)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment history with total volume
 */
router.get(
  "/history",
  validate(listPaymentsSchema),
  asyncHandler(PaymentsController.getPaymentHistory),
);

/**
 * @swagger
 * /payments/fee-estimate:
 *   get:
 *     summary: Get Stellar fee estimate
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: operations
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Number of operations in transaction
 *     responses:
 *       200:
 *         description: Fee estimate retrieved successfully
 */
router.get("/fee-estimate", asyncHandler(FeeEstimateController.getFeeEstimate));

/**
 * @swagger
 * /payments/{id}:
 *   get:
 *     summary: Get payment details
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment details
 *       404:
 *         description: Payment not found
 */
router.get(
  "/:id",
  validate(getPaymentByIdSchema),
  asyncHandler(PaymentsController.getPayment),
);

/**
 * @swagger
 * /payments/{id}/status:
 *   get:
 *     summary: Check payment status
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment status
 */
router.get(
  "/:id/status",
  validate(getPaymentByIdSchema),
  asyncHandler(PaymentsController.getPaymentStatus),
);

/**
 * @swagger
 * /payments/{id}/confirm:
 *   post:
 *     summary: Confirm payment with Stellar transaction hash
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stellarTxHash]
 *             properties:
 *               stellarTxHash:
 *                 type: string
 *                 pattern: ^[a-fA-F0-9]{64}$
 *     responses:
 *       200:
 *         description: Payment confirmed
 */
router.post(
  "/:id/confirm",
  validate(confirmPaymentSchema),
  asyncHandler(PaymentsController.confirmPayment),
);

/**
 * @swagger
 * /payments/{id}/refund:
 *   post:
 *     summary: Process a refund
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *               stellarTxHash:
 *                 type: string
 *                 pattern: ^[a-fA-F0-9]{64}$
 *     responses:
 *       200:
 *         description: Refund processed
 */
router.post(
  "/:id/refund",
  validate(refundPaymentSchema),
  asyncHandler(PaymentsController.refundPayment),
);

export default router;
