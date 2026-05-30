import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { CacheService } from "./cache.service";
import { createError } from "../middleware/errorHandler";

export interface PricingExperiment {
  id: string;
  mentorId: string;
  name: string;
  description: string | null;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';
  startAt: Date | null;
  endAt: Date | null;
  controlPrice: number;
  variantPrices: VariantPrice[];
  metrics: ExperimentMetrics;
  createdAt: Date;
  updatedAt: Date;
}

export interface VariantPrice {
  label: string;
  price: number;
  sessionsBooked: number;
  revenue: number;
}

export interface ExperimentMetrics {
  controlSessions: number;
  variantSessions: number;
  conversionLift: number;
  confidence: number;
}

export interface PricingBenchmark {
  category: string;
  subcategory: string | null;
  skill: string;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
  sampleSize: number;
}

export interface MarketDemandMetrics {
  skill: string;
  period: string;
  periodStart: string;
  searchCount: number;
  bookingCount: number;
  mentorCount: number;
  avgSessionPrice: number | null;
  totalRevenue: number | null;
  demandScore: number | null;
  supplyScore: number | null;
}

export interface PricingRecommendation {
  id: string;
  currentPrice: number;
  recommendedPrice: number;
  confidence: number | null;
  marketPosition: string | null;
  factors: { factor: string; impact: string }[];
  reason: string | null;
}

export const DynamicPricingService = {
  async getMarketDemand(
    skill?: string,
    category?: string,
    period: string = 'monthly',
    limit: number = 12,
  ): Promise<MarketDemandMetrics[]> {
    try {
      let query = `SELECT * FROM market_demand_metrics WHERE period = $1`;
      const params: any[] = [period];

      if (skill) {
        query += ` AND skill = $2`;
        params.push(skill);
      } else if (category) {
        query += ` AND category = $2`;
        params.push(category);
      }

      query += ` ORDER BY period_start DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const { rows } = await pool.query(query, params);
      return rows.map(r => ({
        skill: r.skill,
        period: r.period,
        periodStart: r.period_start,
        searchCount: r.search_count,
        bookingCount: r.booking_count,
        mentorCount: r.mentor_count,
        avgSessionPrice: r.avg_session_price ? parseFloat(r.avg_session_price) : null,
        totalRevenue: r.total_revenue ? parseFloat(r.total_revenue) : null,
        demandScore: r.demand_score ? parseFloat(r.demand_score) : null,
        supplyScore: r.supply_score ? parseFloat(r.supply_score) : null,
      }));
    } catch (error) {
      logger.error("Failed to get market demand", { skill, category, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getBenchmarks(category?: string, skill?: string): Promise<PricingBenchmark[]> {
    try {
      let query = `SELECT * FROM pricing_benchmarks WHERE 1=1`;
      const params: any[] = [];

      if (category) {
        query += ` AND category = $${params.length + 1}`;
        params.push(category);
      }
      if (skill) {
        query += ` AND skill = $${params.length + 1}`;
        params.push(skill);
      }

      query += ` ORDER BY category, skill`;
      const { rows } = await pool.query(query, params);

      return rows.map(r => ({
        category: r.category,
        subcategory: r.subcategory,
        skill: r.skill,
        p10: r.p10_price ? parseFloat(r.p10_price) : null,
        p25: r.p25_price ? parseFloat(r.p25_price) : null,
        p50: r.p50_price ? parseFloat(r.p50_price) : null,
        p75: r.p75_price ? parseFloat(r.p75_price) : null,
        p90: r.p90_price ? parseFloat(r.p90_price) : null,
        avg: r.avg_price ? parseFloat(r.avg_price) : null,
        min: r.min_price ? parseFloat(r.min_price) : null,
        max: r.max_price ? parseFloat(r.max_price) : null,
        sampleSize: r.sample_size,
      }));
    } catch (error) {
      logger.error("Failed to get pricing benchmarks", { category, skill, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getRecommendation(mentorId: string): Promise<PricingRecommendation | null> {
    try {
      const cacheKey = `pricing:rec:${mentorId}`;
      const cached = await CacheService.get<PricingRecommendation>(cacheKey);
      if (cached) return cached;

      const mentor = await pool.query(
        `SELECT u.id, u.hourly_rate, u.expertise FROM users u WHERE u.id = $1 AND u.role = 'mentor'`,
        [mentorId],
      );
      if (mentor.rows.length === 0) throw createError("Mentor not found", 404);

      const currentPrice = mentor.rows[0].hourly_rate || 0;
      const expertise = mentor.rows[0].expertise || [];

      const expertiseAreas = Array.isArray(expertise) ? expertise : [expertise];
      const skill = expertiseAreas[0] || 'general';

      const { rows: benchmarks } = await pool.query(
        `SELECT * FROM pricing_benchmarks WHERE skill = $1 OR category = $2 ORDER BY computed_at DESC LIMIT 1`,
        [skill, skill],
      );

      let recommendedPrice = currentPrice;
      let confidence = 50;
      let marketPosition = 'at_market';
      const factors: { factor: string; impact: string }[] = [];

      if (benchmarks.length > 0) {
        const b = benchmarks[0];
        const avgPrice = parseFloat(b.avg_price) || currentPrice;
        const medianPrice = parseFloat(b.p50_price) || avgPrice;

        const ratio = currentPrice > 0 ? currentPrice / medianPrice : 1;
        if (ratio < 0.8) {
          marketPosition = 'below_market';
          recommendedPrice = Math.round(medianPrice * 100) / 100;
          factors.push({ factor: 'market_position', impact: 'Your price is below market median' });
        } else if (ratio > 1.2) {
          marketPosition = 'above_market';
          recommendedPrice = Math.round(medianPrice * 100) / 100;
          factors.push({ factor: 'market_position', impact: 'Your price is above market median' });
        } else {
          factors.push({ factor: 'market_position', impact: 'Your price aligns with market median' });
        }

        if (b.sample_size > 50) {
          confidence = Math.min(confidence + 25, 95);
          factors.push({ factor: 'sample_size', impact: `${b.sample_size} data points available` });
        }

        factors.push({ factor: 'demand_analysis', impact: 'Based on current market demand trends' });
      } else {
        factors.push({ factor: 'insufficient_data', impact: 'Not enough market data for this skill category' });
        confidence = 30;
      }

      const recommendation: PricingRecommendation = {
        id: '',
        currentPrice,
        recommendedPrice,
        confidence,
        marketPosition,
        factors,
        reason: confidence > 50
          ? `Recommended price based on market analysis for ${skill}. Your current rate is ${marketPosition.replace('_', ' ')}.`
          : 'Insufficient data for a confident recommendation.',
      };

      await CacheService.set(cacheKey, recommendation, 3600);
      return recommendation;
    } catch (error) {
      logger.error("Failed to get pricing recommendation", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async applyRecommendation(mentorId: string, price: number): Promise<void> {
    try {
      const { rowCount } = await pool.query(
        `UPDATE users SET hourly_rate = $1, updated_at = NOW() WHERE id = $2 AND role = 'mentor'`,
        [price, mentorId],
      );
      if (rowCount === 0) throw createError("Mentor not found", 404);

      await pool.query(
        `INSERT INTO pricing_recommendations (mentor_id, current_price, recommended_price, applied, applied_at)
         VALUES ($1, (SELECT hourly_rate FROM users WHERE id = $1), $2, true, CURRENT_TIMESTAMP)`,
        [mentorId, price],
      );

      await CacheService.del(`pricing:rec:${mentorId}`);
      logger.info("Pricing recommendation applied", { mentorId, price });
    } catch (error) {
      logger.error("Failed to apply pricing recommendation", { mentorId, price, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getExperiments(mentorId: string): Promise<PricingExperiment[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM pricing_experiments WHERE mentor_id = $1 ORDER BY created_at DESC`,
        [mentorId],
      );
      return rows.map(r => ({
        id: r.id,
        mentorId: r.mentor_id,
        name: r.name,
        description: r.description,
        status: r.status,
        startAt: r.start_at,
        endAt: r.end_at,
        controlPrice: parseFloat(r.control_price),
        variantPrices: r.variant_prices || [],
        metrics: r.metrics || {},
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } catch (error) {
      logger.error("Failed to get pricing experiments", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async createExperiment(
    mentorId: string,
    name: string,
    description: string | undefined,
    controlPrice: number,
    variantPrices: { label: string; price: number }[],
    startAt: string | undefined,
    endAt: string | undefined,
  ): Promise<PricingExperiment> {
    try {
      const { rows } = await pool.query(
        `INSERT INTO pricing_experiments (mentor_id, name, description, control_price, variant_prices, start_at, end_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [mentorId, name, description || null, controlPrice, JSON.stringify(variantPrices.map(v => ({ ...v, sessionsBooked: 0, revenue: 0 }))), startAt || null, endAt || null],
      );

      logger.info("Pricing experiment created", { mentorId, name, experimentId: rows[0].id });
      return {
        id: rows[0].id,
        mentorId: rows[0].mentor_id,
        name: rows[0].name,
        description: rows[0].description,
        status: rows[0].status,
        startAt: rows[0].start_at,
        endAt: rows[0].end_at,
        controlPrice: parseFloat(rows[0].control_price),
        variantPrices: rows[0].variant_prices || [],
        metrics: rows[0].metrics || {},
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      };
    } catch (error) {
      logger.error("Failed to create pricing experiment", { mentorId, name, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async updateExperimentStatus(
    experimentId: string,
    mentorId: string,
    status: PricingExperiment['status'],
  ): Promise<PricingExperiment | null> {
    try {
      const { rows } = await pool.query(
        `UPDATE pricing_experiments SET status = $1 WHERE id = $2 AND mentor_id = $3 RETURNING *`,
        [status, experimentId, mentorId],
      );
      if (rows.length === 0) return null;
      logger.info("Pricing experiment status updated", { experimentId, mentorId, status });
      return {
        id: rows[0].id,
        mentorId: rows[0].mentor_id,
        name: rows[0].name,
        description: rows[0].description,
        status: rows[0].status,
        startAt: rows[0].start_at,
        endAt: rows[0].end_at,
        controlPrice: parseFloat(rows[0].control_price),
        variantPrices: rows[0].variant_prices || [],
        metrics: rows[0].metrics || {},
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      };
    } catch (error) {
      logger.error("Failed to update pricing experiment status", { experimentId, status, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getDashboardStats(userId: string): Promise<any> {
    try {
      const [experimentsRes, benchmarksRes, recommendationsRes] = await Promise.all([
        pool.query(`SELECT COUNT(*)::INTEGER as total, COUNT(*) FILTER (WHERE status = 'running')::INTEGER as active FROM pricing_experiments WHERE mentor_id = $1`, [userId]),
        pool.query(`SELECT category, COUNT(*)::INTEGER as count FROM pricing_benchmarks GROUP BY category ORDER BY count DESC`),
        pool.query(`SELECT * FROM pricing_recommendations WHERE mentor_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]),
      ]);

      const latestRec = recommendationsRes.rows[0];

      return {
        experiments: experimentsRes.rows[0] || { total: 0, active: 0 },
        benchmarkCategories: benchmarksRes.rows,
        latestRecommendation: latestRec ? {
          currentPrice: parseFloat(latestRec.current_price),
          recommendedPrice: parseFloat(latestRec.recommended_price),
          confidence: latestRec.confidence ? parseFloat(latestRec.confidence) : null,
          applied: latestRec.applied,
          createdAt: latestRec.created_at,
        } : null,
      };
    } catch (error) {
      logger.error("Failed to get pricing dashboard stats", { userId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async computeMarketDemand(skill: string, category: string | undefined): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT
           COUNT(DISTINCT b.id) AS booking_count,
           COUNT(DISTINCT u.id) AS mentor_count,
           COALESCE(AVG(s.hourly_rate), 0) AS avg_price,
           COALESCE(SUM(b.amount), 0) AS total_revenue
         FROM bookings b
         JOIN users u ON u.role = 'mentor'
         LEFT JOIN LATERAL (SELECT hourly_rate FROM users WHERE id = b.mentor_id) s ON true
         WHERE ($1 = '' OR u.expertise @> ARRAY[$1])
         AND b.created_at > NOW() - INTERVAL '30 days'`,
        [skill],
      );

      const demandScore = Math.min(rows[0].booking_count > 10 ? 80 : rows[0].booking_count > 5 ? 60 : 40, 100);
      const supplyScore = Math.min(rows[0].mentor_count > 20 ? 80 : rows[0].mentor_count > 10 ? 60 : 40, 100);

      await pool.query(
        `INSERT INTO market_demand_metrics (skill, category, period, period_start, period_end, search_count, booking_count, mentor_count, avg_session_price, total_revenue, demand_score, supply_score)
         VALUES ($1, $2, 'monthly', DATE_TRUNC('month', NOW())::DATE, (DATE_TRUNC('month', NOW()) + INTERVAL '1 month - 1 day')::DATE, 0, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (skill, period, period_start) DO UPDATE SET
           booking_count = EXCLUDED.booking_count,
           mentor_count = EXCLUDED.mentor_count,
           avg_session_price = EXCLUDED.avg_session_price,
           total_revenue = EXCLUDED.total_revenue,
           demand_score = EXCLUDED.demand_score,
           supply_score = EXCLUDED.supply_score`,
        [skill, category || null, rows[0].booking_count, rows[0].mentor_count, rows[0].avg_price, rows[0].total_revenue, demandScore, supplyScore],
      );

      logger.info("Market demand metrics computed", { skill, demandScore, supplyScore });
    } catch (error) {
      logger.error("Failed to compute market demand", { skill, error: error instanceof Error ? error.message : error });
    }
  },
};
