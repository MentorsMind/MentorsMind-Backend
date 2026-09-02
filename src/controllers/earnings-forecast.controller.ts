/**
 * Earnings Forecast Controller
 *
 * Handles GET /earnings/forecast requests.
 * Generates a fresh forecast from historical transaction data,
 * persists it to mentor_forecasts, and returns the result alongside
 * a comparison to the previous stored forecast.
 */

import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { earningsForecastService } from "../services/earnings-forecast.service";
import { ResponseUtil } from "../utils/response.utils";
import { logger } from "../utils/logger.utils";

const VALID_PERIODS = ["monthly", "quarterly", "yearly"] as const;
type Period = (typeof VALID_PERIODS)[number];

export const EarningsForecastController = {
  /**
   * GET /api/v1/earnings/forecast?period=monthly
   *
   * Generates a new earnings forecast for the authenticated mentor, stores it,
   * and returns it together with a comparison to the previously stored forecast.
   *
   * Query params:
   *   period          - "monthly" | "quarterly" | "yearly"  (default: "monthly")
   *   historical_months - number of months of history to use (default: 12, max: 60)
   */
  async getForecast(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const mentorId = req.user!.id as string;

      // ── Validate period ──────────────────────────────────────────────────
      const rawPeriod = (req.query.period as string) || "monthly";
      if (!VALID_PERIODS.includes(rawPeriod as Period)) {
        ResponseUtil.error(
          res,
          `Invalid period. Must be one of: ${VALID_PERIODS.join(", ")}`,
          400,
        );
        return;
      }
      const period = rawPeriod as Period;

      // ── Validate historical_months ───────────────────────────────────────
      const rawMonths = req.query.historical_months as string | undefined;
      let historicalMonths = 12;
      if (rawMonths !== undefined) {
        const parsed = parseInt(rawMonths, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 60) {
          ResponseUtil.error(
            res,
            "historical_months must be an integer between 1 and 60",
            400,
          );
          return;
        }
        historicalMonths = parsed;
      }

      // ── Fetch previous forecast for comparison (before generating new one) ─
      const previousForecast = await earningsForecastService.getLatestForecast(
        mentorId,
        period,
      );

      // ── Generate fresh forecast + persist it ─────────────────────────────
      const { forecast, stored } =
        await earningsForecastService.generateAndStoreForecast(
          mentorId,
          period,
          historicalMonths,
        );

      // ── Build comparison delta ────────────────────────────────────────────
      let comparison: Record<string, unknown> | null = null;
      if (previousForecast) {
        const deltaRealistic =
          stored.scenario_realistic - previousForecast.scenario_realistic;
        const deltaPercent =
          previousForecast.scenario_realistic !== 0
            ? (deltaRealistic / previousForecast.scenario_realistic) * 100
            : null;

        comparison = {
          previous_forecast_id: previousForecast.id,
          previous_generated_at: previousForecast.generated_at,
          previous_scenario_realistic: previousForecast.scenario_realistic,
          delta_realistic: Math.round(deltaRealistic * 100) / 100,
          delta_percent:
            deltaPercent !== null
              ? Math.round(deltaPercent * 100) / 100
              : null,
        };
      }

      // ── Respond ───────────────────────────────────────────────────────────
      ResponseUtil.success(
        res,
        {
          forecast_id: stored.id,
          mentor_id: mentorId,
          period,
          generated_at: stored.generated_at,
          confidence: forecast.confidence,
          scenarios: forecast.scenarios,
          forecast_points: forecast.forecast,
          assumptions: forecast.assumptions,
          historical_months_used: stored.historical_months,
          comparison,
        },
        "Earnings forecast generated successfully",
      );

      logger.info("Earnings forecast generated and stored", {
        mentorId,
        period,
        forecastId: stored.id,
        realistic: stored.scenario_realistic,
      });
    } catch (error) {
      logger.error("Error generating earnings forecast", {
        error,
        userId: req.user?.id,
      });
      ResponseUtil.error(res, (error as Error).message, 500);
    }
  },
};
