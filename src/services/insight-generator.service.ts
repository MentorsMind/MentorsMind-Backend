/**
 * InsightGeneratorService
 *
 * Role-based analytics insight generation and personalized delivery.
 *
 * Methodology: see docs/analytics-insights.md
 */

import { randomUUID } from "crypto";
import pool from "../config/database";
import { Logger } from "../utils/logger.utils";
import { AdvancedAnalyticsService, Insight } from "./advanced-analytics.service";
import { SocketService } from "./socket.service";
import { insightGenerationQueue } from "../queues/insightGeneration.queue";

export type InsightAudience = "admin" | "mentor" | "learner" | "all";

export interface StoredInsight extends Insight {
  targetAudience: InsightAudience;
  userId: string | null;
  entityId: string | null;
}

const MAX_UNREAD_PER_USER = 20;
const INSIGHT_TTL_DAYS = 30;

/** Map DB user.role → insight target_audience */
function roleToAudience(role: string): InsightAudience {
  if (role === "admin") return "admin";
  if (role === "mentor") return "mentor";
  return "learner"; // mentee / learner
}

function makeInsight(
  partial: Omit<StoredInsight, "id" | "createdAt" | "isRead"> & {
    id?: string;
  },
): StoredInsight {
  return {
    id: partial.id ?? randomUUID(),
    type: partial.type,
    severity: partial.severity,
    title: partial.title,
    description: partial.description,
    metricName: partial.metricName,
    metricValue: partial.metricValue,
    createdAt: new Date().toISOString(),
    isRead: false,
    targetAudience: partial.targetAudience,
    userId: partial.userId,
    entityId: partial.entityId,
  };
}

export const InsightGeneratorService = {
  /**
   * Entry point for the scheduled pipeline.
   * Generates platform admin insights immediately, then enqueues one job per
   * active user so the worker can personalize in parallel (SLA: 1k users / 10m).
   */
  async generateInsights(): Promise<{ adminCount: number; usersEnqueued: number }> {
    const startedAt = Date.now();
    logger.info("Starting insight generation pipeline");

    const adminInsights = await this.generateAdminInsights();
    await this.storeInsights(adminInsights);
    await this.capPlatformUnreadInsights("admin");

    const { rows: users } = await pool.query<{ id: string; role: string }>(
      `SELECT id, role::text AS role
       FROM users
       WHERE is_active = true
         AND role IN ('mentor', 'mentee')
         AND deleted_at IS NULL`,
    );

    // Admins already received platform insights; still enqueue for personal ones if any.
    // Mentors/learners get personalized jobs.
    let usersEnqueued = 0;
    const jobs = users.map((u) => ({
      name: "insight-generation-user",
      data: {
        jobType: "insight-generation-user" as const,
        userId: u.id,
        role: u.role,
      },
      opts: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 2,
      },
    }));

    if (jobs.length > 0) {
      // BullMQ supports bulk add for throughput
      const chunkSize = 200;
      for (let i = 0; i < jobs.length; i += chunkSize) {
        await insightGenerationQueue.addBulk(jobs.slice(i, i + chunkSize));
        usersEnqueued += Math.min(chunkSize, jobs.length - i);
      }
    }

    logger.info("Insight generation dispatch completed", {
      adminCount: adminInsights.length,
      usersEnqueued,
      durationMs: Date.now() - startedAt,
    });

    return { adminCount: adminInsights.length, usersEnqueued };
  },

  /**
   * Generate + store + emit insights for a single user based on role.
   */
  async generateInsightsForUser(userId: string, role: string): Promise<StoredInsight[]> {
    const audience = roleToAudience(role);
    let insights: StoredInsight[] = [];

    if (audience === "mentor") {
      insights = await this.generateMentorInsights(userId);
    } else if (audience === "learner") {
      insights = await this.generateLearnerInsights(userId);
    } else if (audience === "admin") {
      // Admins primarily get platform insights (generated once per cycle).
      // Skip duplicate personal admin noise unless they also mentor (rare).
      insights = [];
    }

    if (insights.length > 0) {
      await this.storeInsights(insights);
      await this.capUnreadInsights(userId);
    }

    return insights;
  },

  // ── Admin / platform ──────────────────────────────────────────────────────

  async generateAdminInsights(): Promise<StoredInsight[]> {
    const insights: StoredInsight[] = [];

    try {
      const metrics = await AdvancedAnalyticsService.getMetrics("admin", "30d");
      insights.push(...(await this.detectPlatformRevenueTrends()));
      insights.push(...(await this.detectSessionCompletionAnomalies()));
      insights.push(...(await this.detectUserGrowthAnomalies()));
      insights.push(...this.buildAdminRecommendations(metrics));
    } catch (error) {
      logger.error("Failed to generate admin insights", { error });
    }

    return insights.map((i) => ({
      ...i,
      targetAudience: "admin" as const,
      userId: null,
      entityId: null,
    }));
  },

  async detectPlatformRevenueTrends(): Promise<StoredInsight[]> {
    try {
      const { rows } = await pool.query<{ date: string; value: string }>(`
        SELECT date, SUM(total_amount)::text AS value
        FROM mv_daily_revenue
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY date
        ORDER BY date
      `);

      if (rows.length < 7) return [];

      const values = rows.map((r) => parseFloat(r.value || "0"));
      const trend = this.calculateTrend(values);
      if (Math.abs(trend.slope) <= 0.1) return [];

      const pct = Math.abs(trend.slope * 100).toFixed(1);
      return [
        makeInsight({
          type: "trend",
          severity: trend.slope < -0.2 ? "warning" : "info",
          title: "Platform Revenue Trend",
          description: `Platform revenue is ${trend.slope > 0 ? "up" : "down"} approximately ${pct}% over the last 30 days`,
          metricName: "platform_revenue",
          metricValue: trend.slope,
          targetAudience: "admin",
          userId: null,
          entityId: null,
        }),
      ];
    } catch (error) {
      logger.error("Failed to detect platform revenue trends", { error });
      return [];
    }
  },

  async detectSessionCompletionAnomalies(): Promise<StoredInsight[]> {
    try {
      const { rows } = await pool.query<{ date: string; completion_rate: string }>(`
        SELECT
          date,
          CASE
            WHEN SUM(session_count) > 0 THEN
              SUM(session_count) FILTER (WHERE status = 'completed')::float / SUM(session_count) * 100
            ELSE 0
          END::text AS completion_rate
        FROM mv_session_stats
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY date
        ORDER BY date
      `);

      if (rows.length < 7) return [];

      const values = rows.map((r) => parseFloat(r.completion_rate || "0"));
      const anomalies = this.detectStatisticalAnomalies(values);
      if (anomalies.length === 0) return [];

      const latest = anomalies[anomalies.length - 1];
      return [
        makeInsight({
          type: "anomaly",
          severity: Math.abs(latest.deviation) > 2.5 ? "critical" : "warning",
          title: "Session Completion Rate Drop",
          description: `Platform session completion rate is ${latest.deviation > 0 ? "unusually high" : "unusually low"} (${latest.value.toFixed(1)}% vs expected ${latest.expected.toFixed(1)}%)`,
          metricName: "session_completion_rate",
          metricValue: latest.value,
          targetAudience: "admin",
          userId: null,
          entityId: null,
        }),
      ];
    } catch (error) {
      logger.error("Failed to detect session completion anomalies", { error });
      return [];
    }
  },

  async detectUserGrowthAnomalies(): Promise<StoredInsight[]> {
    try {
      const { rows } = await pool.query<{ week: string; new_users: string }>(`
        SELECT date_trunc('week', created_at)::date::text AS week,
               COUNT(*)::text AS new_users
        FROM users
        WHERE created_at >= CURRENT_DATE - INTERVAL '56 days'
          AND deleted_at IS NULL
        GROUP BY 1
        ORDER BY 1
      `);

      if (rows.length < 4) return [];

      const values = rows.map((r) => parseFloat(r.new_users || "0"));
      const anomalies = this.detectStatisticalAnomalies(values);
      if (anomalies.length === 0) return [];

      const latest = anomalies[anomalies.length - 1];
      return [
        makeInsight({
          type: "anomaly",
          severity: latest.deviation < -2 ? "warning" : "info",
          title: "User Growth Anomaly",
          description: `New user signups are ${latest.deviation < 0 ? "below" : "above"} the recent weekly baseline (${latest.value.toFixed(0)} vs expected ${latest.expected.toFixed(0)})`,
          metricName: "user_growth",
          metricValue: latest.value,
          targetAudience: "admin",
          userId: null,
          entityId: null,
        }),
      ];
    } catch (error) {
      logger.error("Failed to detect user growth anomalies", { error });
      return [];
    }
  },

  buildAdminRecommendations(metrics: any): StoredInsight[] {
    const out: StoredInsight[] = [];

    try {
      if (metrics?.revenue?.growthRate < 0) {
        out.push(
          makeInsight({
            type: "recommendation",
            severity: "warning",
            title: "Revenue Decline Detected",
            description:
              "Consider promotional campaigns or pricing review to reverse the platform revenue decline",
            metricName: "revenue_growth",
            metricValue: metrics.revenue.growthRate,
            targetAudience: "admin",
            userId: null,
            entityId: null,
          }),
        );
      }

      if (metrics?.sessions?.completionRate < 80) {
        out.push(
          makeInsight({
            type: "recommendation",
            severity: "info",
            title: "Session Completion Rate Below Target",
            description:
              "Platform completion rate is below 80%. Focus on mentor training and session quality",
            metricName: "completion_rate",
            metricValue: metrics.sessions.completionRate,
            targetAudience: "admin",
            userId: null,
            entityId: null,
          }),
        );
      }

      if (metrics?.growth?.userGrowthRate < 5) {
        out.push(
          makeInsight({
            type: "recommendation",
            severity: "info",
            title: "User Growth Opportunity",
            description:
              "User growth is under 5%. Consider expanding marketing or referral programs",
            metricName: "user_growth",
            metricValue: metrics.growth.userGrowthRate,
            targetAudience: "admin",
            userId: null,
            entityId: null,
          }),
        );
      }
    } catch (error) {
      logger.error("Failed to build admin recommendations", { error });
    }

    return out;
  },

  // ── Mentor ────────────────────────────────────────────────────────────────

  async generateMentorInsights(mentorId: string): Promise<StoredInsight[]> {
    const insights: StoredInsight[] = [];

    try {
      // Session completion rate (this month vs last month)
      const { rows: completionRows } = await pool.query<{
        period: string;
        total: string;
        completed: string;
      }>(
        `SELECT
           CASE
             WHEN scheduled_start >= date_trunc('month', CURRENT_DATE) THEN 'current'
             ELSE 'previous'
           END AS period,
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE status = 'completed')::text AS completed
         FROM bookings
         WHERE mentor_id = $1
           AND scheduled_start >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
           AND scheduled_start < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
         GROUP BY 1`,
        [mentorId],
      );

      const current = completionRows.find((r) => r.period === "current");
      const previous = completionRows.find((r) => r.period === "previous");
      if (current && previous) {
        const curRate =
          parseInt(current.total, 10) > 0
            ? (parseInt(current.completed, 10) / parseInt(current.total, 10)) * 100
            : 0;
        const prevRate =
          parseInt(previous.total, 10) > 0
            ? (parseInt(previous.completed, 10) / parseInt(previous.total, 10)) * 100
            : 0;
        const delta = curRate - prevRate;
        if (Math.abs(delta) >= 10 && parseInt(previous.total, 10) >= 2) {
          insights.push(
            makeInsight({
              type: "trend",
              severity: delta < 0 ? "warning" : "info",
              title:
                delta < 0
                  ? "Your session completion declined"
                  : "Your session completion improved",
              description: `Your sessions ${delta < 0 ? "declined" : "increased"} ${Math.abs(delta).toFixed(0)}% this month (${curRate.toFixed(0)}% vs ${prevRate.toFixed(0)}% last month)`,
              metricName: "mentor_session_completion",
              metricValue: delta,
              targetAudience: "mentor",
              userId: mentorId,
              entityId: mentorId,
            }),
          );
        }
      }

      // Earnings trend
      const { rows: earningsRows } = await pool.query<{ period: string; earnings: string }>(
        `SELECT
           CASE
             WHEN completed_at >= date_trunc('month', CURRENT_DATE) THEN 'current'
             ELSE 'previous'
           END AS period,
           COALESCE(SUM(mentor_payout), 0)::text AS earnings
         FROM bookings
         WHERE mentor_id = $1
           AND status = 'completed'
           AND completed_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
           AND completed_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
         GROUP BY 1`,
        [mentorId],
      );

      const curEarn = parseFloat(
        earningsRows.find((r) => r.period === "current")?.earnings || "0",
      );
      const prevEarn = parseFloat(
        earningsRows.find((r) => r.period === "previous")?.earnings || "0",
      );
      if (prevEarn > 0) {
        const earnDeltaPct = ((curEarn - prevEarn) / prevEarn) * 100;
        if (Math.abs(earnDeltaPct) >= 15) {
          insights.push(
            makeInsight({
              type: "trend",
              severity: earnDeltaPct < 0 ? "warning" : "info",
              title: "Your earnings trend",
              description: `Your earnings are ${earnDeltaPct > 0 ? "up" : "down"} ${Math.abs(earnDeltaPct).toFixed(0)}% this month versus last month`,
              metricName: "mentor_earnings",
              metricValue: earnDeltaPct,
              targetAudience: "mentor",
              userId: mentorId,
              entityId: mentorId,
            }),
          );
        }
      }

      // Review rating trend (30d vs prior 30d)
      const { rows: ratingRows } = await pool.query<{ period: string; avg_rating: string; cnt: string }>(
        `SELECT
           CASE
             WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 'current'
             ELSE 'previous'
           END AS period,
           AVG(rating)::text AS avg_rating,
           COUNT(*)::text AS cnt
         FROM reviews
         WHERE reviewee_id = $1
           AND is_published = true
           AND created_at >= CURRENT_DATE - INTERVAL '60 days'
         GROUP BY 1`,
        [mentorId],
      );

      const curRating = ratingRows.find((r) => r.period === "current");
      const prevRating = ratingRows.find((r) => r.period === "previous");
      if (curRating && prevRating && parseInt(prevRating.cnt, 10) >= 2) {
        const delta =
          parseFloat(curRating.avg_rating) - parseFloat(prevRating.avg_rating);
        if (Math.abs(delta) >= 0.3) {
          insights.push(
            makeInsight({
              type: "trend",
              severity: delta < 0 ? "warning" : "info",
              title: "Your review rating trend",
              description: `Your average rating ${delta < 0 ? "dropped" : "rose"} by ${Math.abs(delta).toFixed(1)} points over the last 30 days`,
              metricName: "mentor_rating_trend",
              metricValue: delta,
              targetAudience: "mentor",
              userId: mentorId,
              entityId: mentorId,
            }),
          );
        }
      }

      // Booking inquiry volume (pending bookings this week vs last)
      const { rows: inquiryRows } = await pool.query<{ period: string; cnt: string }>(
        `SELECT
           CASE
             WHEN created_at >= date_trunc('week', CURRENT_DATE) THEN 'current'
             ELSE 'previous'
           END AS period,
           COUNT(*)::text AS cnt
         FROM bookings
         WHERE mentor_id = $1
           AND created_at >= date_trunc('week', CURRENT_DATE) - INTERVAL '1 week'
           AND created_at < date_trunc('week', CURRENT_DATE) + INTERVAL '1 week'
         GROUP BY 1`,
        [mentorId],
      );

      const curInq = parseInt(
        inquiryRows.find((r) => r.period === "current")?.cnt || "0",
        10,
      );
      const prevInq = parseInt(
        inquiryRows.find((r) => r.period === "previous")?.cnt || "0",
        10,
      );
      if (prevInq > 0) {
        const inqDeltaPct = ((curInq - prevInq) / prevInq) * 100;
        if (Math.abs(inqDeltaPct) >= 25) {
          insights.push(
            makeInsight({
              type: "trend",
              severity: "info",
              title: "Booking inquiry volume",
              description: `New booking requests are ${inqDeltaPct > 0 ? "up" : "down"} ${Math.abs(inqDeltaPct).toFixed(0)}% this week`,
              metricName: "mentor_booking_inquiries",
              metricValue: inqDeltaPct,
              targetAudience: "mentor",
              userId: mentorId,
              entityId: mentorId,
            }),
          );
        }
      }
    } catch (error) {
      logger.error("Failed to generate mentor insights", { error, mentorId });
    }

    return insights;
  },

  // ── Learner ───────────────────────────────────────────────────────────────

  async generateLearnerInsights(learnerId: string): Promise<StoredInsight[]> {
    const insights: StoredInsight[] = [];

    try {
      // Session attendance rate (completed vs no_show/cancelled by learner)
      const { rows: attendanceRows } = await pool.query<{
        total: string;
        attended: string;
        no_shows: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('completed', 'no_show', 'cancelled'))::text AS total,
           COUNT(*) FILTER (WHERE status = 'completed')::text AS attended,
           COUNT(*) FILTER (WHERE status = 'no_show')::text AS no_shows
         FROM bookings
         WHERE mentee_id = $1
           AND scheduled_start >= CURRENT_DATE - INTERVAL '30 days'
           AND scheduled_start < CURRENT_DATE`,
        [learnerId],
      );

      const total = parseInt(attendanceRows[0]?.total || "0", 10);
      const attended = parseInt(attendanceRows[0]?.attended || "0", 10);
      if (total >= 3) {
        const rate = (attended / total) * 100;
        if (rate < 80) {
          insights.push(
            makeInsight({
              type: "anomaly",
              severity: rate < 60 ? "warning" : "info",
              title: "Your session attendance rate",
              description: `You've attended ${rate.toFixed(0)}% of scheduled sessions in the last 30 days. Aim for 80%+ to stay on track`,
              metricName: "learner_attendance_rate",
              metricValue: rate,
              targetAudience: "learner",
              userId: learnerId,
              entityId: learnerId,
            }),
          );
        }
      }

      // Goal progress velocity
      const { rows: goalRows } = await pool.query<{
        avg_progress: string;
        goal_count: string;
        recent_updates: string;
      }>(
        `SELECT
           COALESCE(AVG(g.progress), 0)::text AS avg_progress,
           COUNT(*)::text AS goal_count,
           (
             SELECT COUNT(*)::text
             FROM goal_progress_logs gpl
             JOIN learner_goals lg ON lg.id = gpl.goal_id
             WHERE lg.learner_id = $1
               AND gpl.created_at >= CURRENT_DATE - INTERVAL '14 days'
           ) AS recent_updates
         FROM learner_goals g
         WHERE g.learner_id = $1 AND g.status = 'active'`,
        [learnerId],
      );

      const avgProgress = parseFloat(goalRows[0]?.avg_progress || "0");
      const goalCount = parseInt(goalRows[0]?.goal_count || "0", 10);
      const recentUpdates = parseInt(goalRows[0]?.recent_updates || "0", 10);
      if (goalCount > 0 && avgProgress < 40 && recentUpdates === 0) {
        insights.push(
          makeInsight({
            type: "recommendation",
            severity: "info",
            title: "Goal progress velocity is low",
            description: `You've been less active than your goal target — average progress is ${avgProgress.toFixed(0)}% with no updates in 14 days. Book a session to regain momentum`,
            metricName: "learner_goal_velocity",
            metricValue: avgProgress,
            targetAudience: "learner",
            userId: learnerId,
            entityId: learnerId,
          }),
        );
      }

      // Spending trend (no revenue/admin language — personal spend only)
      const { rows: spendRows } = await pool.query<{ period: string; spent: string }>(
        `SELECT
           CASE
             WHEN created_at >= date_trunc('month', CURRENT_DATE) THEN 'current'
             ELSE 'previous'
           END AS period,
           COALESCE(SUM(amount), 0)::text AS spent
         FROM bookings
         WHERE mentee_id = $1
           AND status IN ('completed', 'confirmed', 'in_progress')
           AND created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
           AND created_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
         GROUP BY 1`,
        [learnerId],
      );

      const curSpend = parseFloat(
        spendRows.find((r) => r.period === "current")?.spent || "0",
      );
      const prevSpend = parseFloat(
        spendRows.find((r) => r.period === "previous")?.spent || "0",
      );
      if (prevSpend > 0) {
        const spendDeltaPct = ((curSpend - prevSpend) / prevSpend) * 100;
        if (Math.abs(spendDeltaPct) >= 20) {
          insights.push(
            makeInsight({
              type: "trend",
              severity: "info",
              title: "Your spending trend",
              description: `Your mentorship spending is ${spendDeltaPct > 0 ? "up" : "down"} ${Math.abs(spendDeltaPct).toFixed(0)}% this month`,
              metricName: "learner_spending",
              metricValue: spendDeltaPct,
              targetAudience: "learner",
              userId: learnerId,
              entityId: learnerId,
            }),
          );
        }
      }

      // Recommended next session time (most common successful hour)
      const { rows: timeRows } = await pool.query<{ hour: string; cnt: string }>(
        `SELECT EXTRACT(HOUR FROM scheduled_start AT TIME ZONE COALESCE(timezone, 'UTC'))::int::text AS hour,
                COUNT(*)::text AS cnt
         FROM bookings
         WHERE mentee_id = $1
           AND status = 'completed'
           AND scheduled_start >= CURRENT_DATE - INTERVAL '90 days'
         GROUP BY 1
         ORDER BY COUNT(*) DESC
         LIMIT 1`,
        [learnerId],
      );

      if (timeRows[0] && parseInt(timeRows[0].cnt, 10) >= 2) {
        const hour = parseInt(timeRows[0].hour, 10);
        const label = `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? "AM" : "PM"}`;
        insights.push(
          makeInsight({
            type: "recommendation",
            severity: "info",
            title: "Recommended next session time",
            description: `Based on your completed sessions, around ${label} tends to work best for you`,
            metricName: "learner_recommended_session_hour",
            metricValue: hour,
            targetAudience: "learner",
            userId: learnerId,
            entityId: learnerId,
          }),
        );
      }
    } catch (error) {
      logger.error("Failed to generate learner insights", { error, learnerId });
    }

    return insights;
  },

  // ── Read path ─────────────────────────────────────────────────────────────

  /**
   * Return insights visible to this user:
   * - personal rows where user_id = $1
   * - platform-wide rows (user_id IS NULL) matching target_audience for their role
   * Mentors never see other mentors' personal insights; learners never see admin/revenue.
   */
  async getInsights(userId: string, unreadOnly: boolean = false): Promise<Insight[]> {
    try {
      const query = `
        SELECT ai.*
        FROM analytics_insights ai
        INNER JOIN users u ON u.id = $1
        WHERE (
            ai.user_id = $1
            OR (
              ai.user_id IS NULL
              AND (
                ai.target_audience = 'all'
                OR (ai.target_audience = 'admin' AND u.role = 'admin')
                OR (ai.target_audience = 'mentor' AND u.role = 'mentor')
                OR (ai.target_audience = 'learner' AND u.role = 'mentee')
              )
            )
          )
          AND (ai.expires_at IS NULL OR ai.expires_at > NOW())
          ${unreadOnly ? "AND ai.is_read = false" : ""}
          -- Learners must never receive revenue / admin metric insights
          AND NOT (
            u.role = 'mentee'
            AND (
              ai.target_audience = 'admin'
              OR ai.metric_name ILIKE '%revenue%'
              OR ai.metric_name ILIKE '%platform%'
            )
          )
        ORDER BY ai.created_at DESC
        LIMIT 50
      `;

      const { rows } = await pool.query(query, [userId]);

      return rows.map((row) => ({
        id: row.id,
        type: row.insight_type,
        severity: row.severity,
        title: row.title,
        description: row.description,
        metricName: row.metric_name,
        metricValue: parseFloat(row.metric_value || "0"),
        createdAt: row.created_at,
        isRead: row.is_read,
        targetAudience: row.target_audience,
        userId: row.user_id,
        entityId: row.entity_id,
      }));
    } catch (error) {
      logger.error("Failed to get insights", { error, userId });
      return [];
    }
  },

  async markAsRead(insightId: string): Promise<void> {
    try {
      await pool.query(
        "UPDATE analytics_insights SET is_read = true WHERE id = $1",
        [insightId],
      );
    } catch (error) {
      logger.error("Failed to mark insight as read", { error, insightId });
      throw error;
    }
  },

  /**
   * Keep only the 20 most recent unread insights per user; auto-mark older as read.
   */
  async capUnreadInsights(userId: string): Promise<number> {
    const { rowCount } = await pool.query(
      `
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
        FROM analytics_insights
        WHERE user_id = $1 AND is_read = false
      )
      UPDATE analytics_insights ai
      SET is_read = true
      FROM ranked r
      WHERE ai.id = r.id AND r.rn > $2
      `,
      [userId, MAX_UNREAD_PER_USER],
    );
    return rowCount ?? 0;
  },

  /** Cap unread platform-wide insights for a given audience (e.g. admin). */
  async capPlatformUnreadInsights(audience: InsightAudience): Promise<number> {
    const { rowCount } = await pool.query(
      `
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
        FROM analytics_insights
        WHERE user_id IS NULL
          AND target_audience = $1
          AND is_read = false
      )
      UPDATE analytics_insights ai
      SET is_read = true
      FROM ranked r
      WHERE ai.id = r.id AND r.rn > $2
      `,
      [audience, MAX_UNREAD_PER_USER],
    );
    return rowCount ?? 0;
  },

  // ── Helpers ───────────────────────────────────────────────────────────────

  calculateTrend(values: number[]): { slope: number; correlation: number } {
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const denom = n * sumXX - sumX * sumX;
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;

    const meanX = sumX / n;
    const meanY = sumY / n;
    const numerator = x.reduce(
      (sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY),
      0,
    );
    const denomX = Math.sqrt(
      x.reduce((sum, xi) => sum + Math.pow(xi - meanX, 2), 0),
    );
    const denomY = Math.sqrt(
      y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0),
    );
    const correlation =
      denomX === 0 || denomY === 0 ? 0 : numerator / (denomX * denomY);

    return { slope, correlation };
  },

  detectStatisticalAnomalies(
    values: number[],
  ): Array<{ index: number; value: number; expected: number; deviation: number }> {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return [];

    const anomalies: Array<{
      index: number;
      value: number;
      expected: number;
      deviation: number;
    }> = [];

    values.forEach((value, index) => {
      const deviation = (value - mean) / stdDev;
      if (Math.abs(deviation) > 2) {
        anomalies.push({ index, value, expected: mean, deviation });
      }
    });

    return anomalies;
  },

  async storeInsights(insights: StoredInsight[]): Promise<void> {
    for (const insight of insights) {
      try {
        await pool.query(
          `
          INSERT INTO analytics_insights (
            id, insight_type, severity, title, description,
            metric_name, metric_value, is_read, expires_at,
            target_audience, user_id, entity_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO NOTHING
        `,
          [
            insight.id,
            insight.type,
            insight.severity,
            insight.title,
            insight.description,
            insight.metricName ?? null,
            insight.metricValue ?? null,
            insight.isRead,
            new Date(Date.now() + INSIGHT_TTL_DAYS * 24 * 60 * 60 * 1000),
            insight.targetAudience,
            insight.userId,
            insight.entityId,
          ],
        );

        this.emitInsightNew(insight);
      } catch (error) {
        logger.error("Failed to store insight", {
          error,
          insightId: insight.id,
        });
      }
    }
  },

  emitInsightNew(insight: StoredInsight): void {
    const payload = {
      id: insight.id,
      type: insight.type,
      severity: insight.severity,
      title: insight.title,
      description: insight.description,
      metricName: insight.metricName,
      metricValue: insight.metricValue,
      targetAudience: insight.targetAudience,
      userId: insight.userId,
      entityId: insight.entityId,
      createdAt: insight.createdAt,
    };

    try {
      if (insight.userId) {
        SocketService.emitToUser(insight.userId, "insight:new", payload);
      } else if (insight.targetAudience === "admin") {
        SocketService.emitToRoom("admin", "insight:new", payload);
      }
    } catch (error) {
      logger.warn("Failed to emit insight:new", {
        error,
        insightId: insight.id,
      });
    }
  },

  // Backward-compatible wrappers used by older call sites
  async detectTrends(metricName: string, _data: any[]): Promise<Insight[]> {
    if (metricName === "revenue") {
      return this.detectPlatformRevenueTrends();
    }
    return [];
  },

  async detectAnomalies(metricName: string, _data: any[]): Promise<Insight[]> {
    if (metricName === "sessions") {
      return this.detectSessionCompletionAnomalies();
    }
    return [];
  },

  async generateRecommendations(metrics: any): Promise<Insight[]> {
    return this.buildAdminRecommendations(metrics);
  },
};
