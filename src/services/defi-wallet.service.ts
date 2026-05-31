import { logger } from "../config/logger";

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

export class DeFiWalletService {
  /**
   * Get all DeFi positions for a user across supported chains.
   */
  async getUserPositions(userId: string): Promise<DeFiPosition[]> {
    const positions: DeFiPosition[] = [];

    for (const chain of SUPPORTED_CHAINS) {
      try {
        const chainPositions = await this.getPositionsForChain(userId, chain);
        positions.push(...chainPositions);
      } catch (err) {
        logger.warn(
          { userId, chain, err },
          "Failed to fetch DeFi positions for chain",
        );
      }
    }

    return positions;
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
    const total = positions.reduce((sum, p) => sum + parseFloat(p.value), 0);
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getPositionsForChain(
    userId: string,
    chain: SupportedChain,
  ): Promise<DeFiPosition[]> {
    // In production this would call chain-specific indexers / subgraphs.
    // Returning mock data so the service is functional without external deps.
    return this.getMockPositions(userId, chain);
  }

  private getMockPositions(
    userId: string,
    chain: SupportedChain,
  ): DeFiPosition[] {
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

export const defiWalletService = new DeFiWalletService();
