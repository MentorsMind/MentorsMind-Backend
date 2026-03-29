import { server } from "../config/stellar";
import { redis } from "../config/redis";
import { logger } from "../utils/logger.utils";

const CACHE_KEY = "stellar:fee_stats";
const CACHE_TTL = 30; // seconds

export interface FeeEstimate {
  base_fee: number;
  recommended_fee: number;
  surge_pricing_enabled: boolean;
}

export const StellarFeesService = {
  async getFeeEstimate(operations: number = 1): Promise<FeeEstimate> {
    try {
      // 🔹 Cache check
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        const { baseFee, recommendedFee } = JSON.parse(cached);

        const surge = recommendedFee > baseFee * 10;

        return {
          base_fee: baseFee * operations,
          recommended_fee: recommendedFee * operations,
          surge_pricing_enabled: surge,
        };
      }

      // 🔹 Fetch from Stellar SDK (NOT axios)
      const stats = await server.feeStats();

      const baseFee = Number(stats.last_ledger_base_fee);
      const recommendedFee = Number(stats.fee_charged.p90);

      const surge = recommendedFee > baseFee * 10;

      const raw = {
        baseFee,
        recommendedFee,
      };

      await redis.set(CACHE_KEY, JSON.stringify(raw), "EX", CACHE_TTL);

      return {
        base_fee: baseFee * operations,
        recommended_fee: recommendedFee * operations,
        surge_pricing_enabled: surge,
      };
    } catch (error) {
      logger.error("Failed to fetch Stellar fee stats", {
        error: error instanceof Error ? error.message : error,
      });

      // fallback (important for UX)
      return {
        base_fee: 100 * operations,
        recommended_fee: 100 * operations,
        surge_pricing_enabled: false,
      };
    }
  },
};
