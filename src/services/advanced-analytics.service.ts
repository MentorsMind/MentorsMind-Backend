import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { AnalyticsService } from "./analytics.service";

// Enhanced interfaces for advanced analytics
export interface AnalyticsDashboard {
  userId: string;
  metrics: {
    revenue: RevenueMetrics;
    sessions: SessionMetrics;
    students: StudentMetrics;
    growth: GrowthMetrics;
  };
  predictions: {
    nextMonthRevenue: number;
    demandForecast: DemandForecast[];
  };
  insights: Insight[];
  lastUpdated: string;
}

export interface RevenueMetrics {
  totalAmount: number;
  platformFee: number;
  transactionCount: number;
  avgTransactionValue: number;
  growthRate: number;
  currencyBreakdown: CurrencyBreakdown[];
}

export interface SessionMetrics {
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  avgDuration: number;
  cancelledSessions: number;
  upcomingSessions: number;
}

export interface StudentMetrics {
  totalStudents: number;
  activeStudents: number;
  newStudents: number;
  retentionRate: number;
  avgSessionsPerStudent: number;
}

export interface GrowthMetrics {
  userGrowthRate: number;
  revenueGrowthRate: number;
  sessionGrowthRate: number;
  mentorGrowthRate: number;
}

export interface DemandForecast {
  date: string;
  timeSlot: string;
  predictedDemand: number;
  availableCapacity: number;
  utilizationRate: number;
}

export interface Insight {
  id: string;
  type: "trend" | "anomaly" | "recommendation";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metricName?: string;
  metricValue?: number;
  createdAt: string;
  isRead: boolean;
  targetAudience?: "admin" | "mentor" | "learner" | "all";
  userId?: string | null;
  entityId?: string | null;
}

export interface CurrencyBreakdown {
  currency: string;
  amount: number;
  percentage: number;
  transactionCount: number;
}

// â”€â”€â”€ Real-Time & Custom Reporting Interfaces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface EngagementMetrics {
  activeUsers: number;
  activeSessions: number;
  sessionsStartingSoon: number;
  recentMessages: number;
  recentReviews: number;
  averageRating: number;
  windowMinutes: number;
  computedAt: string;
}

export interface RevenueStream {
  totalAmount: number;
  transactionCount: number;
  completedCount: number;
  pendingCount: number;
  averageAmount: number;
  platformFees: number;
  windowMinutes: number;
  computedAt: string;
}

export interface CustomReportConfig {
  userId: string;
  metrics: string[];
  dateRange: { start: string; end: string };
  filters?: Record<string, unknown>;
  groupBy?: "day" | "week" | "month";
}

export interface CustomReportResult {
  reportId: string;
  userId: string;
  config: CustomReportConfig;
  data: Record<string, unknown>[];
  summary: ReportSummary;
  generatedAt: string;
}

export interface ReportSummary {
  totalMetrics: number;
  totalDataPoints: number;
  generatedAt: string;
}

export interface ComparativeAnalytics {
  metricType: string;
  currentPeriod: { period: string; total: number; dataPoints: number };
  previousPeriod: { period: string; total: number; dataPoints: number };
  changePercentage: number;
  trend: "up" | "down" | "stable";
  generatedAt: string;
}

export interface EngagementFunnel {
  signups: number;
  bookedSession: number;
  completedSession: number;
  highSatisfaction: number;
  returnedAfter30Days: number;
  conversionRates: {
    signupToBooking: number;
    bookingToCompletion: number;
    completionToSatisfaction: number;
    retention30Days: number;
  };
  dateRange: { start: string; end: string };
}

export class AdvancedAnalyticsError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "AdvancedAnalyticsError";
  }
}

export class InsufficientDataError extends AdvancedAnalyticsError {
  constructor(message: string = "Insufficient data for analysis") {
    super(message, "INSUFFICIENT_DATA");
  }
}

const CACHE_TTL = 300; // 5 minutes
const DASHBOARD_CACHE_TTL = 180; // 3 minutes for dashboard
const _QUERY_TIMEOUT = 30000; // 30 seconds

export const AdvancedAnalyticsService = {
  /**
   * Get comprehensive dashboard data
   * Orchestrates calls to multiple services and caches result
   */
  async getDashboard(
    userId: string,
    period: string = "30d",
  ): Promise<AnalyticsDashboard> {
    const cacheKey = `analytics:dashboard:${userId}:${period}`;

    return CacheService.wrap(cacheKey, DASHBOARD_CACHE_TTL, async () => {
      try {
        // Ensure views are available
        await AnalyticsService.ensureViewsAvailable();

        const [metrics, predictions, insights] = await Promise.all([
          this.getMetrics(userId, period),
          this.getPredictions(userId),
          this.getInsights(userId, false),
        ]);

        const dashboard: AnalyticsDashboard = {
          userId,
          metrics,
          predictions,
          insights,
          lastUpdated: new Date().toISOString(),
        };

        logger.debug("Dashboard data compiled", {
          userId,
          period,
          metricsCount: Object.keys(metrics).length,
          insightsCount: insights.length,
        });

        return dashboard;
      } catch (error) {
        logger.error("Failed to get dashboard data", { error, userId, period });
        throw error;
      }
    });
  },
  /**
   * Get real-time metrics (bypasses cache)
   */
  async getRealTimeMetrics(
    userId: string,
    period: string = "30d",
  ): Promise<AnalyticsDashboard["metrics"]> {
    try {
      await AnalyticsService.ensureViewsAvailable();
      return await this.getMetrics(userId, period);
    } catch (error) {
      logger.error("Failed to get real-time metrics", { error, userId });
      throw error;
    }
  },

  /**
   * Get comprehensive metrics
   */
  async getMetrics(
    userId: string,
    period: string,
  ): Promise<AnalyticsDashboard["metrics"]> {
    const days = AnalyticsService.parsePeriod(period);

    const [revenue, sessions, students, growth] = await Promise.all([
      this.getRevenueMetrics(days),
      this.getSessionMetrics(days),
      this.getStudentMetrics(days),
      this.getGrowthMetrics(days),
    ]);

    return { revenue, sessions, students, growth };
  },

  /**
   * Get revenue metrics with growth calculation
   */
  async getRevenueMetrics(days: number): Promise<RevenueMetrics> {
    const query = `
      WITH current_period AS (
        SELECT 
          SUM(total_amount) as total_amount,
          SUM(total_platform_fee) as total_platform_fee,
          SUM(transaction_count) as transaction_count,
          AVG(avg_amount) as avg_amount
        FROM mv_daily_revenue
        WHERE date >= CURRENT_DATE - $1::integer
      ),
      previous_period AS (
        SELECT 
          SUM(total_amount) as total_amount
        FROM mv_daily_revenue
        WHERE date >= CURRENT_DATE - ($1::integer * 2)
          AND date < CURRENT_DATE - $1::integer
      ),
      currency_breakdown AS (
        SELECT 
          currency,
          SUM(total_amount) as amount,
          SUM(transaction_count) as transaction_count
        FROM mv_daily_revenue
        WHERE date >= CURRENT_DATE - $1::integer
        GROUP BY currency
      )
      SELECT 
        cp.total_amount,
        cp.total_platform_fee,
        cp.transaction_count,
        cp.avg_amount,
        CASE 
          WHEN pp.total_amount > 0 THEN 
            ((cp.total_amount - pp.total_amount) / pp.total_amount * 100)
          ELSE 0 
        END as growth_rate,
        json_agg(
          json_build_object(
            'currency', cb.currency,
            'amount', cb.amount,
            'transactionCount', cb.transaction_count,
            'percentage', ROUND(cb.amount / NULLIF(cp.total_amount, 0) * 100, 2)
          )
        ) as currency_breakdown
      FROM current_period cp
      CROSS JOIN previous_period pp
      CROSS JOIN currency_breakdown cb
      GROUP BY cp.total_amount, cp.total_platform_fee, cp.transaction_count, cp.avg_amount, pp.total_amount
    `;

    const { rows } = await pool.query(query, [days]);
    const row = rows[0] || {};

    return {
      totalAmount: parseFloat(row.total_amount || "0"),
      platformFee: parseFloat(row.total_platform_fee || "0"),
      transactionCount: parseInt(row.transaction_count || "0"),
      avgTransactionValue: parseFloat(row.avg_amount || "0"),
      growthRate: parseFloat(row.growth_rate || "0"),
      currencyBreakdown: row.currency_breakdown || [],
    };
  },
  /**
   * Get session metrics
   */
  async getSessionMetrics(days: number): Promise<SessionMetrics> {
    const query = `
      WITH session_stats AS (
        SELECT 
          SUM(session_count) FILTER (WHERE status = 'completed') as completed_sessions,
          SUM(session_count) FILTER (WHERE status = 'cancelled') as cancelled_sessions,
          SUM(session_count) as total_sessions,
          AVG(avg_duration_minutes) FILTER (WHERE status = 'completed') as avg_duration
        FROM mv_session_stats
        WHERE date >= CURRENT_DATE - $1::integer
      ),
      upcoming_sessions AS (
        SELECT COUNT(*) as upcoming_count
        FROM bookings
        WHERE status = 'confirmed' 
          AND scheduled_at > CURRENT_TIMESTAMP
          AND scheduled_at <= CURRENT_TIMESTAMP + INTERVAL '7 days'
      )
      SELECT 
        ss.completed_sessions,
        ss.cancelled_sessions,
        ss.total_sessions,
        ss.avg_duration,
        us.upcoming_count,
        CASE 
          WHEN ss.total_sessions > 0 THEN 
            ROUND((ss.completed_sessions::numeric / ss.total_sessions * 100), 2)
          ELSE 0 
        END as completion_rate
      FROM session_stats ss
      CROSS JOIN upcoming_sessions us
    `;

    const { rows } = await pool.query(query, [days]);
    const row = rows[0] || {};

    return {
      totalSessions: parseInt(row.total_sessions || "0"),
      completedSessions: parseInt(row.completed_sessions || "0"),
      completionRate: parseFloat(row.completion_rate || "0"),
      avgDuration: parseFloat(row.avg_duration || "0"),
      cancelledSessions: parseInt(row.cancelled_sessions || "0"),
      upcomingSessions: parseInt(row.upcoming_count || "0"),
    };
  },

  /**
   * Get student metrics
   */
  async getStudentMetrics(days: number): Promise<StudentMetrics> {
    const query = `
      WITH student_stats AS (
        SELECT 
          SUM(new_users) FILTER (WHERE role = 'learner') as new_students,
          COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'learner') as total_students
        FROM mv_daily_users du
        LEFT JOIN users u ON u.role = 'learner' AND u.deleted_at IS NULL
        WHERE du.date >= CURRENT_DATE - $1::integer
      ),
      active_students AS (
        SELECT COUNT(DISTINCT learner_id) as active_count
        FROM bookings
        WHERE scheduled_at >= CURRENT_DATE - $1::integer
          AND status IN ('completed', 'confirmed')
      ),
      retention_stats AS (
        SELECT 
          COUNT(DISTINCT b1.learner_id) as returning_students
        FROM bookings b1
        WHERE b1.scheduled_at >= CURRENT_DATE - $1::integer
          AND EXISTS (
            SELECT 1 FROM bookings b2 
            WHERE b2.learner_id = b1.learner_id 
              AND b2.scheduled_at < b1.scheduled_at
              AND b2.status = 'completed'
          )
      ),
      session_avg AS (
        SELECT 
          AVG(session_count) as avg_sessions_per_student
        FROM (
          SELECT learner_id, COUNT(*) as session_count
          FROM bookings
          WHERE scheduled_at >= CURRENT_DATE - $1::integer
            AND status = 'completed'
          GROUP BY learner_id
        ) student_sessions
      )
      SELECT 
        ss.new_students,
        ss.total_students,
        acs.active_count,
        rs.returning_students,
        sa.avg_sessions_per_student,
        CASE 
          WHEN ss.total_students > 0 THEN 
            ROUND((rs.returning_students::numeric / ss.total_students * 100), 2)
          ELSE 0 
        END as retention_rate
      FROM student_stats ss
      CROSS JOIN active_students acs
      CROSS JOIN retention_stats rs
      CROSS JOIN session_avg sa
    `;

    const { rows } = await pool.query(query, [days]);
    const row = rows[0] || {};

    return {
      totalStudents: parseInt(row.total_students || "0"),
      activeStudents: parseInt(row.active_count || "0"),
      newStudents: parseInt(row.new_students || "0"),
      retentionRate: parseFloat(row.retention_rate || "0"),
      avgSessionsPerStudent: parseFloat(row.avg_sessions_per_student || "0"),
    };
  },
  /**
   * Get growth metrics
   */
  async getGrowthMetrics(days: number): Promise<GrowthMetrics> {
    const query = `
      WITH current_period AS (
        SELECT 
          COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'learner') as current_users,
          COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'mentor') as current_mentors,
          SUM(r.total_amount) as current_revenue,
          COUNT(DISTINCT b.id) as current_sessions
        FROM users u
        LEFT JOIN mv_daily_revenue r ON r.date >= CURRENT_DATE - $1::integer
        LEFT JOIN bookings b ON b.scheduled_at >= CURRENT_DATE - $1::integer
        WHERE u.created_at >= CURRENT_DATE - $1::integer
          AND u.deleted_at IS NULL
      ),
      previous_period AS (
        SELECT 
          COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'learner') as prev_users,
          COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'mentor') as prev_mentors,
          SUM(r.total_amount) as prev_revenue,
          COUNT(DISTINCT b.id) as prev_sessions
        FROM users u
        LEFT JOIN mv_daily_revenue r ON r.date >= CURRENT_DATE - ($1::integer * 2) 
          AND r.date < CURRENT_DATE - $1::integer
        LEFT JOIN bookings b ON b.scheduled_at >= CURRENT_DATE - ($1::integer * 2)
          AND b.scheduled_at < CURRENT_DATE - $1::integer
        WHERE u.created_at >= CURRENT_DATE - ($1::integer * 2)
          AND u.created_at < CURRENT_DATE - $1::integer
          AND u.deleted_at IS NULL
      )
      SELECT 
        CASE 
          WHEN pp.prev_users > 0 THEN 
            ROUND(((cp.current_users - pp.prev_users)::numeric / pp.prev_users * 100), 2)
          ELSE 0 
        END as user_growth_rate,
        CASE 
          WHEN pp.prev_mentors > 0 THEN 
            ROUND(((cp.current_mentors - pp.prev_mentors)::numeric / pp.prev_mentors * 100), 2)
          ELSE 0 
        END as mentor_growth_rate,
        CASE 
          WHEN pp.prev_revenue > 0 THEN 
            ROUND(((cp.current_revenue - pp.prev_revenue) / pp.prev_revenue * 100), 2)
          ELSE 0 
        END as revenue_growth_rate,
        CASE 
          WHEN pp.prev_sessions > 0 THEN 
            ROUND(((cp.current_sessions - pp.prev_sessions)::numeric / pp.prev_sessions * 100), 2)
          ELSE 0 
        END as session_growth_rate
      FROM current_period cp
      CROSS JOIN previous_period pp
    `;

    const { rows } = await pool.query(query, [days]);
    const row = rows[0] || {};

    return {
      userGrowthRate: parseFloat(row.user_growth_rate || "0"),
      revenueGrowthRate: parseFloat(row.revenue_growth_rate || "0"),
      sessionGrowthRate: parseFloat(row.session_growth_rate || "0"),
      mentorGrowthRate: parseFloat(row.mentor_growth_rate || "0"),
    };
  },

  /**
   * Get predictions
   */
  async getPredictions(
    _userId: string,
  ): Promise<AnalyticsDashboard["predictions"]> {
    try {
      const { PredictiveEngineService } =
        await import("./predictive-engine.service");

      // Get revenue forecast for next month
      const revenueForecasts = await PredictiveEngineService.forecastRevenue(1);
      const nextMonthRevenue =
        revenueForecasts.length > 0 ? revenueForecasts[0].predictedRevenue : 0;

      // Get demand forecast for next 7 days
      const demandForecast = await PredictiveEngineService.forecastDemand(7);

      return {
        nextMonthRevenue,
        demandForecast,
      };
    } catch (error) {
      logger.warn("Failed to get predictions, returning empty", { error });
      return {
        nextMonthRevenue: 0,
        demandForecast: [],
      };
    }
  },

  /**
   * Get insights
   */
  async getInsights(
    userId: string,
    unreadOnly: boolean = false,
  ): Promise<Insight[]> {
    try {
      const { InsightGeneratorService } =
        await import("./insight-generator.service");
      return await InsightGeneratorService.getInsights(userId, unreadOnly);
    } catch (error) {
      logger.warn("Failed to get insights, returning empty", { error });
      return [];
    }
  },

  /**
   * Refresh all analytics data
   * Triggers materialized view refresh and cache invalidation
   */
  async refreshAnalytics(): Promise<void> {
    try {
      await pool.query("SELECT refresh_advanced_analytics_views()");
      await CacheService.invalidate("analytics:*");
      logger.info("Advanced analytics refreshed successfully");
    } catch (error) {
      logger.error("Failed to refresh advanced analytics", { error });
      throw error;
    }
  },

  /**
   * Get metrics for specific time range
   */
  async getMetricsByDateRange(
    metricType: string,
    startDate: Date,
    endDate: Date,
    _filters?: Record<string, any>,
  ): Promise<any[]> {
    const cacheKey = `analytics:metrics:${metricType}:${startDate.toISOString()}:${endDate.toISOString()}`;

    return CacheService.wrap(cacheKey, CACHE_TTL, async () => {
      try {
        let query = "";
        const params: any[] = [startDate, endDate];

        switch (metricType) {
          case "revenue":
            query = `
              SELECT date, currency, total_amount, transaction_count
              FROM mv_daily_revenue
              WHERE date >= $1 AND date <= $2
              ORDER BY date DESC
            `;
            break;
          case "sessions":
            query = `
              SELECT date, status, session_count, avg_duration_minutes
              FROM mv_session_stats
              WHERE date >= $1 AND date <= $2
              ORDER BY date DESC
            `;
            break;
          case "users":
            query = `
              SELECT date, role, new_users, verified_users
              FROM mv_daily_users
              WHERE date >= $1 AND date <= $2
              ORDER BY date DESC
            `;
            break;
          default:
            throw new AdvancedAnalyticsError(
              `Unknown metric type: ${metricType}`,
              "INVALID_METRIC_TYPE",
            );
        }

        const { rows } = await pool.query(query, params);
        return rows;
      } catch (error) {
        logger.error("Failed to get metrics by date range", {
          error,
          metricType,
          startDate,
          endDate,
        });
        throw error;
      }
    });
  },

  /**
   * Initialize advanced analytics service
   */
  async initialize(): Promise<void> {
    logger.info("Initializing AdvancedAnalyticsService...");
    try {
      await AnalyticsService.initialize();
      logger.info("AdvancedAnalyticsService initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize AdvancedAnalyticsService", { error });
      throw error;
    }
  },

  /**
   * Parse a period string (e.g. "30d", "7d") into number of days.
   * Forwards to AnalyticsService.parsePeriod.
   */
  parsePeriod(period: string): number {
    return AnalyticsService.parsePeriod(period);
  },

  // â”€â”€â”€ Real-Time Metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Get real-time engagement metrics (bypasses cache).
   */
  async getEngagementMetrics(
    userId: string,
    windowMinutes: number = 15,
  ): Promise<EngagementMetrics> {
    const cacheKey = `analytics:engagement:${userId}:w${windowMinutes}`;

    try {
      const cached = await CacheService.get<EngagementMetrics>(cacheKey);
      if (cached) return cached;
    } catch {
      // Continue without cache
    }

    const query = `
      WITH active_users AS (
        SELECT COUNT(DISTINCT user_id) as active_count
        FROM user_sessions
        WHERE last_active_at >= NOW() - INTERVAL '1 minute' * $1
      ),
      active_bookings AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
          COUNT(*) FILTER (WHERE status = 'confirmed' AND scheduled_at <= NOW() + INTERVAL '15 minutes') as starting_soon
        FROM bookings
        WHERE scheduled_at >= NOW() - INTERVAL '1 hour'
      ),
      recent_messages AS (
        SELECT COUNT(*) as message_count
        FROM messages
        WHERE created_at >= NOW() - INTERVAL '1 minute' * $1
      ),
      recent_reviews AS (
        SELECT
          COUNT(*) as review_count,
          COALESCE(AVG(rating), 0) as avg_rating
        FROM session_feedback
        WHERE created_at >= NOW() - INTERVAL '1 minute' * $1
      )
      SELECT
        au.active_count as active_users,
        ab.in_progress as active_sessions,
        ab.starting_soon as sessions_starting_soon,
        rm.message_count,
        rr.review_count,
        rr.avg_rating
      FROM active_users au
      CROSS JOIN active_bookings ab
      CROSS JOIN recent_messages rm
      CROSS JOIN recent_reviews rr
    `;

    const { rows } = await pool.query(query, [windowMinutes]);
    const row = rows[0] || {};

    const metrics: EngagementMetrics = {
      activeUsers: parseInt(row.active_users || "0"),
      activeSessions: parseInt(row.active_sessions || "0"),
      sessionsStartingSoon: parseInt(row.sessions_starting_soon || "0"),
      recentMessages: parseInt(row.message_count || "0"),
      recentReviews: parseInt(row.review_count || "0"),
      averageRating: parseFloat(row.avg_rating || "0"),
      windowMinutes,
      computedAt: new Date().toISOString(),
    };

    try {
      await CacheService.set(cacheKey, metrics, 60); // 1 minute cache
    } catch {
      // Non-critical
    }

    return metrics;
  },

  /**
   * Get real-time revenue stream (bypasses cache).
   */
  async getRealTimeRevenueStream(
    windowMinutes: number = 15,
  ): Promise<RevenueStream> {
    const query = `
      SELECT
        SUM(amount::numeric) as total_amount,
        COUNT(*) as transaction_count,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        AVG(amount::numeric) FILTER (WHERE status = 'completed') as avg_amount,
        SUM(platform_fee::numeric) as platform_fees
      FROM payments
      WHERE created_at >= NOW() - INTERVAL '1 minute' * $1
    `;

    const { rows } = await pool.query(query, [windowMinutes]);
    const row = rows[0] || {};

    return {
      totalAmount: parseFloat(row.total_amount || "0"),
      transactionCount: parseInt(row.transaction_count || "0"),
      completedCount: parseInt(row.completed_count || "0"),
      pendingCount: parseInt(row.pending_count || "0"),
      averageAmount: parseFloat(row.avg_amount || "0"),
      platformFees: parseFloat(row.platform_fees || "0"),
      windowMinutes,
      computedAt: new Date().toISOString(),
    };
  },

  // â”€â”€â”€ Custom Reporting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Generate a custom analytics report.
   */
  async generateCustomReport(
    config: CustomReportConfig,
  ): Promise<CustomReportResult> {
    const { userId, metrics, dateRange, filters, groupBy } = config;

    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);

    const reportData: Record<string, unknown>[] = [];

    for (const metric of metrics) {
      const data = await this.getMetricsByDateRange(
        metric,
        startDate,
        endDate,
        filters,
      );
      reportData.push({ metric, data });
    }

    const summary = this.generateReportSummary(reportData);

    return {
      reportId: crypto.randomUUID(),
      userId,
      config,
      data: reportData,
      summary,
      generatedAt: new Date().toISOString(),
    };
  },

  /**
   * Export analytics data to CSV format.
   */
  async exportToCSV(
    metricType: string,
    startDate: Date,
    endDate: Date,
    filters?: Record<string, unknown>,
  ): Promise<string> {
    const data = await this.getMetricsByDateRange(
      metricType,
      startDate,
      endDate,
      filters,
    );

    if (data.length === 0) return "";

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(",")];

    for (const row of data) {
      const values = headers.map((h) => {
        const val = row[h];
        return typeof val === "string" && val.includes(",")
          ? `"${val}"`
          : String(val ?? "");
      });
      csvRows.push(values.join(","));
    }

    return csvRows.join("\n");
  },

  /**
   * Get comparative analytics between two time periods.
   */
  async getComparativeAnalytics(
    metricType: string,
    currentPeriod: string,
    previousPeriod: string,
  ): Promise<ComparativeAnalytics> {
    const currentDays = AnalyticsService.parsePeriod(currentPeriod);
    const previousDays = AnalyticsService.parsePeriod(previousPeriod);

    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - currentDays);
    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - previousDays);

    const [currentData, previousData] = await Promise.all([
      this.getMetricsByDateRange(metricType, currentStart, now),
      this.getMetricsByDateRange(metricType, previousStart, currentStart),
    ]);

    const currentTotal = currentData.reduce(
      (sum, d) => sum + (parseFloat(d.total_amount || "0") || 0),
      0,
    );
    const previousTotal = previousData.reduce(
      (sum, d) => sum + (parseFloat(d.total_amount || "0") || 0),
      0,
    );

    const changePercentage =
      previousTotal > 0
        ? ((currentTotal - previousTotal) / previousTotal) * 100
        : 0;

    return {
      metricType,
      currentPeriod: { period: currentPeriod, total: currentTotal, dataPoints: currentData.length },
      previousPeriod: { period: previousPeriod, total: previousTotal, dataPoints: previousData.length },
      changePercentage: Math.round(changePercentage * 100) / 100,
      trend: changePercentage > 0 ? "up" : changePercentage < 0 ? "down" : "stable",
      generatedAt: new Date().toISOString(),
    };
  },

  /**
   * Get user engagement funnel.
   */
  async getEngagementFunnel(
    startDate: Date,
    endDate: Date,
  ): Promise<EngagementFunnel> {
    const query = `
      WITH funnel AS (
        SELECT
          COUNT(DISTINCT CASE WHEN u.created_at BETWEEN $1 AND $2 THEN u.id END) as signups,
          COUNT(DISTINCT CASE WHEN b.id IS NOT NULL AND b.created_at BETWEEN $1 AND $2 THEN b.learner_id END) as booked_session,
          COUNT(DISTINCT CASE WHEN b.status = 'completed' AND b.completed_at BETWEEN $1 AND $2 THEN b.learner_id END) as completed_session,
          COUNT(DISTINCT CASE WHEN sf.rating >= 4 AND sf.created_at BETWEEN $1 AND $2 THEN sf.user_id END) as high_satisfaction,
          COUNT(DISTINCT CASE WHEN b2.id IS NOT NULL AND b2.created_at BETWEEN $2 AND $2 + INTERVAL '30 days' THEN b2.learner_id END) as returned_after_30d
        FROM users u
        LEFT JOIN bookings b ON b.learner_id = u.id
        LEFT JOIN session_feedback sf ON sf.booking_id = b.id
        LEFT JOIN bookings b2 ON b2.learner_id = u.id
        WHERE u.created_at BETWEEN $1 AND $2
          AND u.deleted_at IS NULL
      )
      SELECT * FROM funnel
    `;

    const { rows } = await pool.query(query, [startDate, endDate]);
    const row = rows[0] || {};

    const signups = parseInt(row.signups || "0");
    const booked = parseInt(row.booked_session || "0");
    const completed = parseInt(row.completed_session || "0");
    const satisfied = parseInt(row.high_satisfaction || "0");
    const returned = parseInt(row.returned_after_30d || "0");

    return {
      signups,
      bookedSession: booked,
      completedSession: completed,
      highSatisfaction: satisfied,
      returnedAfter30Days: returned,
      conversionRates: {
        signupToBooking: signups > 0 ? (booked / signups) * 100 : 0,
        bookingToCompletion: booked > 0 ? (completed / booked) * 100 : 0,
        completionToSatisfaction: completed > 0 ? (satisfied / completed) * 100 : 0,
        retention30Days: signups > 0 ? (returned / signups) * 100 : 0,
      },
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
    };
  },

  // â”€â”€â”€ Private helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  generateReportSummary(
    reportData: Record<string, unknown>[],
  ): ReportSummary {
    const totalDataPoints = reportData.reduce(
      (sum, d) => sum + ((d.data as unknown[])?.length || 0),
      0,
    );

    return {
      totalMetrics: reportData.length,
      totalDataPoints,
      generatedAt: new Date().toISOString(),
    };
  },
};

