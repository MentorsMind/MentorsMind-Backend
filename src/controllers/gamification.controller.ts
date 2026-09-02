import { Request, Response, NextFunction } from 'express';
import { GamificationService } from '../services/gamification.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

export class GamificationController {
  /**
   * Get current authenticated user's gamification progress
   */
  static async getMyProgress(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        res.status(401).json({ status: 'error', message: 'Unauthorized' });
        return;
      }

      const progress = await GamificationService.getUserProgress(userId);
      res.json({ status: 'success', data: progress });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get target user's public gamification progress
   */
  static async getUserProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const progress = await GamificationService.getUserProgress(userId);
      res.json({ status: 'success', data: progress });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get list of all available achievements
   */
  static async getAchievements(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { category, rarity } = req.query;
      const { GamificationModel } = await import('../models/gamification.model');
      const list = await GamificationModel.getAllAchievements(category as string, rarity as string);
      res.json({ status: 'success', data: list });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Record user activity / daily check-in
   */
  static async recordCheckIn(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        res.status(401).json({ status: 'error', message: 'Unauthorized' });
        return;
      }

      const streakData = await GamificationService.recordActivity(userId);
      res.json({ status: 'success', data: streakData });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get Leaderboards (mentors, mentees, skills)
   */
  static async getLeaderboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const type = (req.query.type as any) || 'mentor';
      const period = (req.query.period as any) || 'all-time';
      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;
      const skill = req.query.skill as string | undefined;

      const leaderboard = await GamificationService.getLeaderboard(type, period, limit, offset, skill);
      res.json({ status: 'success', data: leaderboard });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get daily/weekly active challenges and user progress
   */
  static async getChallenges(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        res.status(401).json({ status: 'error', message: 'Unauthorized' });
        return;
      }

      const challenges = await GamificationService.getUserChallenges(userId);
      res.json({ status: 'success', data: challenges });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Claim reward for a completed challenge
   */
  static async claimChallengeReward(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.user?.userId;
      const challengeId = req.params.id;

      if (!userId) {
        res.status(401).json({ status: 'error', message: 'Unauthorized' });
        return;
      }

      const result = await GamificationService.claimChallengeReward(userId, challengeId);
      if (!result.success) {
        res.status(400).json({ status: 'fail', message: 'Challenge reward not available or already claimed' });
        return;
      }

      res.json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update profile badge showcase
   */
  static async updateShowcase(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.user?.userId;
      const { badgeIds } = req.body;

      if (!userId) {
        res.status(401).json({ status: 'error', message: 'Unauthorized' });
        return;
      }

      if (!Array.isArray(badgeIds)) {
        res.status(400).json({ status: 'fail', message: 'badgeIds must be an array' });
        return;
      }

      const updatedShowcase = await GamificationService.updateShowcase(userId, badgeIds);
      res.json({ status: 'success', data: { showcase: updatedShowcase } });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get user reward logs (XLM, XP, discounts)
   */
  static async getUserRewardLogs(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        res.status(401).json({ status: 'error', message: 'Unauthorized' });
        return;
      }

      const logs = await GamificationService.getUserRewardLogs(userId);
      res.json({ status: 'success', data: logs });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Create achievement
   */
  static async adminCreateAchievement(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const achievement = await GamificationService.createAchievement(req.body);
      res.status(201).json({ status: 'success', data: achievement });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /users/:id/achievements (issue #984)
   * Public achievement badge list for any user.
   */
  static async getUserAchievements(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const normalizedUserId = typeof userId === 'string' ? userId : undefined;
      if (!normalizedUserId) {
        res.status(400).json({ status: 'error', message: 'userId is required' });
        return;
      }
      const { GamificationModel } = await import('../models/gamification.model');
      const progress = await GamificationModel.getUserProgress(normalizedUserId);
      res.json({ status: 'success', data: { userId: normalizedUserId, achievements: progress.badges } });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /users/me/streaks (issue #984)
   * Current user's streak summary (current, longest, last active date).
   */
  static async getMyStreaks(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (!userId) {
        res.status(401).json({ status: 'error', message: 'Unauthorized' });
        return;
      }
      const { GamificationModel } = await import('../models/gamification.model');
      const progress = await GamificationModel.getUserProgress(userId);
      res.json({
        status: 'success',
        data: {
          userId,
          currentStreak: progress.streak,
          longestStreak: progress.streak,
          lastActivityDate: progress.last_activity_date ?? null,
          streakFreezeCount: progress.streak_freeze_count ?? 0,
          nextMilestone: progress.streak >= 30 ? null : (progress.streak >= 7 ? 30 : 7),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /leaderboard (issue #984)
   * Leaderboard by category (sessions) and period (monthly).
   * Supports ?category=sessions&period=monthly weekday aliases.
   */
  static async getGamificationLeaderboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = (req.query.category as string) || 'mentor';
      let period = (req.query.period as string) || 'all-time';
      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;

      // Map issue-specified query shapes to the model's supported inputs.
      if (period === 'monthly') period = 'monthly';
      if (period === 'weekly') period = 'weekly';

      let type: 'mentor' | 'mentee' | 'skill' = 'mentor';
      if (category === 'sessions' || category === 'mentors') type = 'mentor';
      else if (category === 'mentees') type = 'mentee';
      else if (category === 'skills') type = 'skill';

      const leaderboard = await GamificationService.getLeaderboard(
        type,
        period as any,
        limit,
        offset,
        req.query.skill as string | undefined,
      );
      res.json({ status: 'success', data: leaderboard });
    } catch (err) {
      next(err);
    }
  }
}
