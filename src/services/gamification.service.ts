import {
  GamificationModel,
  UserProgress,
  Achievement,
  Leaderboard,
  LeaderboardType,
  LeaderboardPeriod,
  UserChallengeProgress,
  RewardLog,
  Reward,
} from '../models/gamification.model';
import { logger } from '../utils/logger';

export class GamificationService {
  /**
   * Get user gamification progress summary
   */
  static async getUserProgress(userId: string): Promise<UserProgress> {
    return await GamificationModel.getUserProgress(userId);
  }

  /**
   * Record user activity / daily check-in
   */
  static async recordActivity(userId: string): Promise<{ streak: number; streakIncreased: boolean; streakReset: boolean }> {
    const result = await GamificationModel.updateStreak(userId);

    // Trigger push notifications on streak milestones (issue #984).
    // Idempotent: each milestone is announced at most once per user.
    if (result.streakIncreased && [7, 30, 60, 100].includes(result.streak)) {
      await this.announceStreakMilestone(userId, result.streak);
    }

    return result;
  }

  /**
   * Fire a streak-milestone push notification exactly once per (user, milestone).
   * Best-effort: failures are logged and never fail the check-in.
   */
  private static async announceStreakMilestone(
    userId: string,
    milestone: number,
  ): Promise<void> {
    try {
      const db = (await import('../config/db')).default;
      const { rows } = await db.query(
        `SELECT 1 FROM streak_milestone_notifications
         WHERE user_id = $1 AND milestone = $2`,
        [userId, milestone],
      );

      if (rows.length > 0) {
        return; // already announced
      }

      const { PushService } = await import('./push.service');
      await PushService.sendStreakMilestone(userId, milestone);

      await db.query(
        `INSERT INTO streak_milestone_notifications (user_id, milestone)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, milestone],
      );

      logger.info(`[GamificationService] Announced streak milestone`, {
        userId,
        milestone,
      });
    } catch (error) {
      logger.error(`[GamificationService] Failed to announce streak milestone`, {
        userId,
        milestone,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Handle session completion event to award XP, unlock achievements, and update challenges
   */
  static async onSessionCompleted(
    userId: string,
    role: string = 'mentee',
    metadata: Record<string, any> = {},
  ): Promise<{ xpGained: number; level: number; unlockedAchievements: Achievement[] }> {
    const baseXP = role === 'mentor' ? 150 : 100;
    const { level } = await GamificationModel.addXP(userId, baseXP, 'manual', 'session_completed');

    // Update daily activity streak
    await GamificationModel.updateStreak(userId);

    // Count user total completed sessions
    const progress = await GamificationModel.getUserProgress(userId);
    const completedSessionCount = progress.badges.filter(b => b.category === 'sessions').length + 1;

    const unlockedAchievements: Achievement[] = [];

    // Evaluate session achievements
    const allAchievements = await GamificationModel.getAllAchievements('sessions');
    for (const ach of allAchievements) {
      if (ach.criteria.type === 'session_count') {
        const target = ach.criteria.target;
        // If progress achievement applies
        if (completedSessionCount >= target) {
          const res = await GamificationModel.unlockAchievement(userId, ach.id);
          if (res.unlocked) {
            unlockedAchievements.push(ach);
          }
        }
      }
    }

    // Update session challenges
    const activeChallenges = await GamificationModel.getActiveChallenges();
    for (const ch of activeChallenges) {
      if (ch.category === 'sessions' || ch.criteria.type === 'session_count') {
        await GamificationModel.updateChallengeProgress(userId, ch.id, 1);
      }
    }

    logger.info(`[GamificationService] Session completed for user ${userId}, gained ${baseXP} XP`);
    return { xpGained: baseXP, level, unlockedAchievements };
  }

  /**
   * Handle review submitted event
   */
  static async onReviewSubmitted(
    mentorId: string,
    rating: number,
  ): Promise<{ xpGained: number; unlockedAchievements: Achievement[] }> {
    let xpGained = 20;
    if (rating === 5) {
      xpGained = 50;
    }
    await GamificationModel.addXP(mentorId, xpGained, 'manual', 'review_received');

    const unlockedAchievements: Achievement[] = [];

    if (rating === 5) {
      const res = await GamificationModel.unlockAchievement(mentorId, '5_star_review');
      if (res.unlocked) {
        const ach = await GamificationModel.getAchievementById('5_star_review');
        if (ach) unlockedAchievements.push(ach);
      }
    }

    return { xpGained, unlockedAchievements };
  }

  /**
   * Handle learning milestone completion
   */
  static async onLearningMilestoneCompleted(
    userId: string,
    milestoneId: string,
  ): Promise<{ xpGained: number; unlockedAchievements: Achievement[] }> {
    const xpGained = 100;
    await GamificationModel.addXP(userId, xpGained, 'manual', `milestone_${milestoneId}`);

    const unlockedAchievements: Achievement[] = [];
    const res = await GamificationModel.unlockAchievement(userId, 'learning_path_completed');
    if (res.unlocked) {
      const ach = await GamificationModel.getAchievementById('learning_path_completed');
      if (ach) unlockedAchievements.push(ach);
    }

    return { xpGained, unlockedAchievements };
  }

  /**
   * Get Leaderboards
   */
  static async getLeaderboard(
    type: LeaderboardType = 'mentor',
    period: LeaderboardPeriod = 'all-time',
    limit: number = 20,
    offset: number = 0,
    skillName?: string,
  ): Promise<Leaderboard> {
    return await GamificationModel.getLeaderboard(type, period, limit, offset, skillName);
  }

  /**
   * Get active challenges and user progress
   */
  static async getUserChallenges(userId: string): Promise<UserChallengeProgress[]> {
    return await GamificationModel.getUserChallenges(userId);
  }

  /**
   * Claim reward for a completed challenge
   */
  static async claimChallengeReward(userId: string, challengeId: string): Promise<{ success: boolean; reward?: Reward }> {
    return await GamificationModel.claimChallengeReward(userId, challengeId);
  }

  /**
   * Update badge showcase on profile
   */
  static async updateShowcase(userId: string, badgeIds: string[]): Promise<string[]> {
    return await GamificationModel.updateShowcaseBadges(userId, badgeIds);
  }

  /**
   * Get user reward transaction log
   */
  static async getUserRewardLogs(userId: string): Promise<RewardLog[]> {
    return await GamificationModel.getUserRewardLogs(userId);
  }

  /**
   * Admin: create custom achievement
   */
  static async createAchievement(data: Partial<Achievement>): Promise<Achievement> {
    return await GamificationModel.createAchievement(data);
  }
}
