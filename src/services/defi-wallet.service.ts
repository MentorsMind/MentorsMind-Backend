import axios from "axios";
import { CacheService } from "./cache.service";
import { stellarService } from "./stellar.service";
import { WalletModel, type Wallet } from "../models/wallet.model";
import { logger } from "../utils/logger.utils";

export interface DeFiPosition {
  userId: string;
  protocol: string;
  chain: string;
  asset: string;
  amount: string;
  apy: number;
  value: string;
  rewards: string;
  riskScore: number;
}

export interface YieldStrategy {
  name: string;
  protocol: string;
  expectedApy: number;
  riskLevel: "low" | "medium" | "high";
  minimumAmount: string;
  lockPeriod?: number;
}

const SUPPORTED_CHAINS = ["ethereum", "polygon", "stellar"] as const;
type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

const POSITIONS_CACHE_TTL_SECONDS = 10 * 60;

const YIELD_STRATEGIES: YieldStrategy[] = [
  {
    name: "USDC Lending",
    protocol: "Aave",
    expectedApy: 4.5,
    riskLevel: "low",
    minimumAmount: "100",
  },
  {
    name: "ETH Staking",
    protocol: "Lido",
    expectedApy: 3.8,
    riskLevel: "low",
    minimumAmount: "0.01",
    lockPeriod: 0,
  },
  {
    name: "MATIC Yield",
    protocol: "Compound",
    expectedApy: 6.2,
    riskLevel: "medium",
    minimumAmount: "50",
  },
  {
    name: "LP Farming",
    protocol: "Uniswap V3",
    expectedApy: 12.0,
    riskLevel: "high",
    minimumAmount: "500",
    lockPeriod: 7,
  },
];

type ChainEndpointConfig = {
  aave?: string;
  compound?: string;
};

type AddressKey = "ethereum_address" | "polygon_address" | "stellar_public_key";

const AAVE_POSITIONS_QUERY = `
  query AavePositions($user: String!) {
    userReserves(where: { user: $user }) {
      currentATokenBalance
      scaledATokenBalance
      currentATokenBalanceUSD
      reserve {
        symbol
        liquidityRate
        price {
          priceInUsd
          priceUSD
        }
      }
    }
  }
`;

const COMPOUND_POSITIONS_QUERY = `
  query CompoundPositions($account: String!) {
    account(id: $account) {
      tokens {
        symbol
        supplyBalanceUnderlying
        supplyBalanceUnderlyingUSD
        rewardsAccrued
        market {
          underlyingPriceUSD
          supplyRate
          rates {
            side
            rate
          }
        }
      }
    }
    accounts(where: { id: $account }) {
      tokens {
        symbol
        supplyBalanceUnderlying
        supplyBalanceUnderlyingUSD
        rewardsAccrued
        market {
          underlyingPriceUSD
          supplyRate
          rates {
            side
            rate
          }
        }
      }
    }
  }
`;

class MockAdapter {
  getPositions(userId: string, chain: SupportedChain): DeFiPosition[] {
    const mockData: Record<SupportedChain, DeFiPosition[]> = {
      ethereum: [
        {
          userId,
          protocol: "Aave",
          chain: "ethereum",
          asset: "USDC",
          amount: "1000.00",
          apy: 4.5,
          value: "1000.00",
          rewards: "0.12",
          riskScore: 15,
        },
      ],
      polygon: [
        {
          userId,
          protocol: "Compound",
          chain: "polygon",
          asset: "MATIC",
          amount: "500.00",
          apy: 6.2,
          value: "350.00",
          rewards: "0.06",
          riskScore: 35,
        },
      ],
      stellar: [
        {
          userId,
          protocol: "Stellar AMM",
          chain: "stellar",
          asset: "USDC",
          amount: "200.00",
          apy: 3.0,
          value: "200.00",
          rewards: "0.02",
          riskScore: 10,
        },
      ],
    };

    return mockData[chain] ?? [];
  }
}

export class DeFiWalletService {
  private readonly mockAdapter = new MockAdapter();

  /**
   * Get cached DeFi positions for a user, falling back to a fresh sync on miss.
   */
  async getUserPositions(userId: string): Promise<DeFiPosition[]> {
    const cached = await this.getCachedPositions(userId);
    if (cached) return cached;
    return this.syncPositions(userId);
  }

  /**
   * Trigger a fresh DeFi sync and cache the results for 10 minutes.
   */
  async syncPositions(userId: string): Promise<DeFiPosition[]> {
    const wallet = await WalletModel.findByUserId(userId);
    if (!wallet) {
      await CacheService.set(this.getCacheKey(userId), [], POSITIONS_CACHE_TTL_SECONDS);
      return [];
    }

    const positions: DeFiPosition[] = [];

    for (const chain of SUPPORTED_CHAINS) {
      try {
        const chainPositions = await this.getPositionsForChain(userId, wallet, chain);
        positions.push(...chainPositions);
      } catch (err) {
        logger.warn("Failed to sync DeFi positions for chain", {
          userId,
          chain,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    await CacheService.set(this.getCacheKey(userId), positions, POSITIONS_CACHE_TTL_SECONDS);
    return positions;
  }

  async getCachedPositions(userId: string): Promise<DeFiPosition[] | null> {
    return CacheService.get<DeFiPosition[]>(this.getCacheKey(userId));
  }

  /**
   * Get available yield strategies, optionally filtered by risk level.
   */
  getYieldStrategies(riskLevel?: "low" | "medium" | "high"): YieldStrategy[] {
    if (!riskLevel) return YIELD_STRATEGIES;
    return YIELD_STRATEGIES.filter((s) => s.riskLevel === riskLevel);
  }

  /**
   * Calculate the total portfolio value in USD across all positions.
   */
  async getPortfolioValue(userId: string): Promise<string> {
    const positions = await this.getUserPositions(userId);
    const total = positions.reduce((sum, p) => sum + this.toNumber(p.value), 0);
    return total.toFixed(2);
  }

  /**
   * Estimate projected yield for a given strategy and principal amount.
   */
  estimateYield(
    strategy: YieldStrategy,
    principalUsd: number,
    days: number,
  ): number {
    const dailyRate = strategy.expectedApy / 100 / 365;
    return principalUsd * dailyRate * days;
  }

  /**
   * Calculate a composite risk score (0–100) for a set of positions.
   * Higher score = higher risk.
   */
  calculatePortfolioRisk(positions: DeFiPosition[]): number {
    if (positions.length === 0) return 0;
    const avg =
      positions.reduce((sum, p) => sum + p.riskScore, 0) / positions.length;
    return Math.min(100, Math.round(avg));
  }

  private getCacheKey(userId: string): string {
    return `defi:positions:${userId}`;
  }

  private isSandboxEnvironment(): boolean {
    return (
      process.env.DEFI_WALLET_USE_MOCKS === "true" ||
      process.env.APP_ENV === "sandbox" ||
      process.env.NODE_ENV === "test"
    );
  }

  private getChainGraphEndpoints(chain: "ethereum" | "polygon"): ChainEndpointConfig {
    if (chain === "ethereum") {
      return {
        aave: process.env.DEFI_ETHEREUM_AAVE_SUBGRAPH_URL,
        compound: process.env.DEFI_ETHEREUM_COMPOUND_SUBGRAPH_URL,
      };
    }

    return {
      aave: process.env.DEFI_POLYGON_AAVE_SUBGRAPH_URL,
      compound: process.env.DEFI_POLYGON_COMPOUND_SUBGRAPH_URL,
    };
  }

  private getAddressForChain(wallet: Wallet, chain: SupportedChain): string | null {
    const addressKeyByChain: Record<SupportedChain, AddressKey> = {
      ethereum: "ethereum_address",
      polygon: "polygon_address",
      stellar: "stellar_public_key",
    };
    const key = addressKeyByChain[chain];
    const address = wallet[key];
    return typeof address === "string" && address.trim().length > 0 ? address.trim() : null;
  }

  private async getPositionsForChain(
    userId: string,
    wallet: Wallet,
    chain: SupportedChain,
  ): Promise<DeFiPosition[]> {
    if (this.isSandboxEnvironment()) {
      return this.mockAdapter.getPositions(userId, chain);
    }

    if (chain === "stellar") {
      const stellarAddress = this.getAddressForChain(wallet, "stellar");
      if (!stellarAddress) return [];
      return this.getStellarPositions(userId, stellarAddress);
    }

    const walletAddress = this.getAddressForChain(wallet, chain);
    if (!walletAddress) return [];

    const [aavePositions, compoundPositions] = await Promise.all([
      this.getAavePositions(userId, chain, walletAddress),
      this.getCompoundPositions(userId, chain, walletAddress),
    ]);

    return [...aavePositions, ...compoundPositions];
  }

  private async getStellarPositions(
    userId: string,
    publicKey: string,
  ): Promise<DeFiPosition[]> {
    const account = await stellarService.getAccount(publicKey);
    const lpBalances = account.balances.filter(
      (balance) => balance.assetType === "liquidity_pool_shares",
    );

    return lpBalances.map((balance) => {
      const amount = this.toNumber(balance.balance);
      const assetLabel = balance.liquidityPoolId
        ? `LP:${balance.liquidityPoolId.slice(0, 12)}`
        : "liquidity_pool_shares";

      return {
        userId,
        protocol: "Stellar AMM",
        chain: "stellar",
        asset: assetLabel,
        amount: amount.toFixed(7),
        apy: 0,
        value: amount.toFixed(2),
        rewards: "0.00",
        riskScore: 20,
      };
    });
  }

  private async getAavePositions(
    userId: string,
    chain: "ethereum" | "polygon",
    walletAddress: string,
  ): Promise<DeFiPosition[]> {
    const endpoint = this.getChainGraphEndpoints(chain).aave;
    if (!endpoint) return [];

    const data = await this.queryGraph(endpoint, AAVE_POSITIONS_QUERY, {
      user: walletAddress.toLowerCase(),
    });
    const positions: any[] = Array.isArray(data?.userReserves) ? data.userReserves : [];

    return positions
      .map<DeFiPosition | null>((position: any) => {
        const amount = this.firstDefinedNumber(
          position.currentATokenBalance,
          position.scaledATokenBalance,
        );
        if (amount <= 0) return null;

        const priceUsd = this.firstDefinedNumber(
          position.currentATokenBalanceUSD && amount > 0
            ? this.toNumber(position.currentATokenBalanceUSD) / amount
            : undefined,
          position.reserve?.price?.priceInUsd,
          position.reserve?.price?.priceUSD,
        );
        const value = this.firstDefinedNumber(
          position.currentATokenBalanceUSD,
          amount * priceUsd,
          amount,
        );

        return {
          userId,
          protocol: "Aave",
          chain,
          asset: position.reserve?.symbol || "UNKNOWN",
          amount: amount.toFixed(8),
          apy: this.normalizeApy(position.reserve?.liquidityRate),
          value: value.toFixed(2),
          rewards: "0.00",
          riskScore: chain === "ethereum" ? 18 : 22,
        } satisfies DeFiPosition;
      })
      .filter((position): position is DeFiPosition => position !== null);
  }

  private async getCompoundPositions(
    userId: string,
    chain: "ethereum" | "polygon",
    walletAddress: string,
  ): Promise<DeFiPosition[]> {
    const endpoint = this.getChainGraphEndpoints(chain).compound;
    if (!endpoint) return [];

    const data = await this.queryGraph(endpoint, COMPOUND_POSITIONS_QUERY, {
      account: walletAddress.toLowerCase(),
    });

    const tokens =
      data?.account?.tokens ??
      (Array.isArray(data?.accounts) ? data.accounts[0]?.tokens : []) ??
      [];

    return (Array.isArray(tokens) ? tokens : [])
      .map<DeFiPosition | null>((token: any) => {
        const amount = this.firstDefinedNumber(
          token.supplyBalanceUnderlying,
          token.cTokenBalance,
        );
        if (amount <= 0) return null;

        const value = this.firstDefinedNumber(
          token.supplyBalanceUnderlyingUSD,
          amount * this.firstDefinedNumber(token.market?.underlyingPriceUSD, 0),
          amount,
        );
        const rate =
          token.market?.rates?.find?.((entry: any) => entry?.side === "LENDER")?.rate ??
          token.market?.supplyRate;

        return {
          userId,
          protocol: "Compound",
          chain,
          asset: token.symbol || token.market?.inputToken?.symbol || "UNKNOWN",
          amount: amount.toFixed(8),
          apy: this.normalizeApy(rate),
          value: value.toFixed(2),
          rewards: this.firstDefinedNumber(token.rewardsAccrued, 0).toFixed(2),
          riskScore: chain === "ethereum" ? 24 : 28,
        } satisfies DeFiPosition;
      })
      .filter((position): position is DeFiPosition => position !== null);
  }

  private async queryGraph(
    endpoint: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<any> {
    const response = await axios.post(
      endpoint,
      { query, variables },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15_000,
      },
    );

    if (response.data?.errors?.length) {
      throw new Error(
        `Graph query failed: ${response.data.errors
          .map((error: { message?: string }) => error.message || "unknown error")
          .join(", ")}`,
      );
    }

    return response.data?.data ?? null;
  }

  private toNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private firstDefinedNumber(...values: unknown[]): number {
    for (const value of values) {
      const parsed = this.toNumber(value);
      if (parsed > 0) return parsed;
    }
    return 0;
  }

  private normalizeApy(rawValue: unknown): number {
    const numeric = this.toNumber(rawValue);
    if (numeric === 0) return 0;

    if (numeric > 1_000_000) {
      return Number((numeric / 1e25).toFixed(2));
    }

    if (numeric > 1) {
      return Number(numeric.toFixed(2));
    }

    return Number((numeric * 100).toFixed(2));
  }
}

export const defiWalletService = new DeFiWalletService();
