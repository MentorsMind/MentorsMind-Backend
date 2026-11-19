import pool from "../config/database";
import { Logger } from "../utils/logger.utils";

export interface SessionQualityScore {
  sessionId: string;
  overallScore: number; // 0-100
  engagementScore: number;
  contentScore: number;
  communicationScore: number;
  preparationScore: number;
  valueScore: number;
  sentimentScore: number; // derived from comment text
  completionRate: number; // % of session duration used
  qualityTier: "excellent" | "good" | "average" | "poor";
  factors: QualityFactor[];
  computedAt: string;
}

export interface QualityFactor {
  name: string;
  weight: number;
  score: number;
  impact: "positive" | "negative" | "neutral";
}

export interface MentorQualityTrend {
  mentorId: string;
  period: string;
  avgScore: number;
  scoreHistory: { date: string; score: number; sessionCount: number }[];
  trend: "improving" | "declining" | "stable";
  trendSlope: number;
  percentile: number; // vs all mentors
  recommendations: string[];
}

export interface QualityInsight {
  type: "strength" | "weakness" | "opportunity";
  title: string;
  description: string;
  metric: string;
  value: number;
  benchmark: number;
}

export type MentorQualityTier =
  | "excellent"
  | "good"
  | "needs_improvement"
  | "at_risk";

export interface MentorQualityScoreResult {
  mentorId: string;
  score: number;
  tier: MentorQualityTier;
  completionRate: number;
  avgRating: number;
  responseTimeScore: number;
  cancellationPenalty: number;
  computedAt: string;
}

const MENTOR_SCORE_WEIGHTS = {
  completionRate: 0.35,
  avgRating: 0.3,
  responseTimeScore: 0.15,
  cancellationPenalty: 0.2,
};

function mentorScoreToTier(score: number): MentorQualityTier {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "needs_improvement";
  return "at_risk";
}

/**
 * Maps average response time (seconds to confirm/accept a booking) to a
 * 0-100 score. Under 1 hour is treated as ideal; beyond 24 hours floors at 0.
 */
function responseSecondsToScore(avgResponseSeconds: number | null): number {
  if (avgResponseSeconds === null || Number.isNaN(avgResponseSeconds)) {
    return 80; // no data yet — neutral-positive default
  }
  const hours = avgResponseSeconds / 3600;
  if (hours <= 1) return 100;
  if (hours >= 24) return 0;
  return Math.round(100 - ((hours - 1) / 23) * 100);
}

// Simple linear regression for trend detection
function linearRegression(
  y: number[],
): { slope: number; intercept: number; r2: number } {
  const n = y.length;
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0, r2: 0 };

  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  const ssTot = y.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0);
  const ssRes = y.reduce(
    (acc, yi, i) => acc + (yi - (slope * x[i] + intercept)) ** 2,
    0,
  );
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

// Naive sentiment scoring based on keyword presence
function computeSentimentScore(comment: string | null): number {
  if (!comment) return 50; // neutral baseline

  const text = comment.toLowerCase();
  const positiveWords = [
    "excellent",
    "great",
    "amazing",
    "helpful",
    "clear",
    "fantastic",
    "wonderful",
    "perfect",
    "outstanding",
    "brilliant",
    "insightful",
    "thorough",
    "knowledgeable",
    "patient",
    "engaging",
  ];
  const negativeWords = [
    "poor",
    "bad",
    "terrible",
    "confusing",
    "unhelpful",
    "boring",
    "waste",
    "disappointing",
    "unclear",
    "unprepared",
    "late",
    "rushed",
    "disorganized",
  ];

  let score = 50;
  for (const word of positiveWords) {
    if (text.includes(word)) score += 5;
  }
  for (const word of negativeWords) {
    if (text.includes(word)) score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

function scoreToTier(
  score: number,
): "excellent" | "good" | "average" | "poor" {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "average";
  return "poor";
}

// Weighted composite score from feedback ratings (1-5 scale → 0-100)
function computeWeightedScore(
  ratings: {
    content: number;
    communication: number;
    preparation: number;
    value: number;
  },
  sentiment: number,
  completionRate: number,
): number {
  const weights = {
    content: 0.25,
    communication: 0.25,
    preparation: 0.2,
    value: 0.2,
    sentiment: 0.05,
    completion: 0.05,
  };

  const normalize = (r: number) => ((r - 1) / 4) * 100; // 1-5 → 0-100

  return (
    normalize(ratings.content) * weights.content +
    normalize(ratings.communication) * weights.communication +
    normalize(ratings.preparation) * weights.preparation +
    normalize(ratings.value) * weights.value +
    sentiment * weights.sentiment +
    completionRate * weights.completion
  );
}

export const SessionQualityService = {
  /**
   * Compute quality score for a single session using its feedback data.
   */
  async computeSessionScore(
    sessionId: string,
  ): Promise<SessionQualityScore | null> {
    const { rows } = await pool.query(
      `SELECT
         sf.rating_content,
         sf.rating_communication,
         sf.rating_preparation,
         sf.rating_value,
         sf.comment,
         s.scheduled_at,
         s.duration_minutes,
         s.actual_duration_minutes
       FROM session_feedback sf
       JOIN sessions s ON s.id = sf.session_id
       WHERE sf.session_id = $1
       LIMIT 1`,
      [sessionId],
    );

    if (!rows.length) return null;

    const row = rows[0];
    const sentiment = computeSentimentScore(row.comment);
    const completionRate =
      row.duration_minutes && row.actual_duration_minutes
        ? Math.min(
            100,
            (row.actual_duration_minutes / row.duration_minutes) * 100,
          )
        : 80; // default if not tracked

    const overall = computeWeightedScore(
      {
        content: row.rating_content,
        communication: row.rating_communication,
        preparation: row.rating_preparation,
        value: row.rating_value,
      },
      sentiment,
      completionRate,
    );

    const normalize = (r: number) => ((r - 1) / 4) * 100;

    const factors: QualityFactor[] = [
      {
        name: "Content Quality",
        weight: 0.25,
        score: normalize(row.rating_content),
        impact: row.rating_content >= 4 ? "positive" : row.rating_content <= 2 ? "negative" : "neutral",
      },
      {
        name: "Communication",
        weight: 0.25,
        score: normalize(row.rating_communication),
        impact: row.rating_communication >= 4 ? "positive" : row.rating_communication <= 2 ? "negative" : "neutral",
      },
      {
        name: "Preparation",
        weight: 0.2,
        score: normalize(row.rating_preparation),
        impact: row.rating_preparation >= 4 ? "positive" : row.rating_preparation <= 2 ? "negative" : "neutral",
      },
      {
        name: "Value Delivered",
        weight: 0.2,
        score: normalize(row.rating_value),
        impact: row.rating_value >= 4 ? "positive" : row.rating_value <= 2 ? "negative" : "neutral",
      },
      {
        name: "Sentiment",
        weight: 0.05,
        score: sentiment,
        impact: sentiment >= 60 ? "positive" : sentiment <= 40 ? "negative" : "neutral",
      },
      {
        name: "Session Completion",
        weight: 0.05,
        score: completionRate,
        impact: completionRate >= 90 ? "positive" : completionRate <= 60 ? "negative" : "neutral",
      },
    ];

    return {
      sessionId,
      overallScore: Math.round(overall),
      engagementScore: Math.round(
        (normalize(row.rating_communication) + normalize(row.rating_content)) / 2,
      ),
      contentScore: Math.round(normalize(row.rating_content)),
      communicationScore: Math.round(normalize(row.rating_communication)),
      preparationScore: Math.round(normalize(row.rating_preparation)),
      valueScore: Math.round(normalize(row.rating_value)),
      sentimentScore: Math.round(sentiment),
      completionRate: Math.round(completionRate),
      qualityTier: scoreToTier(overall),
      factors,
      computedAt: new Date().toISOString(),
    };
  },

  /**
   * Get quality trend analysis for a mentor over a time period.
   */
  async getMentorQualityTrend(
    mentorId: string,
    days = 90,
  ): Promise<MentorQualityTrend> {
    const { rows } = await pool.query(
      `SELECT
         DATE_TRUNC('week', s.scheduled_at)::date AS week,
         AVG(sf.rating_content)::float AS avg_content,
         AVG(sf.rating_communication)::float AS avg_communication,
         AVG(sf.rating_preparation)::float AS avg_preparation,
         AVG(sf.rating_value)::float AS avg_value,
         COUNT(*)::int AS session_count
       FROM session_feedback sf
       JOIN sessions s ON s.id = sf.session_id
       WHERE sf.mentor_id = $1
         AND s.scheduled_at >= NOW() - INTERVAL '${days} days'
       GROUP BY week
       ORDER BY week ASC`,
      [mentorId],
    );

    const scoreHistory = rows.map((r) => {
      const score = computeWeightedScore(
        {
          content: r.avg_content,
          communication: r.avg_communication,
          preparation: r.avg_preparation,
          value: r.avg_value,
        },
        50, // neutral sentiment for aggregate
        80,
      );
      return {
        date: r.week,
        score: Math.round(score),
        sessionCount: r.session_count,
      };
    });

    const scores = scoreHistory.map((h) => h.score);
    const avgScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    const regression = linearRegression(scores);
    const trendLabel: "improving" | "declining" | "stable" =
      regression.slope > 1
        ? "improving"
        : regression.slope < -1
          ? "declining"
          : "stable";

    // Compute percentile vs all mentors
    const { rows: percentileRows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE avg_score < $1)::float / NULLIF(COUNT(*), 0) * 100 AS percentile
       FROM (
         SELECT sf.mentor_id, AVG(
           (sf.rating_content + sf.rating_communication + sf.rating_preparation + sf.rating_value) / 4.0
         ) AS avg_score
         FROM session_feedback sf
         GROUP BY sf.mentor_id
       ) mentor_scores`,
      [avgScore / 20], // convert 0-100 back to 1-5 scale for comparison
    );

    const percentile = Math.round(percentileRows[0]?.percentile ?? 50);

    const recommendations: string[] = [];
    if (avgScore < 70) {
      recommendations.push(
        "Focus on session preparation — mentees rate this dimension lowest on average.",
      );
    }
    if (trendLabel === "declining") {
      recommendations.push(
        "Quality trend is declining. Consider reviewing recent feedback comments.",
      );
    }
    if (percentile < 40) {
      recommendations.push(
        "Your quality score is below the platform median. Review top-rated mentor practices.",
      );
    }
    if (recommendations.length === 0) {
      recommendations.push(
        "Keep up the great work! Your quality metrics are strong.",
      );
    }

    return {
      mentorId,
      period: `${days}d`,
      avgScore,
      scoreHistory,
      trend: trendLabel,
      trendSlope: Math.round(regression.slope * 100) / 100,
      percentile,
      recommendations,
    };
  },

  /**
   * Get quality insights for a mentor — strengths, weaknesses, opportunities.
   */
  async getMentorInsights(mentorId: string): Promise<QualityInsight[]> {
    const { rows } = await pool.query(
      `SELECT
         AVG(sf.rating_content)::float AS avg_content,
         AVG(sf.rating_communication)::float AS avg_communication,
         AVG(sf.rating_preparation)::float AS avg_preparation,
         AVG(sf.rating_value)::float AS avg_value,
         COUNT(*)::int AS total_sessions
       FROM session_feedback sf
       WHERE sf.mentor_id = $1`,
      [mentorId],
    );

    const { rows: platformRows } = await pool.query(
      `SELECT
         AVG(rating_content)::float AS avg_content,
         AVG(rating_communication)::float AS avg_communication,
         AVG(rating_preparation)::float AS avg_preparation,
         AVG(rating_value)::float AS avg_value
       FROM session_feedback`,
    );

    if (!rows.length || !rows[0].total_sessions) return [];

    const mentor = rows[0];
    const platform = platformRows[0];

    const dimensions = [
      { key: "content", label: "Content Quality", value: mentor.avg_content, benchmark: platform.avg_content },
      { key: "communication", label: "Communication", value: mentor.avg_communication, benchmark: platform.avg_communication },
      { key: "preparation", label: "Preparation", value: mentor.avg_preparation, benchmark: platform.avg_preparation },
      { key: "value", label: "Value Delivered", value: mentor.avg_value, benchmark: platform.avg_value },
    ];

    const insights: QualityInsight[] = [];

    for (const dim of dimensions) {
      const diff = dim.value - dim.benchmark;
      if (diff >= 0.5) {
        insights.push({
          type: "strength",
          title: `Strong ${dim.label}`,
          description: `Your ${dim.label.toLowerCase()} score is ${diff.toFixed(1)} points above the platform average.`,
          metric: dim.key,
          value: Math.round(((dim.value - 1) / 4) * 100),
          benchmark: Math.round(((dim.benchmark - 1) / 4) * 100),
        });
      } else if (diff <= -0.5) {
        insights.push({
          type: "weakness",
          title: `Improve ${dim.label}`,
          description: `Your ${dim.label.toLowerCase()} score is ${Math.abs(diff).toFixed(1)} points below the platform average.`,
          metric: dim.key,
          value: Math.round(((dim.value - 1) / 4) * 100),
          benchmark: Math.round(((dim.benchmark - 1) / 4) * 100),
        });
      } else if (dim.value >= 3.5 && dim.value < 4.0) {
        insights.push({
          type: "opportunity",
          title: `Opportunity in ${dim.label}`,
          description: `Small improvements in ${dim.label.toLowerCase()} could push you into the top tier.`,
          metric: dim.key,
          value: Math.round(((dim.value - 1) / 4) * 100),
          benchmark: Math.round(((dim.benchmark - 1) / 4) * 100),
        });
      }
    }

    return insights;
  },

  /**
   * Get platform-wide quality distribution for admin dashboards.
   */
  async getPlatformQualityDistribution(): Promise<{
    distribution: { tier: string; count: number; percentage: number }[];
    avgScore: number;
    totalSessions: number;
  }> {
    const { rows } = await pool.query(
      `SELECT
         AVG(rating_content)::float AS avg_content,
         AVG(rating_communication)::float AS avg_communication,
         AVG(rating_preparation)::float AS avg_preparation,
         AVG(rating_value)::float AS avg_value,
         COUNT(*)::int AS total
       FROM session_feedback`,
    );

    if (!rows.length || !rows[0].total) {
      return { distribution: [], avgScore: 0, totalSessions: 0 };
    }

    const { rows: sessionRows } = await pool.query(
      `SELECT
         (rating_content + rating_communication + rating_preparation + rating_value) / 4.0 AS avg_rating
       FROM session_feedback`,
    );

    const tiers = { excellent: 0, good: 0, average: 0, poor: 0 };
    for (const r of sessionRows) {
      const score = ((r.avg_rating - 1) / 4) * 100;
      const tier = scoreToTier(score);
      tiers[tier]++;
    }

    const total = sessionRows.length;
    const distribution = Object.entries(tiers).map(([tier, count]) => ({
      tier,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

    const r = rows[0];
    const platformScore = computeWeightedScore(
      {
        content: r.avg_content,
        communication: r.avg_communication,
        preparation: r.avg_preparation,
        value: r.avg_value,
      },
      50,
      80,
    );

    return {
      distribution,
      avgScore: Math.round(platformScore),
      totalSessions: total,
    };
  },

  /**
   * Get top-performing sessions for a mentor (for showcasing best practices).
   */
  async getTopSessions(
    mentorId: string,
    limit = 5,
  ): Promise<{ sessionId: string; score: number; date: string }[]> {
    const { rows } = await pool.query(
      `SELECT
         sf.session_id,
         s.scheduled_at,
         (sf.rating_content + sf.rating_communication + sf.rating_preparation + sf.rating_value) / 4.0 AS avg_rating
       FROM session_feedback sf
       JOIN sessions s ON s.id = sf.session_id
       WHERE sf.mentor_id = $1
       ORDER BY avg_rating DESC, s.scheduled_at DESC
       LIMIT $2`,
      [mentorId, limit],
    );

    return rows.map((r) => ({
      sessionId: r.session_id,
      score: Math.round(((r.avg_rating - 1) / 4) * 100),
      date: r.scheduled_at,
    }));
  },

  /**
   * Compute the overall mentor quality score using the weighted formula:
   * completionRate * 0.35 + avgRating * 0.30 + responseTimeScore * 0.15 + cancellationPenalty * 0.20
   *
   * All dimensions are normalized to 0-100 before weighting. Deterministic
   * and idempotent for a given snapshot of underlying booking/feedback data.
   */
  async computeMentorQualityScore(
    mentorId: string,
  ): Promise<MentorQualityScoreResult> {
    const { rows: statsRows } = await pool.query(
      `SELECT total_bookings, completed_bookings, cancelled_bookings,
              no_show_count, avg_response_seconds
       FROM v_mentor_booking_stats
       WHERE mentor_id = $1`,
      [mentorId],
    );

    const stats = statsRows[0] ?? {
      total_bookings: 0,
      completed_bookings: 0,
      cancelled_bookings: 0,
      no_show_count: 0,
      avg_response_seconds: null,
    };

    const totalBookings = Number(stats.total_bookings) || 0;
    const completedBookings = Number(stats.completed_bookings) || 0;
    const cancelledBookings = Number(stats.cancelled_bookings) || 0;
    const noShowCount = Number(stats.no_show_count) || 0;

    const completionRate =
      totalBookings > 0
        ? Math.round((completedBookings / totalBookings) * 100)
        : 100;

    const cancellationRate =
      totalBookings > 0
        ? (cancelledBookings + noShowCount) / totalBookings
        : 0;
    const cancellationPenalty = Math.round(
      Math.max(0, 100 - cancellationRate * 200),
    );

    const { rows: ratingRows } = await pool.query(
      `SELECT AVG(rating)::float AS avg_rating
       FROM reviews
       WHERE reviewee_id = $1 AND is_published = true`,
      [mentorId],
    );
    const rawAvgRating = ratingRows[0]?.avg_rating;
    const avgRating =
      rawAvgRating !== null && rawAvgRating !== undefined
        ? Math.round(((rawAvgRating - 1) / 4) * 100)
        : 80; // neutral default for mentors with no reviews yet

    const responseTimeScore = responseSecondsToScore(
      stats.avg_response_seconds !== null
        ? Number(stats.avg_response_seconds)
        : null,
    );

    const score = Math.round(
      completionRate * MENTOR_SCORE_WEIGHTS.completionRate +
        avgRating * MENTOR_SCORE_WEIGHTS.avgRating +
        responseTimeScore * MENTOR_SCORE_WEIGHTS.responseTimeScore +
        cancellationPenalty * MENTOR_SCORE_WEIGHTS.cancellationPenalty,
    );

    return {
      mentorId,
      score,
      tier: mentorScoreToTier(score),
      completionRate,
      avgRating,
      responseTimeScore,
      cancellationPenalty,
      computedAt: new Date().toISOString(),
    };
  },

  /**
   * Persist a computed mentor quality score and sync the denormalized
   * quality_score/quality_tier columns on the users table.
   */
  async persistMentorQualityScore(
    result: MentorQualityScoreResult,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO mentor_quality_scores
         (mentor_id, score, tier, completion_rate, avg_rating, response_time_score, cancellation_penalty, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        result.mentorId,
        result.score,
        result.tier,
        result.completionRate,
        result.avgRating,
        result.responseTimeScore,
        result.cancellationPenalty,
        result.computedAt,
      ],
    );

    await pool.query(
      `UPDATE users SET quality_score = $1, quality_tier = $2, updated_at = NOW() WHERE id = $3`,
      [result.score, result.tier, result.mentorId],
    );
  },

  /**
   * List all active mentor ids eligible for nightly quality scoring.
   */
  async getActiveMentorIds(): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE role = 'mentor' AND is_active = true`,
    );
    return rows.map((r) => r.id);
  },

  /**
   * Paginated, sortable/filterable admin view of mentor quality scores
   * (latest score per mentor).
   */
  async getAdminQualityScores(params: {
    page: number;
    limit: number;
    tier?: MentorQualityTier;
    sortBy?: "score" | "computed_at";
    sortOrder?: "asc" | "desc";
  }): Promise<{
    scores: Array<MentorQualityScoreResult & { mentorName: string; mentorEmail: string }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, tier, sortBy = "score", sortOrder = "desc" } = params;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (tier) {
      conditions.push(`mqs.tier = $${idx++}`);
      values.push(tier);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (mqs.mentor_id)
         mqs.mentor_id, mqs.score, mqs.tier, mqs.completion_rate, mqs.avg_rating,
         mqs.response_time_score, mqs.cancellation_penalty, mqs.computed_at,
         u.first_name || ' ' || u.last_name AS mentor_name, u.email AS mentor_email
       FROM mentor_quality_scores mqs
       JOIN users u ON u.id = mqs.mentor_id
       ${whereClause}
       ORDER BY mqs.mentor_id, mqs.computed_at DESC`,
      values,
    );

    // Apply requested sort/pagination on the latest-per-mentor result set in memory,
    // since DISTINCT ON forces its own ORDER BY for row selection.
    const sorted = [...rows].sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      if (sortBy === "computed_at") {
        return (
          dir *
          (new Date(a.computed_at).getTime() - new Date(b.computed_at).getTime())
        );
      }
      return dir * (Number(a.score) - Number(b.score));
    });

    const paged = sorted.slice(offset, offset + limit);

    return {
      scores: paged.map((r) => ({
        mentorId: r.mentor_id,
        score: Number(r.score),
        tier: r.tier,
        completionRate: Number(r.completion_rate),
        avgRating: Number(r.avg_rating),
        responseTimeScore: Number(r.response_time_score),
        cancellationPenalty: Number(r.cancellation_penalty),
        computedAt: r.computed_at,
        mentorName: r.mentor_name,
        mentorEmail: r.mentor_email,
      })),
      total: sorted.length,
      page,
      limit,
    };
  },
};
