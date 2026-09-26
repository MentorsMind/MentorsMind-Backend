import {
  GamificationModel,
  Achievement,
  Badge,
  AchievementCategory,
  AchievementRarity,
} from '../models/gamification.model';
import { logger } from '../utils/logger';

/**
 * AchievementService
 *
 * Owns everything related to achievement / badge lifecycle:
 *   - listing and looking up achievement definitions
 *   - creating custom achievements (admin)
 *   - unlocking achievements for a user
 *   - evaluating criteria against a user's progress
 *   - reading a user's earned badges
 *   - managing the profile badge showcase
 *
 * It is a thin orchestration layer over `GamificationModel`; all SQL and
 * transaction boundaries remain in the model so the existing
 * `gamification.service.unit.test.ts` mock contract stays intact.
 */
export class AchievementService {
  /**
   * List all active achievements, optionally filtered by category and rarity.
   */
  static async listAchievements(
    category?: AchievementCategory | string,
    rarity?: AchievementRarity | string,
  ): Promise<Achievement[]> {
    return await GamificationModel.getAllAchievements(category, rarity);
  }

  /**
   * Look up a single achievement definition by id.
   */
  static async getAchievementById(id: string): Promise<Achievement | null> {
    return await GamificationModel.getAchievementById(id);
  }

  /**
   * Admin: create or upsert an achievement definition.
   */
  static async createAchievement(data: Partial<Achievement>): Promise<Achievement> {
    return await GamificationModel.createAchievement(data);
  }

  /**
   * Attempt to unlock an achievement for a user.
   * Returns `{ unlocked: false }` if the user already has it or the
   * achievement does not exist.
   */
  static async unlockForUser(
    userId: string,
    achievementId: string,
  ): Promise<{ unlocked: boolean; achievement?: Achievement | null }> {
    const result = await GamificationModel.unlockAchievement(userId, achievementId);
    if (!result.unlocked) {
      return { unlocked: false };
    }
    const achievement = await GamificationModel.getAchievementById(achievementId);
    return { unlocked: true, achievement };
  }

  /**
   * List a user's earned achievement badges.
   */
  static async getUserAchievements(userId: string): Promise<Badge[]> {
    const progress = await GamificationModel.getUserProgress(userId);
    return progress.badges;
  }

  /**
   * Current profile badge showcase for a user.
   */
  static async getShowcase(userId: string): Promise<string[]> {
    const progress = await GamificationModel.getUserProgress(userId);
    return progress.showcase_badges ?? [];
  }

  /**
   * Update the profile badge showcase (max 5 badges, must be owned by user).
   */
  static async updateShowcase(userId: string, badgeIds: string[]): Promise<string[]> {
    return await GamificationModel.updateShowcaseBadges(userId, badgeIds);
  }

  /**
   * Evaluate all session-count achievements against a completed session count.
   *
   * This is the extraction of the inline loop that previously lived inside
   * `GamificationService.onSessionCompleted`. Behaviour is byte-for-byte
   * identical: iterate achievements in the order returned by the model,
   * attempt to unlock each whose `session_count` target is met, and collect
   * only those where the model reports a fresh unlock.
   */
  static async evaluateSessionAchievements(
    userId: string,
    completedSessionCount: number,
  ): Promise<Achievement[]> {
    const unlocked: Achievement[] = [];
    const allAchievements = await GamificationModel.getAllAchievements('sessions');

    for (const ach of allAchievements) {
      if (ach.criteria.type !== 'session_count') continue;
      if (completedSessionCount < ach.criteria.target) continue;

      const res = await GamificationModel.unlockAchievement(userId, ach.id);
      if (res.unlocked) {
        unlocked.push(ach);
      }
    }

    return unlocked;
  }

  /**
   * Evaluate a rating-based achievement (e.g. `5_star_review`).
   * Currently only 5-star reviews trigger an achievement; other ratings are
   * a no-op. Mirrors the existing inline logic in
   * `GamificationService.onReviewSubmitted`.
   */
  static async evaluateReviewAchievements(
    userId: string,
    rating: number,
  ): Promise<Achievement[]> {
    const unlocked: Achievement[] = [];

    if (rating === 5) {
      const res = await GamificationModel.unlockAchievement(userId, '5_star_review');
      if (res.unlocked) {
        const ach = await GamificationModel.getAchievementById('5_star_review');
        if (ach) unlocked.push(ach);
      }
    }

    return unlocked;
  }

  /**
   * Evaluate streak-based achievements (`streak_7`, `streak_30`).
   *
   * NOTE: `GamificationModel.updateStreak` already unlocks these inline, so
   * callers using that path do not need this method. It is provided for
   * callers that track streaks independently (e.g. the nightly
   * `streakTracking.job.ts` pipeline).
   */
  static async evaluateStreakAchievements(
    userId: string,
    streak: number,
  ): Promise<Achievement[]> {
    const unlocked: Achievement[] = [];

    if (streak >= 7) {
      const res = await GamificationModel.unlockAchievement(userId, 'streak_7');
      if (res.unlocked) {
        const ach = await GamificationModel.getAchievementById('streak_7');
        if (ach) unlocked.push(ach);
      }
    }
    if (streak >= 30) {
      const res = await GamificationModel.unlockAchievement(userId, 'streak_30');
      if (res.unlocked) {
        const ach = await GamificationModel.getAchievementById('streak_30');
        if (ach) unlocked.push(ach);
      }
    }

    return unlocked;
  }

  /**
   * Evaluate learning-path achievements for a user who just completed a
   * milestone. Mirrors the inline logic in
   * `GamificationService.onLearningMilestoneCompleted`.
   */
  static async evaluateLearningAchievements(userId: string): Promise<Achievement[]> {
    const unlocked: Achievement[] = [];

    const res = await GamificationModel.unlockAchievement(userId, 'learning_path_completed');
    if (res.unlocked) {
      const ach = await GamificationModel.getAchievementById('learning_path_completed');
      if (ach) unlocked.push(ach);
    }

    return unlocked;
  }

  /**
   * Convenience: log an achievement-related event for observability.
   * Kept here so callers have a single place to hook instrumentation.
   */
  static logUnlocks(userId: string, achievements: Achievement[], source: string): void {
    if (achievements.length === 0) return;
    logger.info('[AchievementService] Achievements unlocked', {
      userId,
      source,
      count: achievements.length,
      ids: achievements.map((a) => a.id),
    });
  }
}

export default AchievementService;
