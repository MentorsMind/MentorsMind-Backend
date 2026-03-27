// @ts-nocheck
import { Horizon, TransactionBuilder, StrKey, Operation, Asset } from '@stellar/stellar-sdk';
import { server, backupServer, networkPassphrase } from '../config/stellar';
import { CacheService } from './cache.service';
import { CacheKeys, CacheTTL } from '../utils/cache-key.utils';
import { logger } from '../utils/logger.utils';
import { parseAccountInfo, withRetry, TtlCache } from '../utils/stellar.utils';
import type {
  StellarAccountInfo,
  StellarTransactionResult,
  StellarPaymentRecord,
  PaymentHandler,
  HorizonPaymentRecord,
  StellarTransactionRecord,
  StellarOperationRecord,
} from '../types/stellar.types';

const ACCOUNT_CACHE_TTL_MS = 5_000;
const MAX_RETRIES = 3;

/**
 * StellarService — wraps @stellar/stellar-sdk for all server-side blockchain ops.
 *
 * **Features:**
 * - Auto testnet/mainnet switching via `STELLAR_NETWORK` env var
 * - Primary → backup Horizon server failover
 * - Up to 3 retries with exponential back-off on network timeout
 * - 5-second TTL in-memory cache on account lookups
 * - All Horizon API calls logged with latency
 *
 * **API:**
 * - `getAccount(publicKey)` — Fetch account info & balances (cached 5s)
 * - `submitTransaction(xdr)` — Submit a signed transaction envelope
 * - `streamPayments(publicKey, handler, cursor?)` — Stream incoming payments (returns close fn)
 */
class StellarService {
  private accountCache = new TtlCache<StellarAccountInfo>(ACCOUNT_CACHE_TTL_MS);

  /**
   * Fetch account info and balances from the Stellar network.
   * Results are cached for 5 seconds to reduce Horizon calls.
   * @param publicKey - Stellar public key (G...)
   * @returns Account info with balances
   * @throws On network failure after retries + failover exhausted
   */
  async getAccount(publicKey: string): Promise<StellarAccountInfo> {
    const cached = this.accountCache.get(publicKey);
    if (cached) {
      logger.debug('stellar.getAccount cache hit', { publicKey });
      return cached;
    }

    const info = await this.callWithFailover(
      'getAccount',
      (srv) => srv.accounts().accountId(publicKey).call(),
    ).then(parseAccountInfo);

    this.accountCache.set(publicKey, info);
    return info;
  }

  /**
   * Submit a signed transaction envelope (XDR) to the Stellar network.
   * @param txEnvelopeXdr - Base64-encoded transaction envelope XDR
   * @returns Transaction result with hash, ledger, and result XDR
   * @throws On invalid XDR, network failure, or transaction rejection
   */
  async submitTransaction(txEnvelopeXdr: string): Promise<StellarTransactionResult> {
    const tx = TransactionBuilder.fromXDR(txEnvelopeXdr, networkPassphrase);

    const result = await this.callWithFailover(
      'submitTransaction',
      (srv) => srv.submitTransaction(tx),
    );

    return {
      hash: result.hash,
      ledger: result.ledger,
      successful: result.successful,
      resultXdr: result.result_xdr,
      envelopeXdr: result.envelope_xdr,
    };
  }

  /**
   * Stream incoming payment operations for an account.
   * @param publicKey - Account to watch for payments
   * @param onPayment - Callback invoked for each incoming payment
   * @param cursor - Horizon cursor; defaults to 'now' (only future payments)
   * @returns A close function to stop the stream
   */
  streamPayments(
    publicKey: string,
    onPayment: PaymentHandler,
    cursor: string = 'now',
  ): () => void {
    logger.info('stellar.streamPayments started', { publicKey, cursor });

    const close = server
      .payments()
      .forAccount(publicKey)
      .cursor(cursor)
      .stream({
        onmessage: (record: HorizonPaymentRecord) => {
          if (record.type !== 'payment') return;
          const payment: StellarPaymentRecord = {
            id: record.id,
            type: record.type,
            createdAt: record.created_at,
            transactionHash: record.transaction_hash,
            from: record.from,
            to: record.to,
            assetType: record.asset_type,
            assetCode: (record as any).asset_code,
            assetIssuer: (record as any).asset_issuer,
            amount: record.amount,
          };
          onPayment(payment);
        },
        onerror: (error: unknown) => {
          logger.error('stellar.streamPayments error', {
            publicKey,
            error: error instanceof Error ? error.message : error,
          });
        },
      } as any);

    return typeof close === 'function' ? close : () => {};
  }

  // ---------------------------------------------------------------------------
  // Wallet-specific methods
  // ---------------------------------------------------------------------------

  /**
   * Get transaction history for an account with cursor-based pagination.
   * @param publicKey - Stellar public key (G...)
   * @param cursor - Horizon cursor for pagination (optional)
   * @param limit - Number of transactions to fetch (1-200, default 10)
   * @param order - Sort order ('asc' or 'desc', default 'desc')
   * @returns Transaction history with pagination info
   * @throws On network failure or invalid parameters
   */
  async getTransactionHistory(
    publicKey: string,
    cursor?: string,
    limit: number = 10,
    order: 'asc' | 'desc' = 'desc',
  ): Promise<{
    transactions: StellarTransactionRecord[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    const clampedLimit = Math.min(Math.max(limit, 1), 200);
    
    const result = await this.callWithFailover(
      'getTransactionHistory',
      (srv) => {
        let query = srv.transactions().forAccount(publicKey).limit(clampedLimit).order(order);
        if (cursor) {
          query = query.cursor(cursor);
        }
        return query.call();
      },
    );

    const transactions: StellarTransactionRecord[] = result.records.map((tx: any) => ({
      id: tx.id,
      hash: tx.hash,
      ledger: tx.ledger,
      createdAt: tx.created_at,
      sourceAccount: tx.source_account,
      operationCount: tx.operation_count,
      successful: tx.successful,
      memo: tx.memo,
      memoType: tx.memo_type,
    }));

    return {
      transactions,
      hasMore: result.records.length === clampedLimit,
      nextCursor: result.records.length > 0 ? result.records[result.records.length - 1].paging_token : undefined,
    };
  }

  /**
   * Validate a Stellar public key format and checksum.
   * @param publicKey - Stellar public key to validate
   * @returns True if valid, false otherwise
   */
  validatePublicKey(publicKey: string): boolean {
    try {
      return StrKey.isValidEd25519PublicKey(publicKey);
    } catch {
      return false;
    }
  }

  /**
   * Get specific asset balance for an account.
   * Uses distributed cache (Redis) to cache balances for 30 seconds to reduce Horizon API calls.
   * @param publicKey - Stellar public key (G...)
   * @param assetCode - Asset code (e.g., 'USD', 'BTC')
   * @param assetIssuer - Asset issuer public key (optional for native XLM)
   * @returns Asset balance or null if not found
   * @throws On network failure
   */
  async getAssetBalance(
    publicKey: string,
    assetCode: string = 'XLM',
    assetIssuer?: string,
  ): Promise<StellarBalance | null> {
    // Create cache key for this specific asset balance
    const cacheKey = CacheKeys.stellarAssetBalance(publicKey, assetCode, assetIssuer);

    // Try to get from cache first
    const cached = await CacheService.get<StellarBalance | null>(cacheKey);
    if (cached !== null) {
      logger.debug('stellar.getAssetBalance cache hit', { publicKey, assetCode, assetIssuer });
      return cached;
    }

    // Not in cache, fetch from Stellar network
    const accountInfo = await this.getAccount(publicKey);
    
    const balance = accountInfo.balances.find(b => {
      if (assetCode === 'XLM' || assetCode === 'native') {
        return b.assetType === 'native';
      }
      return b.assetCode === assetCode && 
             (!assetIssuer || b.assetIssuer === assetIssuer);
    }) || null;

    // Cache the result (even null) for 30 seconds to reduce API load
    await CacheService.set(cacheKey, balance, CacheTTL.veryShort);

    return balance;
  }

  /**
   * Create a trustline operation for a custom asset.
   * Note: This creates the operation but does not submit it.
   * @param assetCode - Asset code (e.g., 'USD', 'BTC')
   * @param assetIssuer - Asset issuer public key
   * @param limit - Trust limit (optional, defaults to maximum)
   * @returns Trustline operation
   * @throws On invalid parameters
   */
  createTrustlineOperation(
    assetCode: string,
    assetIssuer: string,
    limit?: string,
  ): Operation.ChangeTrust {
    if (!this.validatePublicKey(assetIssuer)) {
      throw new Error('Invalid asset issuer public key');
    }

    if (assetCode === 'XLM' || assetCode === 'native') {
      throw new Error('Cannot create trustline for native XLM');
    }

    const asset = new Asset(assetCode, assetIssuer);
    
    return Operation.changeTrust({
      asset,
      limit: limit || undefined, // undefined means maximum limit
    });
  }

  /**
   * Check if an account exists on the Stellar network.
   * @param publicKey - Stellar public key to check
   * @returns True if account exists, false otherwise
   */
  async accountExists(publicKey: string): Promise<boolean> {
    try {
      await this.getAccount(publicKey);
      return true;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return false;
      }
      throw error; // Re-throw other errors
    }
  }

  /**
   * Get operations for an account with filtering and pagination.
   * @param publicKey - Stellar public key (G...)
   * @param cursor - Horizon cursor for pagination (optional)
   * @param limit - Number of operations to fetch (1-200, default 10)
   * @param order - Sort order ('asc' or 'desc', default 'desc')
   * @param operationType - Filter by operation type (optional)
   * @returns Operations with pagination info
   * @throws On network failure
   */
  async getOperations(
    publicKey: string,
    cursor?: string,
    limit: number = 10,
    order: 'asc' | 'desc' = 'desc',
    operationType?: string,
  ): Promise<{
    operations: StellarOperationRecord[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    const clampedLimit = Math.min(Math.max(limit, 1), 200);
    
    const result = await this.callWithFailover(
      'getOperations',
      (srv) => {
        let query = srv.operations().forAccount(publicKey).limit(clampedLimit).order(order);
        if (cursor) {
          query = query.cursor(cursor);
        }
        return query.call();
      },
    );

    let operations: StellarOperationRecord[] = result.records.map((op: any) => ({
      id: op.id,
      type: op.type,
      createdAt: op.created_at,
      transactionHash: op.transaction_hash,
      sourceAccount: op.source_account,
      ...op, // Include all operation-specific fields
    }));

    // Filter by operation type if specified
    if (operationType) {
      operations = operations.filter(op => op.type === operationType);
    }

    return {
      operations,
      hasMore: result.records.length === clampedLimit,
      nextCursor: result.records.length > 0 ? result.records[result.records.length - 1].paging_token : undefined,
    };
  }

  /**
   * Get payment operations for an account (filtered operations).
   * @param publicKey - Stellar public key (G...)
   * @param cursor - Horizon cursor for pagination (optional)
   * @param limit - Number of payments to fetch (1-200, default 10)
   * @param order - Sort order ('asc' or 'desc', default 'desc')
   * @returns Payment operations with pagination info
   * @throws On network failure
   */
  async getPaymentOperations(
    publicKey: string,
    cursor?: string,
    limit: number = 10,
    order: 'asc' | 'desc' = 'desc',
  ): Promise<{
    payments: StellarPaymentRecord[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    const result = await this.callWithFailover(
      'getPaymentOperations',
      (srv) => {
        let query = srv.payments().forAccount(publicKey).limit(limit).order(order);
        if (cursor) {
          query = query.cursor(cursor);
        }
        return query.call();
      },
    );

    const payments: StellarPaymentRecord[] = result.records
      .filter((record: any) => record.type === 'payment')
      .map((record: any) => ({
        id: record.id,
        type: record.type,
        createdAt: record.created_at,
        transactionHash: record.transaction_hash,
        from: record.from,
        to: record.to,
        assetType: record.asset_type,
        assetCode: record.asset_code,
        assetIssuer: record.asset_issuer,
        amount: record.amount,
      }));

    return {
      payments,
      hasMore: result.records.length === limit,
      nextCursor: result.records.length > 0 ? result.records[result.records.length - 1].paging_token : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: call with retry + failover + logging
  // ---------------------------------------------------------------------------

  private async callWithFailover<T>(
    label: string,
    fn: (srv: Horizon.Server) => Promise<T>,
  ): Promise<T> {
    const start = Date.now();

    try {
      const result = await withRetry(() => fn(server), `${label}[primary]`, MAX_RETRIES);
      this.logLatency(label, 'primary', start);
      return result;
    } catch (primaryErr) {
      logger.warn(`${label} primary failed, trying backup`, {
        error: primaryErr instanceof Error ? primaryErr.message : primaryErr,
      });
    }

    try {
      const result = await withRetry(() => fn(backupServer), `${label}[backup]`, MAX_RETRIES);
      this.logLatency(label, 'backup', start);
      return result;
    } catch (backupErr) {
      logger.error(`${label} all servers failed`, {
        error: backupErr instanceof Error ? backupErr.message : backupErr,
      });
      throw backupErr;
    }
  }

  private logLatency(label: string, server: string, start: number): void {
    logger.info(`stellar.${label}`, { server, latencyMs: Date.now() - start });
  }
}

export const stellarService = new StellarService();
