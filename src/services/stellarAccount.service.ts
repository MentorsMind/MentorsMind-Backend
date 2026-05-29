import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  server,
  networkPassphrase,
  getPlatformKeypair,
} from "../config/stellar";
import { WalletModel } from "../models/wallet.model";
import { EncryptionUtil } from "../utils/encryption.utils";
import { withRetry } from "../utils/stellar.utils";
import { logger } from "../utils/logger.utils";
import pool from "../config/database";
import { SocketService } from "./socket.service";

const STARTING_BALANCE = "1.5";

export const StellarAccountService = {
  async createAndFundWallet(userId: string) {
    // 🔹 Generate keypair
    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();
    const secret = keypair.secret();

    const encryptedSecret = EncryptionUtil.encrypt(secret);

    // 🔹 Save wallet
    await WalletModel.create(userId, publicKey);

    await pool.query(
      `UPDATE wallets SET encrypted_secret_key = $1 WHERE user_id = $2`,
      [encryptedSecret, userId],
    );

    // 🔹 Fund account
    await this.fundAccount(publicKey);

    // 🔹 Verify activation
    await this.verifyActivation(userId, publicKey);

    return { publicKey };
  },

  async fundAccount(destination: string) {
    const platform = getPlatformKeypair();
    if (!platform) throw new Error("Funding account not configured");

    return withRetry(async () => {
      const account = await server.loadAccount(platform.publicKey());

      const balance = account.balances.find((b) => b.asset_type === "native");

      if (balance && parseFloat(balance.balance) < 100) {
        logger.warn("⚠️ Funding account low balance", {
          balance: balance.balance,
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

      const result = await server.submitTransaction(tx);

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
      const account = await server.loadAccount(publicKey);

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

    await this.fundAccount(wallet.stellar_public_key);
    await this.verifyActivation(userId, wallet.stellar_public_key);

    return { activated: true };
  },
};
