/**
 * Payments Service
 * Business logic for payment processing with Stellar integration.
 */

import pool from "../config/database";
import { BookingModel } from "../models/booking.model";
import { stellarService } from "./stellar.service";
import {
  AssetExchangeService,
  SUPPORTED_ASSETS,
  MAX_SLIPPAGE_PCT,
} from "./assetExchange.service";
import { createError } from "../middleware/errorHandler";
import { logger } from "../utils/logger.utils";
import { env } from "../config/env";
import { SocketService } from "./socket.service";
import { WalletModel } from "../models/wallet.model";
import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import {
  server,
  networkPassphrase,
  getPlatformKeypair,
} from "../config/stellar";
import { EncryptionUtil } from "../utils/encryption.utils";
import { PaginationUtil } from "../utils/pagination.utils";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded";
export type PaymentType =
  | "payment"
  | "refund"
  | "platform_fee"
  | "mentor_payout"
  | "escrow_hold"
  | "escrow_release";

export interface PaymentRecord {
  id: string;
  user_id: string;
  booking_id: string | null;
  type: PaymentType;
  status: PaymentStatus;
  amount: string;
  currency: string;
  asset_code: string | null;
  asset_issuer: string | null;
  stellar_tx_hash: string | null;
  from_address: string | null;
  to_address: string | null;
  platform_fee: string;
  description: string | null;
  error_message: string | null;
  quote_id: string | null;
  quoted_rate: string | null;
  path_payment: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface InitiatePaymentData {
  userId: string;
  bookingId: string;
  amount: string;
  currency?: string;
  description?: string;
  fromAddress?: string;
  toAddress?: string;
  /** Optional quote ID from GET /payments/quote — enables path payment with slippage guard */
  quoteId?: string;
}

const PLATFORM_FEE_PCT = parseInt(env.PLATFORM_FEE_PERCENTAGE, 10) / 100;

export const PaymentsService = {
  async initiatePayment(data: InitiatePaymentData): Promise<PaymentRecord> {
    const {
      userId,
      bookingId,
      amount,
      currency = "XLM",
      description,
      fromAddress,
      toAddress,
      quoteId,
    } = data;

    // Validate booking exists and belongs to user
    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw createError("Booking not found", 404);
    if (booking.mentee_id !== userId) throw createError("Access denied", 403);
    if (booking.payment_status === "paid")
      throw createError("Booking is already paid", 409);

    const platformFee = (parseFloat(amount) * PLATFORM_FEE_PCT).toFixed(7);

    // Resolve asset metadata
    const assetDef = SUPPORTED_ASSETS[currency.toUpperCase()];
    if (!assetDef) throw createError(`Unsupported currency: ${currency}`, 400);

    const assetCode = assetDef.code === "XLM" ? null : assetDef.code;
    const assetIssuer = assetDef.issuer ?? null;
    const assetType = assetDef.code === "XLM" ? "native" : "credit_alphanum4";

    // Validate quote if provided (enforces 2% rate-drift guard)
    let quotedRate: string | null = null;
    let isPathPayment = false;
    if (quoteId) {
      const quote = await AssetExchangeService.validateQuote(quoteId);
      quotedRate = quote.rate;
      isPathPayment = quote.pathPaymentRequired;
    }

    const { rows } = await pool.query<PaymentRecord>(
      `INSERT INTO transactions
         (user_id, booking_id, type, status, amount, currency,
          asset_code, asset_issuer, asset_type,
          from_address, to_address, platform_fee, description,
          quote_id, quoted_rate, path_payment,
          initiated_at, created_at, updated_at)
       VALUES ($1, $2, 'payment', 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               NOW(), NOW(), NOW())
       RETURNING *`,
      [
        userId,
        bookingId,
        amount,
        currency.toUpperCase(),
        assetCode,
        assetIssuer,
        assetType,
        fromAddress ?? null,
        toAddress ?? null,
        platformFee,
        description ?? null,
        quoteId ?? null,
        quotedRate,
        isPathPayment,
      ],
    );

    logger.info("Payment initiated", {
      paymentId: rows[0].id,
      userId,
      bookingId,
      currency,
      isPathPayment,
    });
    return rows[0];
  },

  async getPaymentById(
    paymentId: string,
    userId: string,
  ): Promise<PaymentRecord> {
    const { rows } = await pool.query<PaymentRecord>(
      `SELECT t.* FROM transactions t
       WHERE t.id = $1 AND t.user_id = $2`,
      [paymentId, userId],
    );
    if (!rows[0]) throw createError("Payment not found", 404);
    return rows[0];
  },

  async getPaymentStatus(
    paymentId: string,
    userId: string,
  ): Promise<{
    id: string;
    status: PaymentStatus;
    stellarTxHash: string | null;
    updatedAt: Date;
  }> {
    const payment = await this.getPaymentById(paymentId, userId);
    return {
      id: payment.id,
      status: payment.status,
      stellarTxHash: payment.stellar_tx_hash,
      updatedAt: payment.updated_at,
    };
  },

  async confirmPayment(
    paymentId: string,
    userId: string,
    stellarTxHash: string,
  ): Promise<PaymentRecord> {
    const payment = await this.getPaymentById(paymentId, userId);

    if (payment.status === "completed")
      throw createError("Payment already confirmed", 409);
    if (!["pending", "processing"].includes(payment.status)) {
      throw createError(
        `Cannot confirm payment in ${payment.status} status`,
        400,
      );
    }

    // Verify transaction on Stellar network
    const tx = await stellarService.getTransaction(stellarTxHash);
    if (!tx.successful) {
      throw createError("Stellar transaction was not successful", 400);
    }
    if (payment.from_address && tx.source_account !== payment.from_address) {
      throw createError(
        "Transaction source account does not match payment sender",
        400,
      );
    }

    // Verify payment amount in transaction operations
    const operations =
      await stellarService.getTransactionOperations(stellarTxHash);
    const matchingPaymentOp = operations.find(
      (op) => op.type === "payment" && op.amount === payment.amount,
    );
    if (!matchingPaymentOp) {
      throw createError(
        "Transaction does not contain a matching payment amount",
        400,
      );
    }

    logger.info("Stellar transaction verified for payment", {
      paymentId,
      hash: tx.hash,
    });

    const { rows } = await pool.query<PaymentRecord>(
      `UPDATE transactions
       SET status = 'completed', stellar_tx_hash = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [paymentId, stellarTxHash],
    );

    if (!rows[0]) throw createError("Failed to confirm payment", 500);

    // Update booking payment status
    if (payment.booking_id) {
      await pool.query(
        `UPDATE bookings SET payment_status = 'paid', stellar_tx_hash = $2, updated_at = NOW() WHERE id = $1`,
        [payment.booking_id, stellarTxHash],
      );
    }

    // Emit payment:confirmed event to the user
    SocketService.emitToUser(payment.user_id, "payment:confirmed", {
      paymentId,
      bookingId: payment.booking_id,
      amount: payment.amount,
      currency: payment.currency,
      stellarTxHash,
      completedAt: rows[0].completed_at,
    });

    logger.info("Payment confirmed", { paymentId, stellarTxHash });
    return rows[0];
  },

  async listUserPayments(
    userId: string,
    filters: {
      cursor?: string;
      limit?: number;
      status?: PaymentStatus;
      type?: PaymentType;
      from?: string;
      to?: string;
    },
  ): Promise<{
    payments: PaymentRecord[];
    next_cursor: string | null;
    has_more: boolean;
    total: number;
  }> {
    const limit = filters.limit ?? 20;

    const conditions: string[] = ["t.user_id = $1"];
    const params: unknown[] = [userId];
    let idx = 2;

    if (filters.cursor) {
      const decoded = PaginationUtil.decodeCursor(filters.cursor);
      if (decoded) {
        conditions.push(`(t.created_at, t.id) < ($${idx}, $${idx + 1})`);
        params.push(decoded.created_at, decoded.id);
        idx += 2;
      }
    }

    if (filters.status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.type) {
      conditions.push(`t.type = $${idx++}`);
      params.push(filters.type);
    }
    if (filters.from) {
      conditions.push(`t.created_at >= $${idx++}`);
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push(`t.created_at <= $${idx++}`);
      params.push(filters.to);
    }

    const where = conditions.join(" AND ");

    // Count query uses the same filters (without limit)
    const countParams = [...params];

    // Add limit as a proper parameter
    params.push(limit + 1);
    const limitPlaceholder = `$${idx++}`;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query<PaymentRecord>(
        `SELECT * FROM transactions t WHERE ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT ${limitPlaceholder}`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*) FROM transactions t WHERE ${where}`,
        countParams,
      ),
    ]);

    const has_more = rows.length > limit;
    const data = has_more ? rows.slice(0, limit) : rows;

    const lastItem = data[data.length - 1];
    const next_cursor =
      has_more && lastItem
        ? PaginationUtil.encodeCursor(
            PaginationUtil.getCursorFromItem(lastItem)!,
          )
        : null;

    return {
      payments: data,
      next_cursor,
      has_more,
      total: parseInt(countRows[0].count, 10),
    };
  },

  async getPaymentHistory(
    userId: string,
    filters: { cursor?: string; limit?: number; from?: string; to?: string },
  ): Promise<{
    payments: PaymentRecord[];
    next_cursor: string | null;
    has_more: boolean;
    total: number;
    totalVolume: string;
  }> {
    const result = await this.listUserPayments(userId, {
      ...filters,
      status: "completed",
    });

    // For volume we only sum completed ones
    const { rows } = await pool.query<{ total_volume: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total_volume
       FROM transactions
       WHERE user_id = $1 AND status = 'completed'`,
      [userId],
    );

    return { ...result, totalVolume: rows[0]?.total_volume ?? "0" };
  },

  async refundPayment(
    paymentId: string,
    userId: string,
    amount?: string,
    reason?: string,
    stellarTxHash?: string,
  ): Promise<PaymentRecord> {
    const payment = await this.getPaymentById(paymentId, userId);

    if (payment.status === "refunded")
      throw createError("Payment already refunded", 409);
    if (payment.status !== "completed")
      throw createError("Only completed payments can be refunded", 400);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Mark original payment as refunded
      const { rows } = await client.query<PaymentRecord>(
        `UPDATE transactions SET status = 'refunded', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [paymentId],
      );

      // Create refund transaction record
      const refundAmount = amount || payment.amount;
      const refundStatus = stellarTxHash ? "completed" : "pending";
      const completedAt = stellarTxHash ? "NOW()" : null;
      await client.query(
        `INSERT INTO transactions
           (user_id, booking_id, type, status, amount, currency, stellar_tx_hash,
            related_transaction_id, description, asset_type, initiated_at, completed_at, created_at, updated_at)
         VALUES ($1, $2, 'refund', $3, $4, $5, $6, $7, $8, 'native', NOW(), ${completedAt}, NOW(), NOW())`,
        [
          userId,
          payment.booking_id,
          refundStatus,
          refundAmount,
          payment.currency,
          stellarTxHash ?? null,
          paymentId,
          reason ?? "Refund requested",
        ],
      );

      if (payment.booking_id && stellarTxHash) {
        await client.query(
          `UPDATE bookings SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
          [payment.booking_id],
        );
      }

      await client.query("COMMIT");
      logger.info("Payment refunded", { paymentId, userId });
      return rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async handleWebhook(payload: {
    type: string;
    transaction_hash?: string;
    from?: string;
    to?: string;
    amount?: string;
    asset_code?: string;
    memo?: string;
  }): Promise<{ processed: boolean; message: string }> {
    logger.info("Stellar webhook received", {
      type: payload.type,
      txHash: payload.transaction_hash,
    });

    if (!payload.transaction_hash) {
      return { processed: false, message: "No transaction hash provided" };
    }

    // Find pending payment matching this transaction hash or to_address
    const { rows } = await pool.query<PaymentRecord>(
      `SELECT * FROM transactions
       WHERE (stellar_tx_hash = $1 OR to_address = $2)
         AND status IN ('pending', 'processing')
       LIMIT 1`,
      [payload.transaction_hash, payload.to ?? null],
    );

    if (!rows[0]) {
      logger.info("No matching pending payment for webhook", {
        txHash: payload.transaction_hash,
      });
      return { processed: false, message: "No matching payment found" };
    }

    const payment = rows[0];

    await pool.query(
      `UPDATE transactions
       SET status = 'completed', stellar_tx_hash = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [payment.id, payload.transaction_hash],
    );

    if (payment.booking_id) {
      await pool.query(
        `UPDATE bookings SET payment_status = 'paid', stellar_tx_hash = $2, updated_at = NOW() WHERE id = $1`,
        [payment.booking_id, payload.transaction_hash],
      );
    }

    logger.info("Webhook processed payment", {
      paymentId: payment.id,
      txHash: payload.transaction_hash,
    });
    return { processed: true, message: "Payment confirmed via webhook" };
  },
};
