/**
 * OracleService
 *
 * Responsibilities:
 *  - Query the deployed Soroban oracle contract for XLM/USD (and other) prices
 *  - Cache prices in Redis with a 60 s TTL (matches the oracle's STALE_SECS window)
 *  - Expose staleness so callers can apply a circuit-breaker fallback (e.g. SDEX)
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

const cacheKey = (asset: string) => `mm:oracle:price:${asset}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OraclePrice {
  asset: string;
  price: string; // decimal string, e.g. "0.1234567"
  twap: string; // decimal string
  isStale: boolean;
  updatedAt: string; // ISO timestamp
}

interface OracleContractClient {
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

  /**
   * Return the current price for an asset, using a 60 s Redis cache.
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

    const price = await this.fetchPriceFromContract(asset);
    await CacheService.set(key, price, ORACLE_PRICE_TTL_SECONDS);
    return price;
  }

  /**
   * Bypass cache and query the oracle contract directly.
   */
  async fetchPriceFromContract(asset: string): Promise<OraclePrice> {
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
  }

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
};
