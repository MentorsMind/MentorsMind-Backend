import { logger } from './logger.utils';
import type { StellarBalance, StellarAccountInfo } from '../types/stellar.types';
import type { Horizon } from '@stellar/stellar-sdk';
import { ErrorCode } from '../errors/error-codes';
import type { AppError } from '../middleware/errorHandler';

class StellarApiTimeoutError extends Error implements AppError {
  code = ErrorCode.SERVICE_UNAVAILABLE;
  statusCode = 503;
  isOperational = true;

  constructor() {
    super('Stellar Horizon API request timed out');
    this.name = 'StellarApiTimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new StellarApiTimeoutError()), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

/**
 * Parse a Horizon AccountResponse into our domain type.
 */
export function parseAccountInfo(
  account: Horizon.ServerApi.AccountRecord,
): StellarAccountInfo {
  return {
    id: account.id,
    sequence: account.sequence,
    subentryCount: account.subentry_count,
    lastModifiedLedger: account.last_modified_ledger,
    balances: account.balances.map(parseBalance),
  };
}

function parseBalance(b: Horizon.HorizonApi.BalanceLine): StellarBalance {
  const base: StellarBalance = {
    assetType: b.asset_type,
    balance: b.balance,
  };
  if ('asset_code' in b) base.assetCode = b.asset_code;
  if ('asset_issuer' in b) base.assetIssuer = b.asset_issuer;
  if ('liquidity_pool_id' in b) base.liquidityPoolId = b.liquidity_pool_id;
  if ('limit' in b) base.limit = b.limit;
  return base;
}

/**
 * Retry an async function up to `maxRetries` times on failure.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
  delayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof StellarApiTimeoutError) throw err;
      lastError = err;
      logger.warn(`${label} attempt ${attempt}/${maxRetries} failed`, {
        error: err instanceof Error ? err.message : err,
      });
      if (attempt < maxRetries) {
        await sleep(delayMs * attempt);
      }
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Simple in-memory TTL cache.
 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }
}
