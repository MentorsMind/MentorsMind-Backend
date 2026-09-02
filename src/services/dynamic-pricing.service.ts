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
  impressions?: number;
  sessionsBooked: number;
  revenue: number;
  conversionRate?: number;
}

export interface ExperimentMetrics {
  controlImpressions?: number;
  controlSessions: number;
  controlConversionRate?: number;
  variantImpressions?: number;
  variantSessions: number;
  variantConversionRate?: number;
  conversionLift: number;
  absoluteLift?: number;
  zScore?: number;
  pValue?: number;
  confidence: number;
  isSignificant?: boolean;
  confidenceInterval?: {
    lower: number;
    upper: number;
    liftLower?: number;
    liftUpper?: number;
  };
  minimumSampleSizeMet?: boolean;
  autoStopped?: boolean;
  winner?: 'control' | 'variant' | 'inconclusive' | null;
  recommendedAction?: string;
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

/**
 * Standard normal cumulative distribution function (CDF).
 * Uses erf polynomial approximation with precision |error| < 1.5e-7.
 */
export function normalCdf(z: number): number {
  if (z === 0) return 0.5;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  const erf = sign * y;
  return 0.5 * (1.0 + erf);
}

/**
 * Two-proportion z-test for conversion lift and confidence intervals.
 */
export function calculateTwoProportionZTest(
  controlConversions: number,
  controlImpressions: number,
  variantConversions: number,
  variantImpressions: number,
  confidenceThreshold: number = 0.95,
  minimumSampleSize: number = 30,
) {
  const minSampleMet = controlImpressions >= minimumSampleSize && variantImpressions >= minimumSampleSize;

  if (controlImpressions <= 0 || variantImpressions <= 0) {
    return {
      controlRate: 0,
      variantRate: 0,
      conversionLift: 0,
      absoluteLift: 0,
      zScore: 0,
      pValue: 1,
      confidence: 0,
      isSignificant: false,
      confidenceInterval: { lower: 0, upper: 0, liftLower: 0, liftUpper: 0 },
      minimumSampleSizeMet: false,
      winner: null as 'control' | 'variant' | 'inconclusive' | null,
      recommendedAction: `Gathering data (minimum ${minimumSampleSize} impressions per variant required).`,
    };
  }

  const p1 = controlConversions / controlImpressions;
  const p2 = variantConversions / variantImpressions;
  const absoluteLift = p2 - p1;
  const conversionLift = p1 > 0 ? ((p2 - p1) / p1) * 100 : 0;

  // Pooled proportion under H0 (p1 == p2)
  const pooledP = (controlConversions + variantConversions) / (controlImpressions + variantImpressions);
  const sePooled = Math.sqrt(pooledP * (1 - pooledP) * (1 / controlImpressions + 1 / variantImpressions));

  let zScore = 0;
  if (sePooled > 0) {
    zScore = (p2 - p1) / sePooled;
  }

  // Two-tailed p-value
  const cdf = normalCdf(Math.abs(zScore));
  const pValue = Math.max(0, Math.min(1, 2 * (1 - cdf)));
  const confidence = Math.max(0, Math.min(100, (1 - pValue) * 100));
  const isSignificant = confidence >= confidenceThreshold * 100 && minSampleMet;

  // Unpooled SE for 95% confidence interval
  const seDiff = Math.sqrt((p1 * (1 - p1)) / controlImpressions + (p2 * (1 - p2)) / variantImpressions);
  const zCrit = 1.959963984540054; // 95% confidence critical value
  const lowerDiff = absoluteLift - zCrit * seDiff;
  const upperDiff = absoluteLift + zCrit * seDiff;

  const liftLower = p1 > 0 ? (lowerDiff / p1) * 100 : 0;
  const liftUpper = p1 > 0 ? (upperDiff / p1) * 100 : 0;

  let winner: 'control' | 'variant' | 'inconclusive' | null = null;
  let recommendedAction = 'Experiment in progress. Insufficient statistical significance to declare a winner.';

  if (isSignificant) {
    if (zScore > 0) {
      winner = 'variant';
      recommendedAction = `Variant price demonstrated a statistically significant conversion lift of +${conversionLift.toFixed(2)}% (${confidence.toFixed(1)}% confidence). Recommended: Adopt variant pricing.`;
    } else {
      winner = 'control';
      recommendedAction = `Variant price produced a statistically significant drop of ${Math.abs(conversionLift).toFixed(2)}% (${confidence.toFixed(1)}% confidence). Recommended: Retain control pricing.`;
    }
  } else if (minSampleMet && controlImpressions >= 200 && variantImpressions >= 200 && pValue > 0.3) {
    winner = 'inconclusive';
    recommendedAction = 'Sample size target reached with no statistically significant conversion difference. Recommended: Conclude experiment or test a higher price divergence.';
  } else if (!minSampleMet) {
    recommendedAction = `Gathering data (${controlImpressions}/${minimumSampleSize} control, ${variantImpressions}/${minimumSampleSize} variant impressions).`;
  }

  return {
    controlRate: Math.round(p1 * 10000) / 10000,
    variantRate: Math.round(p2 * 10000) / 10000,
    conversionLift: Math.round(conversionLift * 100) / 100,
    absoluteLift: Math.round(absoluteLift * 10000) / 10000,
    zScore: Math.round(zScore * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    confidence: Math.round(confidence * 10) / 10,
    isSignificant,
    confidenceInterval: {
      lower: Math.round(lowerDiff * 10000) / 10000,
      upper: Math.round(upperDiff * 10000) / 10000,
      liftLower: Math.round(liftLower * 100) / 100,
      liftUpper: Math.round(liftUpper * 100) / 100,
    },
    minimumSampleSizeMet: minSampleMet,
    winner,
    recommendedAction,
  };
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
      logger.error("Failed to get market demand metrics", { skill, category, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getBenchmarks(category?: string, skill?: string): Promise<PricingBenchmark[]> {
    try {
      let query = `SELECT * FROM pricing_benchmarks WHERE 1=1`;
      const params: any[] = [];

      if (category) {
        params.push(category);
        query += ` AND category = $${params.length}`;
      }
      if (skill) {
        params.push(skill);
        query += ` AND skill = $${params.length}`;
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

      const userRes = await pool.query(
        `SELECT id, hourly_rate, expertise FROM users WHERE id = $1 AND role = 'mentor'`,
        [mentorId],
      );
      if (userRes.rows.length === 0) return null;

      const user = userRes.rows[0];
      const currentPrice = parseFloat(user.hourly_rate) || 50;
      const skill = user.expertise?.[0] || 'General';

      const benchmarkRes = await pool.query(
        `SELECT * FROM pricing_benchmarks WHERE skill ILIKE $1 LIMIT 1`,
        [`%${skill}%`],
      );
      const benchmark = benchmarkRes.rows[0];

      const demandRes = await pool.query(
        `SELECT * FROM market_demand_metrics WHERE skill ILIKE $1 ORDER BY period_start DESC LIMIT 1`,
        [`%${skill}%`],
      );
      const demand = demandRes.rows[0];

      let recommendedPrice = currentPrice;
      let confidence = 50;
      let marketPosition = 'median';
      const factors: { factor: string; impact: string }[] = [];

      if (benchmark) {
        const p50 = parseFloat(benchmark.p50_price) || currentPrice;
        const p75 = parseFloat(benchmark.p75_price) || currentPrice;
        const p25 = parseFloat(benchmark.p25_price) || currentPrice;

        if (currentPrice < p25) {
          marketPosition = 'below_market';
          recommendedPrice = p25;
          factors.push({ factor: 'market_benchmark', impact: 'Your price is below the 25th percentile for your skill' });
        } else if (currentPrice > p75) {
          marketPosition = 'premium';
          recommendedPrice = currentPrice;
          factors.push({ factor: 'market_benchmark', impact: 'Your price is in the top quartile (premium positioning)' });
        } else {
          marketPosition = 'competitive';
          recommendedPrice = p50;
          factors.push({ factor: 'market_benchmark', impact: 'Your price aligns with median market rates' });
        }

        confidence = Math.min(benchmark.sample_size > 50 ? 85 : benchmark.sample_size > 20 ? 70 : 50, 95);
      }

      if (demand) {
        const demandScore = parseFloat(demand.demand_score) || 50;
        const supplyScore = parseFloat(demand.supply_score) || 50;

        if (demandScore > 70 && supplyScore < 50) {
          recommendedPrice = Math.round(recommendedPrice * 1.15);
          factors.push({ factor: 'high_demand_low_supply', impact: 'High demand and low mentor supply justify a 15% increase' });
          confidence = Math.min(confidence + 10, 95);
        } else if (demandScore < 40 && supplyScore > 60) {
          recommendedPrice = Math.round(recommendedPrice * 0.9);
          factors.push({ factor: 'low_demand_high_supply', impact: 'High supply competition suggests a 10% reduction to increase bookings' });
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

  /**
   * Evaluates statistical significance and checks auto-stopping rules for an experiment.
   */
  async evaluateExperiment(
    experimentId: string,
    mentorId: string,
  ): Promise<PricingExperiment | null> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM pricing_experiments WHERE id = $1 AND mentor_id = $2`,
        [experimentId, mentorId],
      );
      if (rows.length === 0) return null;

      const exp = rows[0];
      const variantPrices: VariantPrice[] = exp.variant_prices || [];
      const primaryVariant = variantPrices[0] || {
        label: 'Variant A',
        price: exp.control_price,
        sessionsBooked: 0,
        impressions: 0,
        revenue: 0,
      };

      const existingMetrics = exp.metrics || {};
      const controlSessions = existingMetrics.controlSessions ?? 0;
      const controlImpressions = existingMetrics.controlImpressions ?? Math.max(controlSessions, 30);
      const variantSessions = primaryVariant.sessionsBooked ?? existingMetrics.variantSessions ?? 0;
      const variantImpressions = primaryVariant.impressions ?? Math.max(variantSessions, 30);

      const stats = calculateTwoProportionZTest(
        controlSessions,
        controlImpressions,
        variantSessions,
        variantImpressions,
        0.95,
        30,
      );

      let newStatus: PricingExperiment['status'] = exp.status;
      let autoStopped = existingMetrics.autoStopped || false;

      // Auto-stopping rule: When 95% statistical significance is achieved and minimum sample size met
      if (exp.status === 'running' && stats.isSignificant) {
        newStatus = 'completed';
        autoStopped = true;
        logger.info("Auto-stopping experiment: 95% confidence reached", {
          experimentId,
          mentorId,
          winner: stats.winner,
          confidence: stats.confidence,
          lift: stats.conversionLift,
        });
      }

      const updatedMetrics: ExperimentMetrics = {
        controlImpressions,
        controlSessions,
        controlConversionRate: stats.controlRate,
        variantImpressions,
        variantSessions,
        variantConversionRate: stats.variantRate,
        conversionLift: stats.conversionLift,
        absoluteLift: stats.absoluteLift,
        zScore: stats.zScore,
        pValue: stats.pValue,
        confidence: stats.confidence,
        isSignificant: stats.isSignificant,
        confidenceInterval: stats.confidenceInterval,
        minimumSampleSizeMet: stats.minimumSampleSizeMet,
        autoStopped,
        winner: stats.winner,
        recommendedAction: stats.recommendedAction,
      };

      const updatedVariantPrices = variantPrices.map(v => ({
        ...v,
        conversionRate: (v.impressions && v.impressions > 0)
          ? Math.round((v.sessionsBooked / v.impressions) * 10000) / 10000
          : (v.sessionsBooked > 0 ? 1 : 0),
      }));

      const updateRes = await pool.query(
        `UPDATE pricing_experiments
         SET metrics = $1, variant_prices = $2, status = $3, updated_at = NOW(),
             end_at = CASE WHEN $3 = 'completed' AND end_at IS NULL THEN NOW() ELSE end_at END
         WHERE id = $4 AND mentor_id = $5
         RETURNING *`,
        [JSON.stringify(updatedMetrics), JSON.stringify(updatedVariantPrices), newStatus, experimentId, mentorId],
      );

      const updated = updateRes.rows[0];
      return {
        id: updated.id,
        mentorId: updated.mentor_id,
        name: updated.name,
        description: updated.description,
        status: updated.status,
        startAt: updated.start_at,
        endAt: updated.end_at,
        controlPrice: parseFloat(updated.control_price),
        variantPrices: updated.variant_prices || [],
        metrics: updated.metrics || {},
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      };
    } catch (error) {
      logger.error("Failed to evaluate pricing experiment", { experimentId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getExperiments(mentorId: string): Promise<PricingExperiment[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM pricing_experiments WHERE mentor_id = $1 ORDER BY created_at DESC`,
        [mentorId],
      );

      return Promise.all(
        rows.map(async r => {
          const variantPrices: VariantPrice[] = r.variant_prices || [];
          const primaryVariant = variantPrices[0];
          const rawMetrics = r.metrics || {};

          const controlSessions = rawMetrics.controlSessions ?? 0;
          const controlImpressions = rawMetrics.controlImpressions ?? Math.max(controlSessions, 30);
          const variantSessions = primaryVariant?.sessionsBooked ?? rawMetrics.variantSessions ?? 0;
          const variantImpressions = primaryVariant?.impressions ?? Math.max(variantSessions, 30);

          const stats = calculateTwoProportionZTest(
            controlSessions,
            controlImpressions,
            variantSessions,
            variantImpressions,
            0.95,
            30,
          );

          let status = r.status;
          let autoStopped = rawMetrics.autoStopped || false;
          if (r.status === 'running' && stats.isSignificant) {
            status = 'completed';
            autoStopped = true;
            await pool.query(
              `UPDATE pricing_experiments SET status = 'completed', end_at = COALESCE(end_at, NOW()), updated_at = NOW() WHERE id = $1`,
              [r.id],
            );
          }

          const metrics: ExperimentMetrics = {
            controlImpressions,
            controlSessions,
            controlConversionRate: stats.controlRate,
            variantImpressions,
            variantSessions,
            variantConversionRate: stats.variantRate,
            conversionLift: stats.conversionLift,
            absoluteLift: stats.absoluteLift,
            zScore: stats.zScore,
            pValue: stats.pValue,
            confidence: stats.confidence,
            isSignificant: stats.isSignificant,
            confidenceInterval: stats.confidenceInterval,
            minimumSampleSizeMet: stats.minimumSampleSizeMet,
            autoStopped,
            winner: stats.winner,
            recommendedAction: stats.recommendedAction,
          };

          return {
            id: r.id,
            mentorId: r.mentor_id,
            name: r.name,
            description: r.description,
            status,
            startAt: r.start_at,
            endAt: r.end_at,
            controlPrice: parseFloat(r.control_price),
            variantPrices,
            metrics,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          };
        }),
      );
    } catch (error) {
      logger.error("Failed to get pricing experiments", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getExperimentById(experimentId: string, mentorId: string): Promise<PricingExperiment | null> {
    return this.evaluateExperiment(experimentId, mentorId);
  },

  async createExperiment(
    mentorId: string,
    name: string,
    description: string | undefined,
    controlPrice: number,
    variantPrices: { label: string; price: number; impressions?: number }[],
    startAt: string | undefined,
    endAt: string | undefined,
  ): Promise<PricingExperiment> {
    try {
      const initialMetrics: ExperimentMetrics = {
        controlImpressions: 0,
        controlSessions: 0,
        controlConversionRate: 0,
        variantImpressions: 0,
        variantSessions: 0,
        variantConversionRate: 0,
        conversionLift: 0,
        absoluteLift: 0,
        zScore: 0,
        pValue: 1,
        confidence: 0,
        isSignificant: false,
        confidenceInterval: { lower: 0, upper: 0, liftLower: 0, liftUpper: 0 },
        minimumSampleSizeMet: false,
        autoStopped: false,
        winner: null,
        recommendedAction: 'Experiment initialized. Waiting for traffic and booking conversions.',
      };

      const formattedVariants = variantPrices.map(v => ({
        label: v.label,
        price: v.price,
        impressions: v.impressions ?? 0,
        sessionsBooked: 0,
        revenue: 0,
        conversionRate: 0,
      }));

      const { rows } = await pool.query(
        `INSERT INTO pricing_experiments (mentor_id, name, description, control_price, variant_prices, metrics, start_at, end_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          mentorId,
          name,
          description || null,
          controlPrice,
          JSON.stringify(formattedVariants),
          JSON.stringify(initialMetrics),
          startAt || null,
          endAt || null,
        ],
      );

      logger.info("Pricing experiment created with statistical engine", { mentorId, name, experimentId: rows[0].id });
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
        metrics: rows[0].metrics || initialMetrics,
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
        `UPDATE pricing_experiments
         SET status = $1, updated_at = NOW(),
             end_at = CASE WHEN $1 = 'completed' AND end_at IS NULL THEN NOW() ELSE end_at END
         WHERE id = $2 AND mentor_id = $3
         RETURNING *`,
        [status, experimentId, mentorId],
      );
      if (rows.length === 0) return null;
      logger.info("Pricing experiment status updated", { experimentId, mentorId, status });
      return this.evaluateExperiment(experimentId, mentorId);
    } catch (error) {
      logger.error("Failed to update pricing experiment status", { experimentId, status, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getDashboardStats(userId: string): Promise<any> {
    try {
      const [experimentsRes, benchmarksRes, recommendationsRes, activeExperimentsRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::INTEGER as total, COUNT(*) FILTER (WHERE status = 'running')::INTEGER as active,
                  COUNT(*) FILTER (WHERE status = 'completed')::INTEGER as completed
           FROM pricing_experiments WHERE mentor_id = $1`,
          [userId],
        ),
        pool.query(`SELECT category, COUNT(*)::INTEGER as count FROM pricing_benchmarks GROUP BY category ORDER BY count DESC`),
        pool.query(`SELECT * FROM pricing_recommendations WHERE mentor_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]),
        pool.query(`SELECT * FROM pricing_experiments WHERE mentor_id = $1 AND status = 'running' ORDER BY created_at DESC LIMIT 5`, [userId]),
      ]);

      const latestRec = recommendationsRes.rows[0];
      const activeSignificanceSummaries = activeExperimentsRes.rows.map(r => {
        const variants = r.variant_prices || [];
        const primary = variants[0];
        const m = r.metrics || {};
        const controlSessions = m.controlSessions ?? 0;
        const controlImpressions = m.controlImpressions ?? Math.max(controlSessions, 30);
        const variantSessions = primary?.sessionsBooked ?? m.variantSessions ?? 0;
        const variantImpressions = primary?.impressions ?? Math.max(variantSessions, 30);

        const stats = calculateTwoProportionZTest(controlSessions, controlImpressions, variantSessions, variantImpressions, 0.95, 30);
        return {
          experimentId: r.id,
          name: r.name,
          confidence: stats.confidence,
          conversionLift: stats.conversionLift,
          isSignificant: stats.isSignificant,
          winner: stats.winner,
          recommendedAction: stats.recommendedAction,
        };
      });

      return {
        experiments: {
          ...(experimentsRes.rows[0] || { total: 0, active: 0, completed: 0 }),
          activeSignificance: activeSignificanceSummaries,
        },
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
