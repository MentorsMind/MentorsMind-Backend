import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger";

export interface RevenueData {
  date: string;
  currency: string;
  transaction_count: number;
  total_amount: string;
  total_platform_fee: string;
  avg_amount: string;
}

export interface UserGrowthData {
  date: string;
  role: string;
  new_users: number;
  verified_users: number;
}

export interface SessionData {
  date: string;
  status: string;
  session_count: number;
  avg_duration_minutes: number;
}

export interface TopMentor {
  id: string;
  full_name: string;
  email: string;
  total_sessions: number;
  total_revenue: string;
  avg_rating: number;
  review_count: number;
}

export interface AssetDistribution {
  currency: string;
  transaction_count: number;
  total_volume: string;
  percentage: number;
}

const CACHE_TTL = 300; // 5 minutes

export const AnalyticsService = {
  /**
   * Parse period parameter to days
   */
  parsePeriod(period: string): number {
    const periodMap: Record<string, number> = {
      "7d": 7,
      "30d": 30,
      "90d": 90,
      "1y": 365,
    };
    return periodMap[period] || 30;
  },

  /**
   * Get revenue analytics
   */
  async getRevenue(period: string = "30d"): Promise<RevenueData[]> {
    const cacheKey = `analytics:revenue:${period}`;

    return CacheService.wrap(cacheKey, CACHE_TTL, async () => {
      const days = this.parsePeriod(period);

      const query = `
        SELECT 
          date::text,
          currency,
          transaction_count,
          total_amount::text,
          total_platform_fee::text,
          avg_amount::text
        FROM mv_daily_revenue
        WHERE date >= CURRENT_DATE - $1::integer
        ORDER BY date DESC
      `;

      const { rows } = await pool.query<RevenueData>(query, [days]);

      logger.debug("Revenue analytics fetched", { period, rows: rows.length });
      return rows;
    });
  },

  /**
   * Get user growth analytics
   */
  async getUserGrowth(period: string = "30d"): Promise<UserGrowthData[]> {
    const cacheKey = `analytics:users:${period}`;

    return CacheService.wrap(cacheKey, CACHE_TTL, async () => {
      const days = this.parsePeriod(period);

      const query = `
        SELECT 
          date::text,
          role,
          new_users,
          verified_users
        FROM mv_daily_users
        WHERE date >= CURRENT_DATE - $1::integer
        ORDER BY date DESC
      `;

      const { rows } = await pool.query<UserGrowthData>(query, [days]);

      logger.debug("User growth analytics fetched", {
        period,
        rows: rows.length,
      });
      return rows;
    });
  },

  /**
   * Get session analytics
   */
  async getSessions(period: string = "30d"): Promise<SessionData[]> {
    const cacheKey = `analytics:sessions:${period}`;

    return CacheService.wrap(cacheKey, CACHE_TTL, async () => {
      const days = this.parsePeriod(period);

      const query = `
        SELECT 
          date::text,
          status,
          session_count,
          COALESCE(avg_duration_minutes, 0) as avg_duration_minutes
        FROM mv_session_stats
        WHERE date >= CURRENT_DATE - $1::integer
        ORDER BY date DESC
      `;

      const { rows } = await pool.query<SessionData>(query, [days]);

      logger.debug("Session analytics fetched", { period, rows: rows.length });
      return rows;
    });
  },

  /**
   * Get top mentors
   */
  async getTopMentors(limit: number = 10): Promise<TopMentor[]> {
    const cacheKey = `analytics:top-mentors:${limit}`;

    return CacheService.wrap(cacheKey, CACHE_TTL, async () => {
      const query = `
        SELECT 
          id,
          full_name,
          email,
          total_sessions,
          total_revenue::text,
          COALESCE(avg_rating, 0) as avg_rating,
          review_count
        FROM mv_top_mentors
        WHERE total_revenue IS NOT NULL
        ORDER BY total_revenue DESC
        LIMIT $1
      `;

      const { rows } = await pool.query<TopMentor>(query, [limit]);

      logger.debug("Top mentors analytics fetched", {
        limit,
        rows: rows.length,
      });
      return rows;
    });
  },

  /**
   * Get asset distribution
   */
  async getAssetDistribution(): Promise<AssetDistribution[]> {
    const cacheKey = "analytics:asset-distribution";

    return CacheService.wrap(cacheKey, CACHE_TTL, async () => {
      const query = `
        SELECT 
          currency,
          transaction_count,
          total_volume::text,
          percentage
        FROM mv_asset_distribution
        ORDER BY total_volume DESC
      `;

      const { rows } = await pool.query<AssetDistribution>(query);

      logger.debug("Asset distribution analytics fetched", {
        rows: rows.length,
      });
      return rows;
    });
  },

  /**
   * Export analytics data as CSV
   */
  async exportToCSV(type: string, period: string = "30d"): Promise<string> {
    const csvConfig: Record<
      string,
      { headers: string[]; fetchFn: () => Promise<any[]> }
    > = {
      revenue: {
        headers: [
          "date",
          "currency",
          "transaction_count",
          "total_amount",
          "total_platform_fee",
          "avg_amount",
        ],
        fetchFn: () => this.getRevenue(period),
      },
      users: {
        headers: ["date", "role", "new_users", "verified_users"],
        fetchFn: () => this.getUserGrowth(period),
      },
      sessions: {
        headers: ["date", "status", "session_count", "avg_duration_minutes"],
        fetchFn: () => this.getSessions(period),
      },
      "top-mentors": {
        headers: [
          "id",
          "full_name",
          "email",
          "total_sessions",
          "total_revenue",
          "avg_rating",
          "review_count",
        ],
        fetchFn: () => this.getTopMentors(100),
      },
      "asset-distribution": {
        headers: [
          "currency",
          "transaction_count",
          "total_volume",
          "percentage",
        ],
        fetchFn: () => this.getAssetDistribution(),
      },
    };

    const config = csvConfig[type];
    if (!config) throw new Error(`Unknown analytics type: ${type}`);

    const data = await config.fetchFn();
    const { headers } = config;

    // Convert to CSV
    const csvRows = [headers.join(",")];

    for (const row of data) {
      const values = headers.map((header) => {
        const value = row[header];
        // Escape values containing commas or quotes
        if (
          typeof value === "string" &&
          (value.includes(",") || value.includes('"'))
        ) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value ?? "";
      });
      csvRows.push(values.join(","));
    }

    return csvRows.join("\n");
  },

  /**
   * Refresh all analytics materialized views
   */
  async refreshViews(): Promise<void> {
    try {
      await pool.query("SELECT refresh_analytics_views()");
      logger.info("Analytics views refreshed successfully");
    } catch (error) {
      logger.error("Failed to refresh analytics views", { error });
      throw error;
    }
  },
};
