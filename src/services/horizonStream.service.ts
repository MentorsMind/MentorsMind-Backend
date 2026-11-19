import pool from "../config/database";
import { trackAndLogQuery } from '../middleware/queryLogger';
import { stellarService } from "./stellar.service";
import { WalletModel } from "../models/wallet.model";
import { SocketService } from "./socket.service";
import { logger } from "../utils/logger.utils";
import { EmailService } from "./email.service";
import {
  loadStellarStreamCursor,
  saveStellarStreamCursor,
} from "../utils/stellar-cursor.utils";
import {
  stellarStreamCursorGauge,
  stellarStreamDisconnectsTotal,
  stellarStreamFallbackPollingTotal,
  stellarStreamReconnectDelaySeconds,
  stellarStreamReconnectsTotal,
} from "../metrics/stellar-metrics";
import type { StellarPaymentRecord } from "../types/stellar.types";

const LARGE_TRANSACTION_THRESHOLD_XLM = 1000;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_STREAM_RECONNECTION_ATTEMPTS = 10;

interface StreamSubscription {
  close: (() => void) | null;
  reconnectAttempts: number;
  cursor: string;
  reconnectTimer: NodeJS.Timeout | null;
  fallbackPolling: boolean;
}

export class HorizonStreamService {
  private subscriptions = new Map<string, StreamSubscription>();

  async start(): Promise<void> {
    const accounts = await this.getPlatformAccounts();
    await Promise.all(accounts.map((account) => this.startForAccount(account)));
  }

  stop(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.close?.();
      if (subscription.reconnectTimer) {
        clearTimeout(subscription.reconnectTimer);
      }
    }
    this.subscriptions.clear();
  }

  async startForAccount(account: string): Promise<void> {
    const existing = this.subscriptions.get(account);
    if (existing?.close) {
      return;
    }

    const persistedCursor = await loadStellarStreamCursor(account);
    const state: StreamSubscription = existing ?? {
      close: null,
      reconnectAttempts: 0,
      cursor: persistedCursor,
      reconnectTimer: null,
      fallbackPolling: false,
    };

    state.cursor = persistedCursor;
    state.fallbackPolling = false;

    state.close = stellarService.streamPayments(
      account,
      async (payment) => {
        state.cursor = payment.id;
        state.reconnectAttempts = 0;
        await saveStellarStreamCursor(account, payment.id);
        stellarStreamCursorGauge.set({ account }, Date.now());
        await this.processPaymentOperation(payment, account);
      },
      state.cursor,
      () => {
        stellarStreamDisconnectsTotal.inc({ account });
        this.scheduleReconnect(account);
      },
    );

    this.subscriptions.set(account, state);
    logger.info("Horizon stream subscribed", { account, cursor: state.cursor });
  }

  scheduleReconnect(account: string): void {
    const state = this.subscriptions.get(account);
    if (!state || state.reconnectTimer || state.fallbackPolling) {
      return;
    }

    if (state.reconnectAttempts >= MAX_STREAM_RECONNECTION_ATTEMPTS) {
      this.startFallbackPolling(account).catch((error) => {
        logger.error("Failed to start Stellar fallback polling", {
          account,
          error: error instanceof Error ? error.message : error,
        });
      });
      return;
    }

    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** state.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );
    state.reconnectAttempts += 1;
    stellarStreamReconnectDelaySeconds.observe({ account }, delay / 1000);
    stellarStreamReconnectsTotal.inc({ account, outcome: "scheduled" });

    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      state.close?.();
      state.close = null;
      this.startForAccount(account).catch((error) => {
        logger.error("Failed to reconnect Horizon stream", {
          account,
          error: error instanceof Error ? error.message : error,
        });
        stellarStreamReconnectsTotal.inc({ account, outcome: "failed" });
        this.scheduleReconnect(account);
      });
    }, delay);
  }

  async startFallbackPolling(account: string): Promise<void> {
    const state = this.subscriptions.get(account);
    if (!state || state.fallbackPolling) {
      return;
    }

    state.fallbackPolling = true;
    stellarStreamFallbackPollingTotal.inc({ account });
    logger.warn("Stellar stream reconnect attempts exhausted; falling back to polling", {
      account,
      cursor: state.cursor,
    });

    try {
      const cursor = state.cursor && state.cursor !== "now" ? state.cursor : undefined;
      const { transactions } = await stellarService.getTransactionHistory(
        account,
        cursor,
        200,
        "asc",
      );

      for (const tx of transactions) {
        const operations = await stellarService.getTransactionOperations(tx.hash);
        for (const operation of operations) {
          if (operation.type !== "payment") continue;

          const payment: StellarPaymentRecord = {
            id: operation.id,
            type: operation.type,
            createdAt: operation.created_at ?? tx.createdAt,
            transactionHash: tx.hash,
            ledgerSequence: tx.ledger,
            from: operation.from ?? tx.sourceAccount,
            to: operation.to ?? operation.account ?? operation.destination_account ?? "",
            assetType: operation.asset_type ?? "native",
            assetCode: operation.asset_code,
            assetIssuer: operation.asset_issuer,
            amount: operation.amount ?? "0",
          };

          state.cursor = payment.id;
          await saveStellarStreamCursor(account, payment.id);
          await this.processPaymentOperation(payment, account);
        }
      }
    } catch (error) {
      logger.error("Stellar stream fallback polling failed", {
        account,
        error: error instanceof Error ? error.message : error,
      });
    } finally {
      state.fallbackPolling = false;
    }
  }

  async processPaymentOperation(
    payment: StellarPaymentRecord,
    account: string,
  ): Promise<void> {
    if (payment.type !== "payment") {
      return;
    }

    await trackAndLogQuery(
      pool as any,
      `INSERT INTO stellar_operations
         (stellar_operation_id, transaction_hash, ledger_sequence, source_account,
          destination_account, amount, asset_type, asset_code, operation_type, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (stellar_operation_id) DO NOTHING`,
      [
        payment.id,
        payment.transactionHash,
        payment.ledgerSequence ?? null,
        payment.from,
        payment.to,
        payment.amount,
        payment.assetType,
        payment.assetCode ?? null,
        payment.type,
        JSON.stringify(payment),
      ]
    );

    const { rows } = await pool.query<any>(
      `SELECT *
         FROM transactions
        WHERE status IN ('pending', 'processing')
          AND (
                stellar_tx_hash = $1
             OR (
                  COALESCE(from_address, '') = COALESCE($2, '')
              AND COALESCE(to_address, '') = COALESCE($3, '')
              AND amount::text = $4
                )
              )
        ORDER BY created_at ASC
        LIMIT 1`,
      [payment.transactionHash, payment.from, payment.to, payment.amount],
    );

    const transaction = rows[0];
    if (!transaction) {
      await this.alertOnLargeIncomingTransaction(payment, account);
      return;
    }

    const { rows: updatedRows } = await pool.query<any>(
      `UPDATE transactions
          SET status = 'confirmed',
              stellar_tx_hash = COALESCE(stellar_tx_hash, $2),
              stellar_ledger_sequence = COALESCE(stellar_ledger_sequence, $3),
              updated_at = NOW(),
              completed_at = COALESCE(completed_at, NOW())
        WHERE id = $1
        RETURNING *`,
      [transaction.id, payment.transactionHash, payment.ledgerSequence ?? null],
    );

    const updated = updatedRows[0];
    SocketService.emitToUser(updated.user_id, "payment:confirmed", {
      transactionId: updated.id,
      transactionHash: payment.transactionHash,
      ledgerSequence: payment.ledgerSequence ?? null,
      amount: payment.amount,
      asset: payment.assetCode ?? "XLM",
    });

    const receiverWallet = await WalletModel.findByStellarPublicKey(payment.to);
    if (receiverWallet && receiverWallet.user_id !== updated.user_id) {
      SocketService.emitToUser(receiverWallet.user_id, "payment:confirmed", {
        transactionId: updated.id,
        transactionHash: payment.transactionHash,
        ledgerSequence: payment.ledgerSequence ?? null,
        amount: payment.amount,
        asset: payment.assetCode ?? "XLM",
      });
    }

    await this.alertOnLargeIncomingTransaction(payment, account);
  }

  async getPlatformAccounts(): Promise<string[]> {
    const accounts = new Set<string>();
    if (process.env.PLATFORM_PUBLIC_KEY) {
      accounts.add(process.env.PLATFORM_PUBLIC_KEY);
    }

    const { rows } = await pool.query<{ stellar_public_key: string }>(
      `SELECT w.stellar_public_key
         FROM wallets w
         JOIN users u ON u.id = w.user_id
        WHERE u.role = 'admin' AND w.status = 'active'`,
    );

    for (const row of rows) {
      accounts.add(row.stellar_public_key);
    }

    return Array.from(accounts);
  }

  async alertOnLargeIncomingTransaction(
    payment: StellarPaymentRecord,
    account: string,
  ): Promise<void> {
    const amount = parseFloat(payment.amount);
    if (!Number.isFinite(amount) || amount <= LARGE_TRANSACTION_THRESHOLD_XLM) {
      return;
    }

    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE role = 'admin' AND deleted_at IS NULL`,
    );

    if (rows.length === 0) {
      return;
    }

    const emailService = new EmailService();
    await emailService.sendEmail({
      to: rows.map((row) => row.email),
      subject: "Large Stellar transaction detected",
      textContent: `A ${payment.amount} ${payment.assetCode ?? "XLM"} payment was received for monitored account ${account}.`,
      htmlContent: `<p>A <strong>${payment.amount} ${payment.assetCode ?? "XLM"}</strong> payment was received for monitored account ${account}.</p>`,
    });
  }
}

export const horizonStreamService = new HorizonStreamService();
