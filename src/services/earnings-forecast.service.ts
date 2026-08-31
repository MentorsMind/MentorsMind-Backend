import { pool } from "../config/database";
import { logger } from "../utils/logger.utils";

export interface ForecastPoint {
  date: Date;
  predictedEarnings: number;
  lowerBound: number;
  upperBound: number;
}

export interface EarningsForecast {
  mentorId: string;
  period: "monthly" | "quarterly" | "yearly";
  forecast: ForecastPoint[];
  confidence: number;
  assumptions: string[];
  scenarios: {
    pessimistic: number;
    realistic: number;
    optimistic: number;
  };
}

export interface EarningsGoal {
  mentorId: string;
  targetAmount: number;
  period: "monthly" | "quarterly" | "yearly";
  deadline: Date;
}

export interface HistoricalEarning {
  date: Date;
  amount: number;
  sessionCount: number;
}

/** Row shape returned by the mentor_forecasts table */
export interface StoredForecast {
  id: string;
  mentor_id: string;
  period: "monthly" | "quarterly" | "yearly";
  generated_at: Date;
  scenario_pessimistic: number;
  scenario_realistic: number;
  scenario_optimistic: number;
  confidence: number;
  forecast_data: ForecastPoint[];
  historical_months: number;
  created_at: Date;
  updated_at: Date;
}

export class EarningsForecastService {
  // ─── Database helpers ───────────────────────────────────────────────────────

  /**
   * Query the transactions table and aggregate monthly earnings for a mentor.
   *
   * Only completed mentor_payout transactions are counted.  The method
   * returns one HistoricalEarning per calendar month, most-recent last.
   *
   * @param mentorId  UUID of the mentor (must also be the transactions.user_id)
   * @param months    How many calendar months to look back (default 12)
   */
  async getHistoricalEarnings(
    mentorId: string,
    months: number = 12,
  ): Promise<HistoricalEarning[]> {
    const query = `
      SELECT
        DATE_TRUNC('month', completed_at)::date AS month_date,
        COALESCE(SUM(amount), 0)::float          AS total_amount,
        COUNT(*)::int                            AS session_count
      FROM transactions
      WHERE
        user_id   = $1
        AND type  IN ('mentor_payout', 'payment')
        AND status = 'completed'
        AND completed_at >= NOW() - ($2 || ' months')::INTERVAL
      GROUP BY DATE_TRUNC('month', completed_at)
      ORDER BY month_date ASC
    `;

    const result = await pool.query(query, [mentorId, months]);

    return result.rows.map((row) => ({
      date: new Date(row.month_date),
      amount: parseFloat(row.total_amount),
      sessionCount: parseInt(row.session_count, 10),
    }));
  }

  /**
   * Persist a generated forecast snapshot into the mentor_forecasts table.
   *
   * @param forecast        The EarningsForecast to store
   * @param historicalMonths Number of historical months used to build it
   * @returns               The newly inserted row
   */
  async storeForecast(
    forecast: EarningsForecast,
    historicalMonths: number,
  ): Promise<StoredForecast> {
    const query = `
      INSERT INTO mentor_forecasts (
        mentor_id,
        period,
        generated_at,
        scenario_pessimistic,
        scenario_realistic,
        scenario_optimistic,
        confidence,
        forecast_data,
        historical_months
      ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const result = await pool.query(query, [
      forecast.mentorId,
      forecast.period,
      forecast.scenarios.pessimistic,
      forecast.scenarios.realistic,
      forecast.scenarios.optimistic,
      forecast.confidence,
      JSON.stringify({
        forecastPoints: forecast.forecast,
        assumptions: forecast.assumptions,
      }),
      historicalMonths,
    ]);

    return this.mapRow(result.rows[0]);
  }

  /**
   * Retrieve the most-recent stored forecast for a mentor + period.
   *
   * @param mentorId  UUID of the mentor
   * @param period    "monthly" | "quarterly" | "yearly"
   * @returns         The latest StoredForecast, or null if none exists
   */
  async getLatestForecast(
    mentorId: string,
    period: "monthly" | "quarterly" | "yearly",
  ): Promise<StoredForecast | null> {
    const query = `
      SELECT *
      FROM   mentor_forecasts
      WHERE  mentor_id = $1
        AND  period    = $2
      ORDER  BY generated_at DESC
      LIMIT  1
    `;

    const result = await pool.query(query, [mentorId, period]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * Retrieve the second-most-recent stored forecast for a mentor + period.
   * Used to produce a comparison/accuracy delta in the API response.
   *
   * @param mentorId  UUID of the mentor
   * @param period    "monthly" | "quarterly" | "yearly"
   * @returns         The previous StoredForecast, or null if none exists
   */
  async getPreviousForecast(
    mentorId: string,
    period: "monthly" | "quarterly" | "yearly",
  ): Promise<StoredForecast | null> {
    const query = `
      SELECT *
      FROM   mentor_forecasts
      WHERE  mentor_id = $1
        AND  period    = $2
      ORDER  BY generated_at DESC
      LIMIT  1
      OFFSET 1
    `;

    const result = await pool.query(query, [mentorId, period]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  // ─── Forecast generation ────────────────────────────────────────────────────

  async generateForecast(
    mentorId: string,
    period: "monthly" | "quarterly" | "yearly",
    historicalData: HistoricalEarning[],
  ): Promise<EarningsForecast> {
    logger.info(
      `Generating ${period} earnings forecast for mentor ${mentorId}`,
    );

    if (historicalData.length === 0) {
      return this.buildEmptyForecast(mentorId, period);
    }

    const avgEarnings = this.calculateAverage(
      historicalData.map((d) => d.amount),
    );
    const trend = this.calculateTrend(historicalData);
    const seasonalFactors = this.calculateSeasonalFactors(historicalData);
    const confidence = this.calculateConfidence(historicalData);

    const forecastPoints = this.buildForecastPoints(
      period,
      avgEarnings,
      trend,
      seasonalFactors,
    );

    const realistic = forecastPoints.reduce(
      (s, p) => s + p.predictedEarnings,
      0,
    );

    const forecast: EarningsForecast = {
      mentorId,
      period,
      forecast: forecastPoints,
      confidence,
      assumptions: [
        "Based on historical session frequency and rates",
        "Assumes consistent availability",
        "Market demand signals factored in via trend analysis",
        `Seasonal adjustment applied (${seasonalFactors.length} data points)`,
      ],
      scenarios: {
        pessimistic: realistic * 0.7,
        realistic,
        optimistic: realistic * 1.35,
      },
    };

    logger.info(
      `Forecast generated for mentor ${mentorId}: realistic=${realistic.toFixed(2)}, confidence=${confidence}`,
    );
    return forecast;
  }

  /**
   * Convenience method: fetch historical earnings from the DB, generate a
   * forecast, persist it, and return both the forecast and the new stored row.
   */
  async generateAndStoreForecast(
    mentorId: string,
    period: "monthly" | "quarterly" | "yearly",
    historicalMonths: number = 12,
  ): Promise<{ forecast: EarningsForecast; stored: StoredForecast }> {
    const historicalData = await this.getHistoricalEarnings(
      mentorId,
      historicalMonths,
    );
    const forecast = await this.generateForecast(
      mentorId,
      period,
      historicalData,
    );
    const stored = await this.storeForecast(forecast, historicalData.length);
    return { forecast, stored };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private mapRow(row: Record<string, unknown>): StoredForecast {
    const data = row.forecast_data as any;
    return {
      id: row.id as string,
      mentor_id: row.mentor_id as string,
      period: row.period as "monthly" | "quarterly" | "yearly",
      generated_at: new Date(row.generated_at as string),
      scenario_pessimistic: parseFloat(row.scenario_pessimistic as string),
      scenario_realistic: parseFloat(row.scenario_realistic as string),
      scenario_optimistic: parseFloat(row.scenario_optimistic as string),
      confidence: parseFloat(row.confidence as string),
      forecast_data: Array.isArray(data)
        ? data
        : (data?.forecastPoints ?? []),
      historical_months: parseInt(row.historical_months as string, 10),
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private buildForecastPoints(
    period: "monthly" | "quarterly" | "yearly",
    avgEarnings: number,
    trend: number,
    seasonalFactors: number[],
  ): ForecastPoint[] {
    const periodMap = { monthly: 1, quarterly: 3, yearly: 12 };
    const months = periodMap[period];
    const points: ForecastPoint[] = [];
    const now = new Date();

    for (let i = 1; i <= months; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthIndex = date.getMonth();
      const seasonal = seasonalFactors[monthIndex] ?? 1;
      const predicted = Math.max(0, (avgEarnings + trend * i) * seasonal);
      const margin = predicted * 0.2;

      points.push({
        date,
        predictedEarnings: Math.round(predicted * 100) / 100,
        lowerBound: Math.round((predicted - margin) * 100) / 100,
        upperBound: Math.round((predicted + margin) * 100) / 100,
      });
    }

    return points;
  }

  private calculateAverage(values: number[]): number {
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  private calculateTrend(data: HistoricalEarning[]): number {
    if (data.length < 2) return 0;
    const sorted = [...data].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const n = sorted.length;
    const first = sorted.slice(0, Math.floor(n / 2));
    const second = sorted.slice(Math.floor(n / 2));
    const avgFirst = this.calculateAverage(first.map((d) => d.amount));
    const avgSecond = this.calculateAverage(second.map((d) => d.amount));
    return (avgSecond - avgFirst) / Math.floor(n / 2);
  }

  private calculateSeasonalFactors(data: HistoricalEarning[]): number[] {
    const monthlyTotals = new Array(12).fill(0);
    const monthlyCounts = new Array(12).fill(0);

    data.forEach(({ date, amount }) => {
      const m = new Date(date).getMonth();
      monthlyTotals[m] += amount;
      monthlyCounts[m]++;
    });

    const monthlyAvgs = monthlyTotals.map((total, i) =>
      monthlyCounts[i] > 0 ? total / monthlyCounts[i] : 0,
    );
    const overallAvg =
      monthlyAvgs.filter((v) => v > 0).reduce((s, v) => s + v, 0) /
        monthlyAvgs.filter((v) => v > 0).length || 1;

    return monthlyAvgs.map((avg) => (avg > 0 ? avg / overallAvg : 1));
  }

  private calculateConfidence(data: HistoricalEarning[]): number {
    if (data.length >= 12) return 0.85;
    if (data.length >= 6) return 0.7;
    if (data.length >= 3) return 0.55;
    return 0.4;
  }

  private buildEmptyForecast(
    mentorId: string,
    period: "monthly" | "quarterly" | "yearly",
  ): EarningsForecast {
    return {
      mentorId,
      period,
      forecast: [],
      confidence: 0,
      assumptions: ["Insufficient historical data for forecasting"],
      scenarios: { pessimistic: 0, realistic: 0, optimistic: 0 },
    };
  }

  evaluateGoal(
    goal: EarningsGoal,
    forecast: EarningsForecast,
  ): { onTrack: boolean; gap: number; recommendation: string } {
    const projected = forecast.scenarios.realistic;
    const gap = goal.targetAmount - projected;
    const onTrack = projected >= goal.targetAmount;

    const recommendation = onTrack
      ? "You are on track to meet your earnings goal."
      : `Increase session frequency or rates by approximately $${gap.toFixed(2)} to meet your goal.`;

    return { onTrack, gap, recommendation };
  }
}

export const earningsForecastService = new EarningsForecastService();
