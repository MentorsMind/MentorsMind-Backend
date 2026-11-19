import {
  GamificationModel,
  Leaderboard,
  LeaderboardType,
  LeaderboardPeriod,
} from '../models/gamification.model';

/**
 * Category aliases accepted by the gamification HTTP layer.
 * `sessions` and `mentors` both map to the `mentor` leaderboard; `mentees`
 * maps to `mentee`; `skills` maps to `skill`.
 */
export type LeaderboardCategory =
  | 'sessions'
  | 'mentors'
  | 'mentees'
  | 'skills'
  | LeaderboardType;

/**
 * LeaderboardService
 *
 * Owns leaderboard reads and the category-alias normalisation used by the
 * gamification controller (`getGamificationLeaderboard`).
 *
 * It is a thin orchestration layer over `GamificationModel.getLeaderboard`,
 * which already supports time-window filtering (daily/weekly/monthly/all-time)
 * and skill filtering.
 */
export class LeaderboardService {
  /**
   * Read a leaderboard directly by its canonical type/period.
   */
  static async getLeaderboard(
    type: LeaderboardType = 'mentor',
    period: LeaderboardPeriod = 'all-time',
    limit: number = 20,
    offset: number = 0,
    skillName?: string,
  ): Promise<Leaderboard> {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

    return await GamificationModel.getLeaderboard(
      type,
      period,
      safeLimit,
      safeOffset,
      skillName,
    );
  }

  /**
   * Normalise an HTTP-facing category string into the model's supported
   * `LeaderboardType`. Unknown values fall back to `mentor`, matching the
   * controller's previous behaviour.
   */
  static normalizeCategory(category?: string): LeaderboardType {
    switch (category) {
      case 'sessions':
      case 'mentors':
      case 'mentor':
        return 'mentor';
      case 'mentees':
      case 'mentee':
        return 'mentee';
      case 'skills':
      case 'skill':
        return 'skill';
      default:
        return 'mentor';
    }
  }

  /**
   * Normalise a period string. Only the four canonical values are accepted;
   * anything else falls back to `all-time`.
   */
  static normalizePeriod(period?: string): LeaderboardPeriod {
    switch (period) {
      case 'daily':
        return 'daily';
      case 'weekly':
        return 'weekly';
      case 'monthly':
        return 'monthly';
      case 'all-time':
      case 'all_time':
      case 'alltime':
        return 'all-time';
      default:
        return 'all-time';
    }
  }

  /**
   * Read a leaderboard by HTTP-facing category + period aliases.
   * Preserves the exact alias mapping used by
   * `GamificationController.getGamificationLeaderboard`.
   */
  static async getLeaderboardByCategory(
    category?: string,
    period?: string,
    limit: number = 20,
    offset: number = 0,
    skillName?: string,
  ): Promise<Leaderboard> {
    const type = this.normalizeCategory(category);
    const normalizedPeriod = this.normalizePeriod(period);
    return await this.getLeaderboard(type, normalizedPeriod, limit, offset, skillName);
  }
}

export default LeaderboardService;
