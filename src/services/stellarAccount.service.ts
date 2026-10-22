import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  server,
  networkPassphrase,
  getPlatformKeypair,
} from "../config/stellar";
import { env } from "../config/env";
import { WalletModel } from "../models/wallet.model";
import { EncryptionUtil } from "../utils/encryption.utils";
import { withRetry, withTimeout } from "../utils/stellar.utils";
import { logger } from "../utils/logger.utils";
import pool from "../config/database";
import { SocketService } from "./socket.service";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";

const STARTING_BALANCE = env.STELLAR_STARTING_BALANCE ?? "1.5";

/** Warn when the platform funding account drops below this (XLM). Issue #1190. */
export const STELLAR_FUNDING_LOW_BALANCE_THRESHOLD_XLM = 10;

function getLoadAccountTimeoutMs(): number {
  return Number(env.STELLAR_REQUEST_TIMEOUT_MS);
}

/**
 * Wraps server.loadAccount() with a configurable timeout so a slow or
 * unreachable Horizon node fails fast instead of hanging indefinitely.
 * Throws a typed SERVICE_UNAVAILABLE AppError when the deadline is exceeded.
 * Timeout is configurable via STELLAR_REQUEST_TIMEOUT_MS (default 10000).
 */
async function loadAccountWithTimeout(
  accountId: string,
): Promise<Awaited<ReturnType<typeof server.loadAccount>>> {
  const timeoutMs = getLoadAccountTimeoutMs();
  const timeoutError = new Error("Stellar loadAccount timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      server.loadAccount(accountId),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(timeoutError),
          timeoutMs,
        );
      }),
    ]);
  } catch (err) {
    if (err !== timeoutError) throw err;
    logger.error("Stellar loadAccount timed out", {
      accountId,
      timeoutMs,
      error: err instanceof Error ? err.message : err,
    });
    throw createError(ErrorCode.SERVICE_UNAVAILABLE, 503, {
      reason: `Stellar Horizon request timed out after ${timeoutMs}ms`,
      service: "stellar-horizon",
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export const StellarAccountService = {
  async createAndFundWallet(userId: string) {
    const platform = getPlatformKeypair();
    if (!platform) {
      logger.error("Stellar funding account not configured", {
        userId,
        service: "stellar-funding",
      });
      throw createError(ErrorCode.SERVICE_UNAVAILABLE, 503, {
        service: "stellar-funding",
        reason: "Stellar wallet funding is currently unavailable",
      });
    }

    // 🔹 Generate keypair
    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();
    const secret = keypair.secret();

    const encryptedSecret = await EncryptionUtil.encrypt(secret);

    // 🔹 Save wallet
    await WalletModel.create(userId, publicKey);

    await pool.query(
      `UPDATE wallets SET encrypted_secret_key = $1 WHERE user_id = $2`,
      [encryptedSecret, userId],
    );

    // 2. Fund account — roll back the wallet record if funding fails so we
    // never leave unfunded wallets behind.
    try {
      await this.fundAccount(userId, publicKey, platform);
    } catch (err) {
      await pool
        .query(`DELETE FROM wallets WHERE user_id = $1`, [userId])
        .catch(() => {});
      throw err;
    }

    // 🔹 Verify activation — leave the wallet as pending (not activated) if
    // verification fails so it can be retried via activateExistingWallet.
    try {
      await this.verifyActivation(userId, publicKey);
    } catch (err) {
      await pool
        .query(`UPDATE wallets SET wallet_activated = false WHERE user_id = $1`, [
          userId,
        ])
        .catch(() => {});
      throw err;
    }

    return { publicKey };
  },

  async fundAccount(
    userId: string,
    destination: string,
    configuredPlatform?: Keypair,
  ) {
    const platform = configuredPlatform ?? getPlatformKeypair();
    if (!platform) {
      logger.error("Stellar funding account not configured", {
        userId,
        service: "stellar-funding",
      });
      throw createError(ErrorCode.SERVICE_UNAVAILABLE, 503, {
        service: "stellar-funding",
        reason: "Stellar wallet funding is currently unavailable",
      });
    }

    return withRetry(async () => {
      const account = await loadAccountWithTimeout(platform.publicKey());

      const balance = account.balances.find((b) => b.asset_type === "native");

      if (
        balance &&
        parseFloat(balance.balance) < STELLAR_FUNDING_LOW_BALANCE_THRESHOLD_XLM
      ) {
        logger.warn("Funding account low balance", {
          balance: balance.balance,
          threshold: STELLAR_FUNDING_LOW_BALANCE_THRESHOLD_XLM,
          service: "stellar-funding",
        });

        // optional: emit admin event
        SocketService.emitToUser("admin", "funding:low-balance", {
          balance: balance.balance,
        });
      }

      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(
          Operation.createAccount({
            destination,
            startingBalance: STARTING_BALANCE,
          }),
        )
        .setTimeout(30)
        .build();

      tx.sign(platform);

      const result = await withTimeout(
        server.submitTransaction(tx),
        Number(env.STELLAR_API_TIMEOUT_MS),
      );

      await pool.query(
        `INSERT INTO transactions (
    user_id,
    type,
    status,
    amount,
    currency,
    stellar_tx_hash,
    stellar_ledger_sequence,
    to_address,
    description
  ) VALUES ($1, 'deposit', 'completed', $2, 'XLM', $3, $4, $5, $6)`,
        [
          userId,
          STARTING_BALANCE,
          result.hash,
          result.ledger,
          destination,
          "Wallet activation funding",
        ],
      );

      logger.info("Account funded", {
        destination,
        txHash: result.hash,
        ledger: result.ledger,
      });

      return result;
    }, "fundAccount");
  },

  async verifyActivation(userId: string, publicKey: string) {
    await withRetry(async () => {
      const account = await loadAccountWithTimeout(publicKey);

      if (!account) throw new Error("Account not found");

      await pool.query(
        `UPDATE wallets SET wallet_activated = true WHERE user_id = $1`,
        [userId],
      );

      // 🔹 Emit event
      SocketService.emitToUser(userId, "wallet:activated", {
        publicKey,
      });

      logger.info("Wallet activated", { userId, publicKey });

      return true;
    }, "verifyActivation");
  },

  async activateExistingWallet(userId: string) {
    const wallet = await WalletModel.findByUserId(userId);
    if (!wallet) throw new Error("Wallet not found");

    if (wallet.wallet_activated) {
      return { activated: true, message: "Already activated" };
    }

    await this.fundAccount(userId, wallet.stellar_public_key);
    await this.verifyActivation(userId, wallet.stellar_public_key);

    return { activated: true };
  },
};
