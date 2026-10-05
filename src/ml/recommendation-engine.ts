import { Logger } from "../utils/logger.utils";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface UserProfile {
  userId: string;
  role: "learner" | "mentor";
  skills: SkillEntry[];
  interests: string[];
  careerGoals: string[];
  learningStyle: LearningStyle;
  experienceLevel: "beginner" | "intermediate" | "advanced";
  completedPaths: string[];
  activePaths: string[];
  sessionHistory: SessionHistoryEntry[];
}

export interface SkillEntry {
  name: string;
  level: number; // 1-10
  lastAssessed: Date;
  verified: boolean;
}

export type LearningStyle =
  | "visual"
  | "auditory"
  | "reading"
  | "kinesthetic";

export interface SessionHistoryEntry {
  sessionId: string;
  mentorId: string;
  topic: string;
  rating: number;
  completedAt: Date;
  durationMinutes: number;
  outcomes: string[];
}

export interface LearningPathCandidate {
  pathId: string;
  title: string;
  description: string;
  modules: PathModule[];
  estimatedDurationWeeks: number;
  difficulty: "beginner" | "intermediate" | "advanced";
  tags: string[];
  completionRate: number; // historical
  avgOutcomeScore: number; // historical
}

export interface PathModule {
  moduleId: string;
  title: string;
  order: number;
  skillTargets: string[];
  estimatedHours: number;
  prerequisites: string[];
}

export interface RecommendationResult {
  pathId: string;
  score: number;
  confidence: number;
  reasoning: PathReasoning;
  estimatedCompletionDate: Date;
  skillGapAnalysis: SkillGap[];
  alternativePaths: string[];
  abTestVariant: string | null;
}

export interface PathReasoning {
  skillAlignment: number; // 0-1
  goalAlignment: number; // 0-1
  difficultyFit: number; // 0-1
  historicalSuccess: number; // 0-1
  peerPerformance: number; // 0-1
}

export interface SkillGap {
  skill: string;
  currentLevel: number;
  requiredLevel: number;
  gap: number;
}

export interface OutcomePrediction {
  pathId: string;
  predictedCompletionRate: number;
  predictedDurationWeeks: number;
  predictedOutcomeScore: number;
  riskFactors: RiskFactor[];
  confidenceInterval: [number, number];
}

export interface RiskFactor {
  factor: string;
  severity: "low" | "medium" | "high";
  impact: number; // 0-1
  mitigation: string;
}

export interface ABTestConfig {
  testId: string;
  name: string;
  variants: ABTestVariant[];
  trafficSplit: Record<string, number>;
  startDate: Date;
  endDate: Date;
  status: "active" | "paused" | "completed";
}

export interface ABTestVariant {
  variantId: string;
  name: string;
  weight: number;
  config: Record<string, unknown>;
}

export interface ABTestAssignment {
  userId: string;
  testId: string;
  variantId: string;
  assignedAt: Date;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

const WEIGHTS: PathReasoning = {
  skillAlignment: 0.25,
  goalAlignment: 0.25,
  difficultyFit: 0.2,
  historicalSuccess: 0.15,
  peerPerformance: 0.15,
};

const DEFAULT_OUTCOME_PREDICTION_CONFIDENCE = 0.7;

export const RecommendationEngine = {
  /**
   * Generate ranked learning path recommendations for a user.
   */
  async recommendPaths(
    profile: UserProfile,
    candidates: LearningPathCandidate[],
    limit: number = 5,
  ): Promise<RecommendationResult[]> {
    logger.info({ userId: profile.userId, candidateCount: candidates.length },
      "Generating learning path recommendations");

    const scored = candidates.map((candidate) => {
      const reasoning = this.scoreCandidate(profile, candidate);
      const score = this.weightedScore(reasoning);
      const skillGaps = this.computeSkillGaps(profile, candidate);
      const abVariant = this.getABTestVariant(profile.userId);

      const estimatedWeeks = this.estimateCompletionWeeks(profile, candidate);
      const completionDate = new Date();
      completionDate.setDate(completionDate.getDate() + estimatedWeeks * 7);

      const alternativePaths = candidates
        .filter((c) => c.pathId !== candidate.pathId)
        .sort((a, b) => {
          const aScore = this.weightedScore(this.scoreCandidate(profile, a));
          const bScore = this.weightedScore(this.scoreCandidate(profile, b));
          return bScore - aScore;
        })
        .slice(0, 3)
        .map((c) => c.pathId);

      return {
        pathId: candidate.pathId,
        score,
        confidence: this.computeConfidence(reasoning),
        reasoning,
        estimatedCompletionDate: completionDate,
        skillGapAnalysis: skillGaps,
        alternativePaths,
        abTestVariant: abVariant,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },

  /**
   * Predict outcomes for a given user and path.
   */
  async predictOutcome(
    profile: UserProfile,
    candidate: LearningPathCandidate,
    peerData?: { completionRate: number; avgDurationWeeks: number }[],
  ): Promise<OutcomePrediction> {
    const reasoning = this.scoreCandidate(profile, candidate);

    const historicalSuccessRate = candidate.completionRate;
    const peerAvg = peerData && peerData.length > 0
      ? peerData.reduce((sum, p) => sum + p.completionRate, 0) / peerData.length
      : historicalSuccessRate;

    const predictedCompletionRate = Math.min(1, Math.max(0,
      historicalSuccessRate * 0.4 +
      peerAvg * 0.3 +
      reasoning.difficultyFit * 0.3,
    ));

    const baseDuration = candidate.estimatedDurationWeeks;
    const durationMultiplier = 1 + (1 - reasoning.difficultyFit) * 0.5;
    const predictedDurationWeeks = Math.round(baseDuration * durationMultiplier);

    const predictedOutcomeScore = Math.round(
      reasoning.skillAlignment * 30 +
      reasoning.goalAlignment * 30 +
      historicalSuccessRate * 20 +
      reasoning.peerPerformance * 20,
    );

    const riskFactors = this.identifyRiskFactors(profile, candidate, reasoning);

    const confidence = DEFAULT_OUTCOME_PREDICTION_CONFIDENCE;
    const margin = (1 - confidence) * predictedOutcomeScore;

    return {
      pathId: candidate.pathId,
      predictedCompletionRate,
      predictedDurationWeeks,
      predictedOutcomeScore,
      riskFactors,
      confidenceInterval: [
        Math.max(0, predictedOutcomeScore - margin),
        Math.min(100, predictedOutcomeScore + margin),
      ],
    };
  },

  /**
   * Update user profile based on interaction.
   */
  async recordInteraction(
    profile: UserProfile,
    pathId: string,
    action: "viewed" | "enrolled" | "completed" | "abandoned",
    metadata?: Record<string, unknown>,
  ): Promise<UserProfile> {
    logger.debug({ userId: profile.userId, pathId, action },
      "Recording interaction");

    const updatedActivePaths = action === "enrolled"
      ? [...profile.activePaths, pathId]
      : profile.activePaths;

    const updatedCompletedPaths = action === "completed"
      ? [...profile.completedPaths, pathId]
      : profile.completedPaths;

    const updatedActive = action === "completed"
      ? updatedActivePaths.filter((id) => id !== pathId)
      : action === "abandoned"
        ? updatedActivePaths.filter((id) => id !== pathId)
        : updatedActivePaths;

    const sessionEntry: SessionHistoryEntry | null =
      action === "completed" && metadata
        ? {
          sessionId: (metadata.sessionId as string) || "",
          mentorId: (metadata.mentorId as string) || "",
          topic: (metadata.topic as string) || "",
          rating: (metadata.rating as number) || 0,
          completedAt: new Date(),
          durationMinutes: (metadata.durationMinutes as number) || 0,
          outcomes: (metadata.outcomes as string[]) || [],
        }
        : null;

    const updatedHistory = sessionEntry
      ? [...profile.sessionHistory, sessionEntry]
      : profile.sessionHistory;

    return {
      ...profile,
      activePaths: updatedActive,
      completedPaths: updatedCompletedPaths,
      sessionHistory: updatedHistory,
    };
  },

  // ─── Internal helpers ──────────────────────────────────────────────────────

  scoreCandidate(
    profile: UserProfile,
    candidate: LearningPathCandidate,
  ): PathReasoning {
    return {
      skillAlignment: this.computeSkillAlignment(profile, candidate),
      goalAlignment: this.computeGoalAlignment(profile, candidate),
      difficultyFit: this.computeDifficultyFit(profile, candidate),
      historicalSuccess: candidate.completionRate,
      peerPerformance: candidate.avgOutcomeScore / 100,
    };
  },

  weightedScore(reasoning: PathReasoning): number {
    return Math.round(
      (reasoning.skillAlignment * WEIGHTS.skillAlignment +
        reasoning.goalAlignment * WEIGHTS.goalAlignment +
        reasoning.difficultyFit * WEIGHTS.difficultyFit +
        reasoning.historicalSuccess * WEIGHTS.historicalSuccess +
        reasoning.peerPerformance * WEIGHTS.peerPerformance) *
      100,
    ) / 100;
  },

  computeSkillAlignment(
    profile: UserProfile,
    candidate: LearningPathCandidate,
  ): number {
    const targetSkills = candidate.modules.flatMap((m) => m.skillTargets);
    if (targetSkills.length === 0) return 0;

    const userSkillMap = new Map(profile.skills.map((s) => [s.name, s.level]));
    let alignmentSum = 0;

    for (const skill of targetSkills) {
      const userLevel = userSkillMap.get(skill);
      if (userLevel !== undefined) {
        // Higher alignment when user has some foundation but not mastery
        alignmentSum += userLevel < 8 ? 0.8 + userLevel * 0.025 : 0.5;
      } else {
        alignmentSum += 0.3; // new skill is moderately aligned
      }
    }

    return Math.min(1, alignmentSum / targetSkills.length);
  },

  computeGoalAlignment(
    profile: UserProfile,
    candidate: LearningPathCandidate,
  ): number {
    if (profile.careerGoals.length === 0 || candidate.tags.length === 0) {
      return 0.5;
    }

    const goalSet = new Set(profile.careerGoals.map((g) => g.toLowerCase()));
    const tagSet = new Set(candidate.tags.map((t) => t.toLowerCase()));

    let matches = 0;
    for (const goal of Array.from(goalSet)) {
      for (const tag of Array.from(tagSet)) {
        if (goal.includes(tag) || tag.includes(goal)) {
          matches++;
          break;
        }
      }
    }

    return Math.min(1, matches / goalSet.size);
  },

  computeDifficultyFit(
    profile: UserProfile,
    candidate: LearningPathCandidate,
  ): number {
    const levelMap: Record<string, number> = {
      beginner: 1,
      intermediate: 2,
      advanced: 3,
    };

    const userLevel = levelMap[profile.experienceLevel] || 2;
    const pathLevel = levelMap[candidate.difficulty] || 2;
    const diff = Math.abs(userLevel - pathLevel);

    if (diff === 0) return 1;
    if (diff === 1) return 0.6;
    return 0.2;
  },

  computeSkillGaps(
    profile: UserProfile,
    candidate: LearningPathCandidate,
  ): SkillGap[] {
    const targetSkills = candidate.modules.flatMap((m) => m.skillTargets);
    const requiredLevels = new Map<string, number>();

    for (const mod of candidate.modules) {
      for (const skill of mod.skillTargets) {
        const existing = requiredLevels.get(skill) || 0;
        requiredLevels.set(skill, Math.max(existing, 7)); // assume proficient target
      }
    }

    const userSkillMap = new Map(profile.skills.map((s) => [s.name, s.level]));
    const gaps: SkillGap[] = [];

    for (const [skill, requiredLevel] of Array.from(requiredLevels.entries())) {
      const currentLevel = userSkillMap.get(skill) || 0;
      if (currentLevel < requiredLevel) {
        gaps.push({
          skill,
          currentLevel,
          requiredLevel,
          gap: requiredLevel - currentLevel,
        });
      }
    }

    return gaps.sort((a, b) => b.gap - a.gap);
  },

  computeConfidence(reasoning: PathReasoning): number {
    const scores = [
      reasoning.skillAlignment,
      reasoning.goalAlignment,
      reasoning.difficultyFit,
      reasoning.historicalSuccess,
      reasoning.peerPerformance,
    ];
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance =
      scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
    // Lower variance → higher confidence
    return Math.round((1 - variance) * 100) / 100;
  },

  estimateCompletionWeeks(
    profile: UserProfile,
    candidate: LearningPathCandidate,
  ): number {
    const baseWeeks = candidate.estimatedDurationWeeks;
    const activityFactor =
      profile.sessionHistory.length > 10
        ? 0.8
        : profile.sessionHistory.length > 5
          ? 0.9
          : 1.1;
    const difficultyFactor =
      profile.experienceLevel === candidate.difficulty
        ? 1
        : profile.experienceLevel === "beginner" && candidate.difficulty === "advanced"
          ? 1.5
          : 1.2;

    return Math.max(1, Math.round(baseWeeks * activityFactor * difficultyFactor));
  },

  identifyRiskFactors(
    profile: UserProfile,
    candidate: LearningPathCandidate,
    reasoning: PathReasoning,
  ): RiskFactor[] {
    const risks: RiskFactor[] = [];

    if (reasoning.difficultyFit < 0.4) {
      risks.push({
        factor: "Difficulty mismatch",
        severity: "high",
        impact: 1 - reasoning.difficultyFit,
        mitigation: "Consider starting with prerequisite modules or easier paths",
      });
    }

    if (reasoning.skillAlignment < 0.3) {
      risks.push({
        factor: "Low skill alignment",
        severity: "medium",
        impact: 1 - reasoning.skillAlignment,
        mitigation: "Complete foundational courses first",
      });
    }

    if (profile.sessionHistory.length < 3) {
      risks.push({
        factor: "Low engagement history",
        severity: "medium",
        impact: 0.3,
        mitigation: "Schedule regular check-in sessions with a mentor",
      });
    }

    const avgRating =
      profile.sessionHistory.length > 0
        ? profile.sessionHistory.reduce((s, h) => s + h.rating, 0) /
          profile.sessionHistory.length
        : 0;
    if (avgRating < 3 && profile.sessionHistory.length > 0) {
      risks.push({
        factor: "Below average session satisfaction",
        severity: "low",
        impact: 0.2,
        mitigation: "Explore different mentor matching or session formats",
      });
    }

    return risks;
  },

  // ─── A/B Testing ──────────────────────────────────────────────────────────

  activeTests: new Map<string, ABTestConfig>(),
  assignments: new Map<string, ABTestAssignment[]>(),

  registerABTest(config: ABTestConfig): void {
    this.activeTests.set(config.testId, config);
    this.assignments.set(config.testId, []);
    logger.info({ testId: config.testId, name: config.name },
      "A/B test registered");
  },

  getABTestVariant(userId: string): string | null {
    for (const [testId, config] of this.activeTests) {
      if (config.status !== "active") continue;
      if (new Date() < config.startDate || new Date() > config.endDate) continue;

      const existing = (this.assignments.get(testId) || []).find(
        (a) => a.userId === userId,
      );
      if (existing) return existing.variantId;

      const variantId = this.assignVariant(userId, config);
      const assignment: ABTestAssignment = {
        userId,
        testId,
        variantId,
        assignedAt: new Date(),
      };
      const current = this.assignments.get(testId) || [];
      current.push(assignment);
      this.assignments.set(testId, current);

      return variantId;
    }
    return null;
  },

  assignVariant(userId: string, config: ABTestConfig): string {
    // Deterministic assignment based on user ID hash
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash * 31 + userId.charCodeAt(i)) | 0;
    }
    const normalized = Math.abs(hash) / 2147483647;

    let cumulative = 0;
    for (const variant of config.variants) {
      const split = config.trafficSplit[variant.variantId] || 0;
      cumulative += split;
      if (normalized <= cumulative) {
        return variant.variantId;
      }
    }

    return config.variants[0]?.variantId || "control";
  },

  getABTestResults(
    testId: string,
    variantConversions: Record<string, { impressions: number; conversions: number }>,
  ): {
    variants: Array<{
      variantId: string;
      conversionRate: number;
      sampleSize: number;
      isWinner: boolean;
    }>;
    confidence: number;
  } | null {
    const config = this.activeTests.get(testId);
    if (!config) return null;

    const results = config.variants.map((variant) => {
      const data = variantConversions[variant.variantId] || {
        impressions: 0,
        conversions: 0,
      };
      const conversionRate =
        data.impressions > 0 ? data.conversions / data.impressions : 0;

      return {
        variantId: variant.variantId,
        conversionRate,
        sampleSize: data.impressions,
        isWinner: false,
      };
    });

    const maxRate = Math.max(...results.map((r) => r.conversionRate));
    results.forEach((r) => {
      r.isWinner = r.conversionRate === maxRate && r.sampleSize > 0;
    });

    const totalImpressions = results.reduce((s, r) => s + r.sampleSize, 0);
    const confidence = totalImpressions > 100 ? 0.95 : totalImpressions > 50 ? 0.8 : 0.5;

    return { variants: results, confidence };
  },
};
