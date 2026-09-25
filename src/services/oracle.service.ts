/**
 * OracleService
 *
 * Responsibilities:
 *  - Query the deployed Soroban oracle contract for XLM/USD (and other) prices
 *  - Cache prices in Redis with a 60 s TTL (matches the oracle's STALE_SECS window)
 *  - Catch contract panics (stale prices, insufficient feeders, TWAP circuit-breaker)
 *    and map them to a typed OracleUnavailableError
 *  - Fall back to a last-known-good (LKG) price cache (max 10-minute staleness)
 *  - Expose a degradedMode flag for GET /health/ready
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { CacheService } from './cache.service';
import { logger } from '../utils/logger.utils';
import { createError } from '../middleware/errorHandler';
import { ErrorCode } from '../errors/error-codes';
import { logWarning } from '../utils/error.utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ORACLE_PRICE_TTL_SECONDS = 60; // matches oracle contract STALE_SECS window
const PRICE_SCALE = 10_000_000; // 7 decimals, matches Stellar stroop convention
const MONITORED_ASSETS = ['XLM'];
const STALENESS_CHECK_INTERVAL_MS = 60_000; // matches ORACLE_PRICE_TTL_SECONDS

/** Maximum age (ms) for the last-known-good fallback price before it is also rejected. */
export const LKG_MAX_STALENESS_MS = 10 * 60 * 1_000; // 10 minutes

const cacheKey = (asset: string) => `mm:oracle:price:${asset}`;
/** Separate Redis key-space for last-known-good prices so they survive normal TTL expiry. */
const lkgCacheKey = (asset: string) => `mm:oracle:lkg:${asset}`;

// ---------------------------------------------------------------------------
// Contract-error patterns emitted by the Soroban oracle contract
// (matches panic strings in contracts/oracle/src/lib.rs)
// ---------------------------------------------------------------------------

/** Substrings present in contract panic messages that indicate a circuit-breaker condition. */
const CONTRACT_ERROR_PATTERNS = [
  'not enough feeders',
  'no prices',
  'no TWAP available',
  'price deviation exceeds circuit breaker threshold',
  'stale',
  'unauthorized feeder',
] as const;

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown when the oracle contract panics due to:
 *  - Fewer than MIN_FEEDERS registered feeders ("not enough feeders")
 *  - No price data submitted ("no prices")
 *  - Price deviation beyond the 50 % TWAP circuit-breaker threshold
 *  - Stale prices detected by the contract's STALE_SECS check
 *
 * Callers should catch this and fall back to SDEX or cached data.
 */
export class OracleUnavailableError extends Error {
  public readonly code = ErrorCode.ORACLE_UNAVAILABLE;
  public readonly statusCode = 503;
  public readonly isOperational = true;
  /** The raw contract error message for diagnostics. */
  public readonly contractError: string;
  /** Whether a last-known-good fallback was used. */
  public readonly usedFallback: boolean;

  constructor(contractError: string, usedFallback = false) {
    super(
      `Oracle contract unavailable${usedFallback ? ' (using last-known-good cache)' : ''}: ${contractError}`,
    );
    this.name = 'OracleUnavailableError';
    this.contractError = contractError;
    this.usedFallback = usedFallback;
    Object.setPrototypeOf(this, OracleUnavailableError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the error message matches one of the known contract panic
 * patterns that indicate the oracle circuit-breaker has triggered.
 */
export function isContractError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return CONTRACT_ERROR_PATTERNS.some((pattern) => msg.includes(pattern.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OraclePrice {
  asset: string;
  price: string; // decimal string, e.g. "0.1234567"
  twap: string; // decimal string
  isStale: boolean;
  updatedAt: string; // ISO timestamp
  /** Set to true when the price comes from the LKG cache, not a fresh contract call. */
  fromFallback?: boolean;
}

/** Stamped alongside an LKG entry so we can enforce maximum staleness. */
interface LkgEntry {
  price: OraclePrice;
  cachedAt: number; // Date.now() ms
}

export interface OracleContractClient {
  getPrice(asset: string): Promise<{ price: bigint; updatedAt: number }>;
  getTwap(asset: string): Promise<bigint>;
  isPriceStale(asset: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Soroban RPC client
// ---------------------------------------------------------------------------

class StellarOracleClient implements OracleContractClient {
  private readonly rpcServer: any;
  private readonly networkPassphrase: string;

  constructor() {
    const sdkAny = StellarSdk as any;
    const serverUrl =
      process.env.SOROBAN_RPC_URL ||
      process.env.STELLAR_RPC_URL ||
      process.env.STELLAR_HORIZON_URL ||
      'https://soroban-testnet.stellar.org';

    const RpcServerCtor = sdkAny.SorobanRpc?.Server || sdkAny.rpc?.Server;
    this.rpcServer = RpcServerCtor ? new RpcServerCtor(serverUrl) : null;

    this.networkPassphrase =
      process.env.STELLAR_NETWORK === 'mainnet'
        ? sdkAny.Networks.PUBLIC
        : sdkAny.Networks.TESTNET;
  }

  async getPrice(asset: string): Promise<{ price: bigint; updatedAt: number }> {
    const result = await this.simulateReadCall('get_price', [asset]);
    const [price, updatedAt] = result as [bigint, bigint];
    return { price: BigInt(price), updatedAt: Number(updatedAt) };
  }

  async getTwap(asset: string): Promise<bigint> {
    const result = await this.simulateReadCall('get_twap', [asset]);
    return BigInt(result as bigint);
  }

  async isPriceStale(asset: string): Promise<boolean> {
    const result = await this.simulateReadCall('is_price_stale', [asset]);
    return Boolean(result);
  }

  private async simulateReadCall(method: string, args: unknown[]): Promise<unknown> {
    const sdkAny = StellarSdk as any;

    if (!this.rpcServer) {
      throw new Error('Soroban RPC client is not available in @stellar/stellar-sdk');
    }

    const contractAddress =
      process.env.SOROBAN_ORACLE_CONTRACT_ADDRESS ||
      (() => {
        throw new Error('SOROBAN_ORACLE_CONTRACT_ADDRESS is required');
      })();

    // A throwaway source account is sufficient for a read-only simulation call.
    const sourcePublicKey =
      process.env.PLATFORM_PUBLIC_KEY ||
      StellarSdk.Keypair.random().publicKey();

    const account = await this.rpcServer.getAccount(sourcePublicKey);
    const contract = new sdkAny.Contract(contractAddress);
    const scArgs = args.map((arg) => sdkAny.nativeToScVal(arg, { type: 'symbol' }));

    const tx = new sdkAny.TransactionBuilder(account, {
      fee: String(sdkAny.BASE_FEE || '100'),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...scArgs))
      .setTimeout(30)
      .build();

    const simulation = await this.rpcServer.simulateTransaction(tx);

    if (simulation?.error) {
      throw new Error(String(simulation.error));
    }

    const SorobanRpc = sdkAny.SorobanRpc || sdkAny.rpc;
    const returnValue = simulation?.result?.retval;

    if (returnValue && sdkAny.scValToNative) {
      return sdkAny.scValToNative(returnValue);
    }

    if (SorobanRpc?.scValToNative && returnValue) {
      return SorobanRpc.scValToNative(returnValue);
    }

    throw new Error(`Unable to decode Soroban simulation result for ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function scaledToDecimalString(value: bigint): string {
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = abs / BigInt(PRICE_SCALE);
  const frac = (abs % BigInt(PRICE_SCALE)).toString().padStart(7, '0');
  const sign = negative ? '-' : '';
  return `${sign}${whole.toString()}.${frac}`;
}

class OracleServiceImpl {
  private stalenessTimer: NodeJS.Timeout | null = null;
  private lastAlertedStale = new Set<string>();

  /**
   * True when the oracle is operating in degraded mode (last fresh fetch failed
   * and the service is serving last-known-good prices). Exposed for /health/ready.
   */
  public degradedMode = false;
  /** Reason string surfaced in the health check. Empty when not degraded. */
  public degradedReason = '';

  constructor(private client: OracleContractClient) {}

  setClient(client: OracleContractClient): void {
    this.client = client;
  }

  isConfigured(): boolean {
    return Boolean(this.getContractAddress());
  }

  getContractAddress(): string | undefined {
    return process.env.SOROBAN_ORACLE_CONTRACT_ADDRESS || undefined;
  }

  requireContractAddress(): string {
    const address = this.getContractAddress();
    if (!address) {
      throw new Error('SOROBAN_ORACLE_CONTRACT_ADDRESS is required');
    }
    return address;
  }

  // ---------------------------------------------------------------------------
  // Last-known-good cache helpers
  // ---------------------------------------------------------------------------

  private async setLkg(asset: string, price: OraclePrice): Promise<void> {
    const entry: LkgEntry = { price, cachedAt: Date.now() };
    // Store for 1 hour — we enforce our own staleness check on read.
    await CacheService.set(lkgCacheKey(asset), entry, 3600);
  }

  private async getLkg(asset: string): Promise<OraclePrice | null> {
    const entry = await CacheService.get<LkgEntry>(lkgCacheKey(asset));
    if (!entry) return null;

    const ageMs = Date.now() - entry.cachedAt;
    if (ageMs > LKG_MAX_STALENESS_MS) {
      logger.warn('Oracle LKG cache exceeded maximum staleness — discarding', {
        asset,
        ageMs,
        maxMs: LKG_MAX_STALENESS_MS,
      });
      return null;
    }

    return { ...entry.price, fromFallback: true };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Return the current price for an asset, using a 60 s Redis cache.
   *
   * On contract failure (stale prices / insufficient feeders / circuit-breaker):
   *  1. Attempts to serve the last-known-good price if it is ≤ 10 minutes old.
   *  2. Throws OracleUnavailableError when no valid fallback exists.
   *
   * `isStale` reflects the oracle contract's own circuit-breaker check
   * (last update older than its STALE_SECS window), not just cache age.
   */
  async getPrice(asset: string): Promise<OraclePrice> {
    if (!this.isConfigured()) {
      throw createError(ErrorCode.ORACLE_NOT_CONFIGURED, 503);
    }

    const key = cacheKey(asset);
    const cached = await CacheService.get<OraclePrice>(key);
    if (cached) return cached;

    try {
      const price = await this.fetchPriceFromContract(asset);
      await CacheService.set(key, price, ORACLE_PRICE_TTL_SECONDS);
      // Persist as last-known-good on every successful fetch.
      await this.setLkg(asset, price);
      this.setDegradedMode(false);
      return price;
    } catch (err) {
      const contractErrMsg = err instanceof Error ? err.message : String(err);

      if (isContractError(err) || err instanceof OracleUnavailableError) {
        logger.warn('Oracle contract error — attempting last-known-good fallback', {
          asset,
          error: contractErrMsg,
        });

        this.setDegradedMode(true, contractErrMsg);

        const lkg = await this.getLkg(asset);
        if (lkg) {
          logger.info('Serving oracle price from last-known-good cache', { asset });
          return lkg;
        }

        // No valid fallback — propagate a typed error.
        throw new OracleUnavailableError(contractErrMsg, false);
      }

      // Non-contract errors (network, RPC timeouts) are re-thrown as-is.
      throw err;
    }
  }

  /**
   * Bypass cache and query the oracle contract directly.
   * Throws OracleUnavailableError when the contract panics.
   */
  async fetchPriceFromContract(asset: string): Promise<OraclePrice> {
    try {
      const [{ price, updatedAt }, twap, isStale] = await Promise.all([
        this.client.getPrice(asset),
        this.client.getTwap(asset).catch(() => null),
        this.client.isPriceStale(asset),
      ]);

      return {
        asset,
        price: scaledToDecimalString(price),
        twap: twap !== null ? scaledToDecimalString(twap) : scaledToDecimalString(price),
        isStale,
        updatedAt: new Date(updatedAt * 1000).toISOString(),
      };
    } catch (err) {
      if (isContractError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new OracleUnavailableError(msg);
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Degraded-mode state management
  // ---------------------------------------------------------------------------

  private setDegradedMode(degraded: boolean, reason = ''): void {
    if (degraded && !this.degradedMode) {
      logger.error('OracleService entering degraded mode', { reason });
      logWarning('Oracle entering degraded mode', { reason });
    } else if (!degraded && this.degradedMode) {
      logger.info('OracleService recovered from degraded mode');
    }
    this.degradedMode = degraded;
    this.degradedReason = degraded ? reason : '';
  }

  // ---------------------------------------------------------------------------
  // Background staleness monitoring
  // ---------------------------------------------------------------------------

  /**
   * Start a background interval that polls the oracle for staleness and
   * raises a monitoring alert (log + Sentry breadcrumb/warning) the first
   * time an asset transitions into a stale state. Call once at startup.
   */
  startStalenessMonitoring(): void {
    if (!this.isConfigured() || this.stalenessTimer) return;

    const check = async () => {
      for (const asset of MONITORED_ASSETS) {
        try {
          const price = await this.getPrice(asset);
          if (price.isStale) {
            if (!this.lastAlertedStale.has(asset)) {
              this.lastAlertedStale.add(asset);
              logger.error('Oracle price reported stale', { asset, updatedAt: price.updatedAt });
              logWarning(`Oracle price stale for ${asset}`, {
                asset,
                updatedAt: price.updatedAt,
              });
            }
          } else {
            this.lastAlertedStale.delete(asset);
          }
        } catch (error) {
          logger.warn('Oracle staleness check failed', {
            asset,
            error: error instanceof Error ? error.message : error,
          });
        }
      }
    };

    check();
    this.stalenessTimer = setInterval(check, STALENESS_CHECK_INTERVAL_MS);
    logger.info('OracleService: staleness monitoring started', {
      intervalMs: STALENESS_CHECK_INTERVAL_MS,
      assets: MONITORED_ASSETS,
    });
  }

  stopStalenessMonitoring(): void {
    if (this.stalenessTimer) {
      clearInterval(this.stalenessTimer);
      this.stalenessTimer = null;
    }
  }
}

const oracleService = new OracleServiceImpl(new StellarOracleClient());

export const OracleService = {
  setClient: (client: OracleContractClient) => oracleService.setClient(client),
  isConfigured: () => oracleService.isConfigured(),
  getContractAddress: () => oracleService.getContractAddress(),
  requireContractAddress: () => oracleService.requireContractAddress(),
  getPrice: (asset: string) => oracleService.getPrice(asset),
  fetchPriceFromContract: (asset: string) => oracleService.fetchPriceFromContract(asset),
  startStalenessMonitoring: () => oracleService.startStalenessMonitoring(),
  stopStalenessMonitoring: () => oracleService.stopStalenessMonitoring(),
  /** Current degraded-mode state — consumed by HealthService. */
  get isDegraded() { return oracleService.degradedMode; },
  get degradedReason() { return oracleService.degradedReason; },
};
