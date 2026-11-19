import * as StellarSdk from '@stellar/stellar-sdk';
import { CacheService } from './cache.service';
import { WalletModel } from '../models/wallet.model';
import { logger } from '../utils/logger.utils';
import pool from '../config/database'; // If needed to list mentors

export interface StakeInfoResponse {
  mentor: string;
  amount: string; // Formatting to full XLM or keeping as stroops string
  lockPeriodDays: number;
  stakedAt: number;
  unlockAt: number;
  accruedYield: string;
  apy: number;
  isUnlocked: boolean;
}

export interface SorobanContractInvocation {
  contractAddress: string;
  method: string;
  args: unknown[];
}

export interface SorobanInvocationResult {
  txHash: string | null;
  result: unknown;
}

export interface SorobanStakingClient {
  simulate(params: SorobanContractInvocation): Promise<any>;
}

class StellarSorobanStakingClient implements SorobanStakingClient {
  private readonly rpcServer: any;
  private readonly networkPassphrase: string;

  constructor() {
    const sdkAny = StellarSdk as any;
    const serverUrl =
      process.env.SOROBAN_RPC_URL ||
      process.env.STELLAR_RPC_URL ||
      'https://soroban-testnet.stellar.org';

    const RpcServerCtor = sdkAny.SorobanRpc?.Server || sdkAny.rpc?.Server;
    this.rpcServer = RpcServerCtor ? new RpcServerCtor(serverUrl) : null;

    this.networkPassphrase =
      process.env.STELLAR_NETWORK === 'mainnet'
        ? sdkAny.Networks.PUBLIC
        : sdkAny.Networks.TESTNET;
  }

  async simulate(params: SorobanContractInvocation): Promise<any> {
    const sdkAny = StellarSdk as any;

    if (!this.rpcServer) {
      throw new Error('Soroban RPC client is not available in @stellar/stellar-sdk');
    }

    const sourcePublicKey =
      process.env.PLATFORM_PUBLIC_KEY ||
      StellarSdk.Keypair.random().publicKey();

    const account = await this.rpcServer.getAccount(sourcePublicKey);
    const contract = new sdkAny.Contract(params.contractAddress);
    
    // address arguments are passed as native strings and nativeToScVal converts them
    const args = params.args.map((arg) => {
      if (typeof arg === 'string' && arg.startsWith('G')) {
        return sdkAny.nativeToScVal(arg, { type: 'address' });
      }
      return sdkAny.nativeToScVal(arg);
    });

    const tx = new sdkAny.TransactionBuilder(account, {
      fee: String(sdkAny.BASE_FEE || '100'),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(params.method, ...args))
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
    return null;
  }
}

class StakingServiceImpl {
  private client: SorobanStakingClient;
  private readonly APY: number;

  constructor(client: SorobanStakingClient) {
    this.client = client;
    this.APY = process.env.STAKING_APY ? parseFloat(process.env.STAKING_APY) : 0.10;
  }

  isConfigured(): boolean {
    return Boolean(this.getContractAddress());
  }

  getContractAddress(): string | undefined {
    return process.env.SOROBAN_STAKING_CONTRACT_ADDRESS || undefined;
  }

  requireContractAddress(): string {
    const address = this.getContractAddress();
    if (!address) {
      throw new Error('SOROBAN_STAKING_CONTRACT_ADDRESS is required');
    }
    return address;
  }

  private getCacheKey(mentorAddress: string): string {
    return `mm:staking:position:${mentorAddress}`;
  }

  async getStake(mentorAddress: string): Promise<StakeInfoResponse | null> {
    if (!this.isConfigured()) {
      throw new Error('Staking contract not configured');
    }

    const cacheKey = this.getCacheKey(mentorAddress);
    const cached = await CacheService.get<StakeInfoResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const contractAddress = this.requireContractAddress();
      const result = await this.client.simulate({
        contractAddress,
        method: 'get_stake',
        args: [mentorAddress],
      });

      if (!result) {
        return null; // Not found or error
      }

      const parsed = this.parseStakeInfo(result);
      if (!parsed) return null;

      await CacheService.set(cacheKey, parsed, 60); // 60 seconds cache

      return parsed;
    } catch (err: any) {
      if (err.message && err.message.includes('StakeNotFound')) {
        return null;
      }
      logger.error('Failed to get stake from contract', { mentorAddress, error: err.message });
      throw err;
    }
  }

  private parseStakeInfo(result: any): StakeInfoResponse | null {
    if (!result || typeof result !== 'object') return null;

    const amount = typeof result.amount === 'bigint' ? result.amount : BigInt(result.amount || 0);
    const lockPeriodDays = Number(result.lock_period_days || 0);
    const stakedAt = Number(result.staked_at || 0);
    const unlockAt = Number(result.unlock_at || 0);
    const mentor = String(result.mentor || '');

    const nowSeconds = Math.floor(Date.now() / 1000);
    const stakedDurationSeconds = Math.max(0, nowSeconds - stakedAt);
    
    // Yield calculation: amount * APY * (duration_in_years)
    const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
    const durationInYears = stakedDurationSeconds / SECONDS_PER_YEAR;
    
    const accruedYieldStroops = Math.floor(Number(amount) * this.APY * durationInYears);

    return {
      mentor,
      amount: amount.toString(),
      lockPeriodDays,
      stakedAt,
      unlockAt,
      accruedYield: accruedYieldStroops.toString(),
      apy: this.APY,
      isUnlocked: nowSeconds >= unlockAt,
    };
  }

  async getStakeByUserId(userId: string): Promise<StakeInfoResponse | null> {
    const wallet = await WalletModel.findByUserId(userId);
    if (!wallet || !wallet.stellar_public_key) {
      return null;
    }
    return this.getStake(wallet.stellar_public_key);
  }

  /**
   * Sync worker integration: Re-fetches stakes for active mentors and populates the cache
   */
  async syncAllStakes(): Promise<{ synced: number; failed: number }> {
    let synced = 0;
    let failed = 0;

    try {
      const { rows } = await pool.query<{ stellar_public_key: string }>(`
        SELECT w.stellar_public_key 
        FROM users u 
        JOIN wallets w ON w.user_id = u.id 
        WHERE u.role = 'mentor' AND u.is_active = true AND w.stellar_public_key IS NOT NULL
      `);

      for (const row of rows) {
        try {
          const contractAddress = this.requireContractAddress();
          const result = await this.client.simulate({
            contractAddress,
            method: 'get_stake',
            args: [row.stellar_public_key],
          });

          if (result) {
            const parsed = this.parseStakeInfo(result);
            if (parsed) {
               await CacheService.set(this.getCacheKey(row.stellar_public_key), parsed, 60);
            }
          }
          synced++;
        } catch (err: any) {
          if (!err.message?.includes('StakeNotFound')) {
             failed++;
             logger.warn('Failed to sync stake for mentor', { mentor: row.stellar_public_key, error: err.message });
          } else {
             synced++;
          }
        }
      }
    } catch (error: any) {
      logger.error('Failed to sync all stakes', { error: error.message });
      throw error;
    }

    return { synced, failed };
  }
}

export const StakingService = new StakingServiceImpl(new StellarSorobanStakingClient());
