import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import {
  RecommendationEngine,
  UserProfile,
  LearningPathCandidate,
  RecommendationResult,
  OutcomePrediction,
} from "../ml/recommendation-engine";

// â”€â”€â”€ Interfaces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface RecommendationRequest {
  userId: string;
  limit?: number;
  filters?: RecommendationFilters;
}

export interface RecommendationFilters {
  difficulty?: "beginner" | "intermediate" | "advanced";
  tags?: string[];
  maxDurationWeeks?: number;
  excludeCompleted?: boolean;
}

export interface RecommendationResponse {
  recommendations: RecommendationResult[];
  userProfile: UserProfile;
  generatedAt: string;
  cached: boolean;
}

export interface PathWithDetails extends LearningPathCandidate {
  mentorCount: number;
  avgRating: number;
  enrolledCount: number;
}

export interface OutcomeReport {
  userId: string;
  predictions: OutcomePrediction[];
  generatedAt: string;
}

// â”€â”€â”€ Service â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CACHE_TTL = 600; // 10 minutes

export const AIRecommendationsService = {
  /**
   * Get personalized learning path recommendations for a user.
   */
  async getRecommendations(
    request: RecommendationRequest,
  ): Promise<RecommendationResponse> {
    const { userId, limit = 5, filters } = request;
    const cacheKey = `ai-recommendations:${userId}:${limit}:${JSON.stringify(filters || {})}`;

    const cached = await CacheService.get<RecommendationResponse>(cacheKey);
    if (cached) {
      logger.debug({ userId }, "Returning cached recommendations");
      return { ...cached, cached: true };
    }

    const profile = await this.getUserProfile(userId);
    if (!profile) {
      throw new Error(`User profile not found: ${userId}`);
    }

    const candidates = await this.getCandidatePaths(filters);
    const recommendations = await RecommendationEngine.recommendPaths(
      profile,
      candidates,
      limit,
    );

    const response: RecommendationResponse = {
      recommendations,
      userProfile: profile,
      generatedAt: new Date().toISOString(),
      cached: false,
    };

    await CacheService.set(cacheKey, response, CACHE_TTL);

    return response;
  },

  /**
   * Get outcome predictions for a user across multiple paths.
   */
  async predictOutcomes(
    userId: string,
    pathIds: string[],
  ): Promise<OutcomeReport> {
    const profile = await this.getUserProfile(userId);
    if (!profile) {
      throw new Error(`User profile not found: ${userId}`);
    }

    const predictions: OutcomePrediction[] = [];

    for (const pathId of pathIds) {
      const candidate = await this.getPathCandidate(pathId);
      if (!candidate) continue;

      const peerData = await this.getPeerData(pathId);
      const prediction = await RecommendationEngine.predictOutcome(
        profile,
        candidate,
        peerData,
      );
      predictions.push(prediction);
    }

    return {
      userId,
      predictions,
      generatedAt: new Date().toISOString(),
    };
  },

  /**
   * Record a user interaction with a learning path.
   */
  async recordInteraction(
    userId: string,
    pathId: string,
    action: "viewed" | "enrolled" | "completed" | "abandoned",
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const profile = await this.getUserProfile(userId);
    if (!profile) {
      throw new Error(`User profile not found: ${userId}`);
    }

    await RecommendationEngine.recordInteraction(profile, pathId, action, metadata);

    // Invalidate cache
    await CacheService.invalidate(`ai-recommendations:${userId}:*`);

    // Store interaction for future model training
    await this.storeInteraction(userId, pathId, action, metadata);

    logger.info({ userId, pathId, action }, "Interaction recorded");
  },

  /**
   * Get A/B test results for recommendation variants.
   */
  getABTestResults(
    testId: string,
    variantConversions: Record<string, { impressions: number; conversions: number }>,
  ) {
    return RecommendationEngine.getABTestResults(testId, variantConversions);
  },

  // â”€â”€â”€ Data access helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const userQuery = `
        SELECT id, role, created_at
        FROM users
        WHERE id = $1 AND deleted_at IS NULL
      `;
      const { rows: userRows } = await pool.query(userQuery, [userId]);
      if (userRows.length === 0) return null;

      const user = userRows[0];

      // Fetch skills
      const skillsQuery = `
        SELECT skill_name, level, last_assessed_at, verified
        FROM user_skills
        WHERE user_id = $1
      `;
      const { rows: skillRows } = await pool.query(skillsQuery, [userId]);

      // Fetch interests
      const interestsQuery = `
        SELECT interest
        FROM user_interests
        WHERE user_id = $1
      `;
      const { rows: interestRows } = await pool.query(interestsQuery, [userId]);

      // Fetch goals
      const goalsQuery = `
        SELECT goal_text
        FROM user_goals
        WHERE user_id = $1
      `;
      const { rows: goalRows } = await pool.query(goalsQuery, [userId]);

      // Fetch learning style
      const styleQuery = `
        SELECT learning_style
        FROM user_profiles
        WHERE user_id = $1
      `;
      const { rows: styleRows } = await pool.query(styleQuery, [userId]);

      // Fetch experience level
      const expQuery = `
        SELECT experience_level
        FROM user_profiles
        WHERE user_id = $1
      `;
      const { rows: expRows } = await pool.query(expQuery, [userId]);

      // Fetch completed/active paths
      const pathsQuery = `
        SELECT path_id, status
        FROM user_learning_paths
        WHERE user_id = $1
      `;
      const { rows: pathRows } = await pool.query(pathsQuery, [userId]);

      const completedPaths = pathRows
        .filter((p) => p.status === "completed")
        .map((p) => p.path_id);
      const activePaths = pathRows
        .filter((p) => p.status === "active")
        .map((p) => p.path_id);

      // Fetch session history
      const historyQuery = `
        SELECT b.id as session_id, b.mentor_id, b.topic,
               COALESCE(sf.rating, 0) as rating,
               b.completed_at, b.duration_minutes
        FROM bookings b
        LEFT JOIN session_feedback sf ON sf.booking_id = b.id
        WHERE b.learner_id = $1 AND b.status = 'completed'
        ORDER BY b.completed_at DESC
        LIMIT 50
      `;
      const { rows: historyRows } = await pool.query(historyQuery, [userId]);

      return {
        userId: user.id,
        role: user.role,
        skills: skillRows.map((s) => ({
          name: s.skill_name,
          level: s.level,
          lastAssessed: s.last_assessed_at || new Date(),
          verified: s.verified || false,
        })),
        interests: interestRows.map((r) => r.interest),
        careerGoals: goalRows.map((r) => r.goal_text),
        learningStyle: styleRows[0]?.learning_style || "visual",
        experienceLevel: expRows[0]?.experience_level || "beginner",
        completedPaths,
        activePaths,
        sessionHistory: historyRows.map((h) => ({
          sessionId: h.session_id,
          mentorId: h.mentor_id,
          topic: h.topic,
          rating: h.rating,
          completedAt: h.completed_at,
          durationMinutes: h.duration_minutes,
          outcomes: [],
        })),
      };
    } catch (error) {
      logger.error({ userId, error }, "Failed to get user profile");
      throw error;
    }
  },

  async getCandidatePaths(
    filters?: RecommendationFilters,
  ): Promise<PathWithDetails[]> {
    let query = `
      SELECT lp.id as path_id, lp.title, lp.description, lp.estimated_duration_weeks,
             lp.difficulty, lp.tags, lp.completion_rate, lp.avg_outcome_score,
             COUNT(DISTINCT lpm.mentor_id) as mentor_count,
             COALESCE(AVG(lr.rating), 0) as avg_rating,
             COUNT(DISTINCT ule.user_id) as enrolled_count
      FROM learning_paths lp
      LEFT JOIN learning_path_modules lpm ON lpm.path_id = lp.id
      LEFT JOIN learning_path_reviews lr ON lr.path_id = lp.id
      LEFT JOIN user_learning_paths ule ON ule.path_id = lp.id AND ule.status = 'active'
      WHERE lp.status = 'active'
    `;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.difficulty) {
      query += ` AND lp.difficulty = $${paramIndex}`;
      params.push(filters.difficulty);
      paramIndex++;
    }

    if (filters?.tags && filters.tags.length > 0) {
      query += ` AND lp.tags && $${paramIndex}`;
      params.push(filters.tags);
      paramIndex++;
    }

    if (filters?.maxDurationWeeks) {
      query += ` AND lp.estimated_duration_weeks <= $${paramIndex}`;
      params.push(filters.maxDurationWeeks);
      paramIndex++;
    }

    query += `
      GROUP BY lp.id, lp.title, lp.description, lp.estimated_duration_weeks,
               lp.difficulty, lp.tags, lp.completion_rate, lp.avg_outcome_score
      ORDER BY lp.avg_outcome_score DESC NULLS LAST
    `;

    const { rows } = await pool.query(query, params);

    return rows.map((row) => ({
      pathId: row.path_id,
      title: row.title,
      description: row.description,
      modules: [],
      estimatedDurationWeeks: row.estimated_duration_weeks || 12,
      difficulty: row.difficulty || "beginner",
      tags: row.tags || [],
      completionRate: parseFloat(row.completion_rate || "0.5"),
      avgOutcomeScore: parseFloat(row.avg_outcome_score || "50"),
      mentorCount: parseInt(row.mentor_count || "0"),
      avgRating: parseFloat(row.avg_rating || "0"),
      enrolledCount: parseInt(row.enrolled_count || "0"),
    }));
  },

  async getPathCandidate(
    pathId: string,
  ): Promise<LearningPathCandidate | null> {
    const query = `
      SELECT lp.id as path_id, lp.title, lp.description, lp.estimated_duration_weeks,
             lp.difficulty, lp.tags, lp.completion_rate, lp.avg_outcome_score
      FROM learning_paths lp
      WHERE lp.id = $1 AND lp.status = 'active'
    `;
    const { rows } = await pool.query(query, [pathId]);
    if (rows.length === 0) return null;

    const row = rows[0];

    // Fetch modules
    const modulesQuery = `
      SELECT id, title, "order", skill_targets, estimated_hours, prerequisites
      FROM learning_path_modules
      WHERE path_id = $1
      ORDER BY "order" ASC
    `;
    const { rows: moduleRows } = await pool.query(modulesQuery, [pathId]);

    return {
      pathId: row.path_id,
      title: row.title,
      description: row.description,
      modules: moduleRows.map((m) => ({
        moduleId: m.id,
        title: m.title,
        order: m.order,
        skillTargets: m.skill_targets || [],
        estimatedHours: m.estimated_hours || 0,
        prerequisites: m.prerequisites || [],
      })),
      estimatedDurationWeeks: row.estimated_duration_weeks || 12,
      difficulty: row.difficulty || "beginner",
      tags: row.tags || [],
      completionRate: parseFloat(row.completion_rate || "0.5"),
      avgOutcomeScore: parseFloat(row.avg_outcome_score || "50"),
    };
  },

  async getPeerData(
    pathId: string,
  ): Promise<{ completionRate: number; avgDurationWeeks: number }[]> {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::float /
          NULLIF(COUNT(*), 0) as completion_rate,
        AVG(EXTRACT(EPOCH FROM (completed_at - enrolled_at)) / 604800) as avg_duration_weeks
      FROM user_learning_paths
      WHERE path_id = $1
    `;
    const { rows } = await pool.query(query, [pathId]);

    if (rows.length === 0 || rows[0].completion_rate === null) {
      return [];
    }

    return [{
      completionRate: parseFloat(rows[0].completion_rate),
      avgDurationWeeks: parseFloat(rows[0].avg_duration_weeks || "12"),
    }];
  },

  async storeInteraction(
    userId: string,
    pathId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO recommendation_interactions (user_id, path_id, action, metadata, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `;
      await pool.query(query, [userId, pathId, action, JSON.stringify(metadata || {})]);
    } catch (error) {
      // Non-critical: log and continue
      logger.warn({ userId, pathId, action, error },
        "Failed to store interaction (non-critical)");
    }
  },
};

