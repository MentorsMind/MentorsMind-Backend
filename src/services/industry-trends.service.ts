import { Pool } from "pg";
import { Logger } from "../utils/logger.utils";

export interface IndustryTrend {
  skill: string;
  demand: number;
  growth: number;
  avgSalary: number;
  jobPostings: number;
  trending: boolean;
}

export interface SkillForecast {
  skill: string;
  currentDemand: number;
  forecastedDemand: number;
  growthRate: number;
  timeframe: string;
}

export interface CareerPath {
  role: string;
  requiredSkills: string[];
  avgSalary: number;
  demand: number;
  growthProjection: number;
}

export class IndustryTrendsService {
  constructor(private pool: Pool) {}

  async getTrendingSkills(
    industry: string,
    limit: number = 10,
  ): Promise<IndustryTrend[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          skill_name as skill,
          demand_score as demand,
          growth_rate as growth,
          avg_salary,
          job_postings,
          trending
         FROM industry_trends
         WHERE industry = $1 AND trending = true
         ORDER BY demand_score DESC, growth_rate DESC
         LIMIT $2`,
        [industry, limit],
      );

      logger.info(
        { industry, trendsFound: result.rows.length },
        "Retrieved trending skills",
      );

      return result.rows;
    } catch (error) {
      logger.error({ error, industry }, "Failed to get trending skills");
      throw error;
    } finally {
      client.release();
    }
  }

  async analyzeSkillDemand(skill: string): Promise<{
    currentDemand: number;
    trend: "rising" | "stable" | "declining";
    marketSaturation: number;
    recommendations: string[];
  }> {
    const client = await this.pool.connect();
    try {
      const demandResult = await client.query(
        `SELECT demand_score, growth_rate, market_saturation
         FROM skill_demand_analysis
         WHERE skill_name = $1
         ORDER BY analysis_date DESC
         LIMIT 1`,
        [skill],
      );

      if (demandResult.rows.length === 0) {
        return {
          currentDemand: 0,
          trend: "stable",
          marketSaturation: 0,
          recommendations: ["No data available for this skill"],
        };
      }

      const data = demandResult.rows[0];
      const trend =
        data.growth_rate > 5
          ? "rising"
          : data.growth_rate < -5
            ? "declining"
            : "stable";

      const recommendations = this.generateDemandRecommendations(
        trend,
        data.market_saturation,
      );

      logger.info(
        { skill, trend, demand: data.demand_score },
        "Analyzed skill demand",
      );

      return {
        currentDemand: data.demand_score,
        trend,
        marketSaturation: data.market_saturation,
        recommendations,
      };
    } catch (error) {
      logger.error({ error, skill }, "Failed to analyze skill demand");
      throw error;
    } finally {
      client.release();
    }
  }

  async getForecast(
    skill: string,
    months: number = 12,
  ): Promise<SkillForecast> {
    const client = await this.pool.connect();
    try {
      // Get historical data for forecasting
      const historyResult = await client.query(
        `SELECT demand_score, analysis_date
         FROM skill_demand_analysis
         WHERE skill_name = $1
         AND analysis_date >= NOW() - INTERVAL '6 months'
         ORDER BY analysis_date ASC`,
        [skill],
      );

      if (historyResult.rows.length < 2) {
        throw new Error("Insufficient historical data for forecasting");
      }

      const forecast = this.calculateForecast(historyResult.rows, months);

      logger.info(
        { skill, months, forecast: forecast.forecastedDemand },
        "Generated skill forecast",
      );

      return {
        skill,
        currentDemand: forecast.current,
        forecastedDemand: forecast.forecasted,
        growthRate: forecast.growthRate,
        timeframe: `${months} months`,
      };
    } catch (error) {
      logger.error({ error, skill }, "Failed to generate forecast");
      throw error;
    } finally {
      client.release();
    }
  }

  async getEmergingSkills(industry: string): Promise<IndustryTrend[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          skill_name as skill,
          demand_score as demand,
          growth_rate as growth,
          avg_salary,
          job_postings,
          true as trending
         FROM industry_trends
         WHERE industry = $1
         AND growth_rate > 50
         AND demand_score < 70
         ORDER BY growth_rate DESC
         LIMIT 15`,
        [industry],
      );

      logger.info(
        { industry, emergingSkillsFound: result.rows.length },
        "Retrieved emerging skills",
      );

      return result.rows;
    } catch (error) {
      logger.error({ error, industry }, "Failed to get emerging skills");
      throw error;
    } finally {
      client.release();
    }
  }

  async getCareerPaths(
    currentRole: string,
    targetIndustry: string,
  ): Promise<CareerPath[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          cp.role_name as role,
          ARRAY_AGG(crs.skill_name) as required_skills,
          cp.avg_salary,
          cp.demand_score as demand,
          cp.growth_projection
         FROM career_paths cp
         JOIN career_required_skills crs ON cp.id = crs.career_path_id
         WHERE cp.industry = $1
         AND cp.role_level > (SELECT role_level FROM career_paths WHERE role_name = $2 LIMIT 1)
         GROUP BY cp.id, cp.role_name, cp.avg_salary, cp.demand_score, cp.growth_projection
         ORDER BY cp.growth_projection DESC
         LIMIT 10`,
        [targetIndustry, currentRole],
      );

      logger.info(
        { currentRole, targetIndustry, pathsFound: result.rows.length },
        "Retrieved career paths",
      );

      return result.rows;
    } catch (error) {
      logger.error(
        { error, currentRole, targetIndustry },
        "Failed to get career paths",
      );
      throw error;
    } finally {
      client.release();
    }
  }

  async syncMarketData(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Simulate fetching from external APIs (LinkedIn, Indeed, Glassdoor, etc.)
      const marketData = await this.fetchExternalMarketData();

      for (const data of marketData) {
        await client.query(
          `INSERT INTO industry_trends (
            industry, skill_name, demand_score, growth_rate, avg_salary, job_postings, trending, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (industry, skill_name) 
          DO UPDATE SET 
            demand_score = $3,
            growth_rate = $4,
            avg_salary = $5,
            job_postings = $6,
            trending = $7,
            updated_at = NOW()`,
          [
            data.industry,
            data.skill,
            data.demand,
            data.growth,
            data.salary,
            data.jobPostings,
            data.trending,
          ],
        );
      }

      await client.query("COMMIT");

      logger.info({ dataPoints: marketData.length }, "Synced market data");
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error({ error }, "Failed to sync market data");
      throw error;
    } finally {
      client.release();
    }
  }

  private calculateForecast(
    historicalData: any[],
    months: number,
  ): {
    current: number;
    forecasted: number;
    growthRate: number;
  } {
    const values = historicalData.map((d) => d.demand_score);
    const current = values[values.length - 1];

    // Simple linear regression for trend
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;
    const n = values.length;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const forecastPoint = n + months / 6; // Assuming monthly data points
    const forecasted = Math.max(0, slope * forecastPoint + intercept);
    const growthRate = ((forecasted - current) / current) * 100;

    return { current, forecasted, growthRate };
  }

  private generateDemandRecommendations(
    trend: string,
    saturation: number,
  ): string[] {
    const recommendations: string[] = [];

    if (trend === "rising") {
      recommendations.push(
        "High demand - Excellent time to develop this skill",
      );
      if (saturation < 0.5) {
        recommendations.push(
          "Low market saturation - Strong career opportunities",
        );
      }
    } else if (trend === "declining") {
      recommendations.push("Declining demand - Consider complementary skills");
      recommendations.push("Focus on specialization to stand out");
    } else {
      recommendations.push("Stable demand - Reliable skill to maintain");
    }

    if (saturation > 0.8) {
      recommendations.push("High competition - Consider niche specialization");
    }

    return recommendations;
  }

  private async fetchExternalMarketData(): Promise<any[]> {
    // Placeholder - would integrate with real APIs
    return [
      {
        industry: "Software Development",
        skill: "TypeScript",
        demand: 85,
        growth: 15,
        salary: 120000,
        jobPostings: 45000,
        trending: true,
      },
      {
        industry: "Software Development",
        skill: "Rust",
        demand: 45,
        growth: 75,
        salary: 140000,
        jobPostings: 8000,
        trending: true,
      },
    ];
  }
}
