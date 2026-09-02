import db from '../config/db';

export type AchievementCategory = 'sessions' | 'learning' | 'social' | 'special';
export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface AchievementCriteria {
  type: 'session_count' | 'streak_days' | 'review_rating' | 'learning_milestones' | 'challenge_count' | 'custom';
  target: number;
  metric?: string;
  [key: string]: any;
}

export interface Reward {
  type: 'xp' | 'xlm' | 'discount' | 'badge';
  value: number;
  currency?: string;
  metadata?: Record<string, any>;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  unlockedAt: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  criteria: AchievementCriteria;
  reward: Reward;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface UserProgress {
  userId: string;
  level: number;
  xp: number;
  xpToNextLevel: number;
  achievements: string[];
  badges: Badge[];
  streak: number;
  rank: number;
  last_activity_date?: string | null;
  streak_freeze_count?: number;
  showcase_badges?: string[];
}

export type LeaderboardType = 'mentor' | 'mentee' | 'skill';
export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'all-time';

export interface LeaderboardEntry {
  userId: string;
  name: string;
  avatarUrl?: string;
  score: number;
  rank: number;
  level: number;
  badgesCount: number;
  role?: string;
  skillName?: string;
}

export interface Leaderboard {
  type: LeaderboardType;
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  total?: number;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly';
  goal_count: number;
  category: string;
  criteria: AchievementCriteria;
  reward: Reward;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
  created_at?: string;
}

export interface UserChallengeProgress {
  id: string;
  userId: string;
  challengeId: string;
  currentCount: number;
  completed: boolean;
  completedAt?: string;
  rewardClaimed: boolean;
  challenge?: Challenge;
}

export interface RewardLog {
  id: string;
  userId: string;
  rewardType: 'xp' | 'xlm' | 'discount' | 'badge';
  amount: number;
  source: 'achievement' | 'challenge' | 'streak' | 'level_up' | 'manual';
  sourceId?: string;
  status: 'granted' | 'claimed' | 'failed';
  metadata?: Record<string, any>;
  createdAt: string;
}

export class GamificationModel {
  /**
   * Calculate level and XP required for next level
   */
  static calculateLevelAndNextXP(xp: number): { level: number; xpToNextLevel: number } {
    const numericXp = Math.max(0, Number(xp) || 0);
    const level = Math.floor(Math.sqrt(numericXp / 100)) + 1;
    const nextLevelTarget = Math.pow(level, 2) * 100;
    const xpToNextLevel = nextLevelTarget - numericXp;
    return { level, xpToNextLevel };
  }

  /**
   * Get all active achievements
   */
  static async getAllAchievements(category?: string, rarity?: string): Promise<Achievement[]> {
    let query = 'SELECT * FROM achievements WHERE is_active = TRUE';
    const params: any[] = [];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    if (rarity) {
      params.push(rarity);
      query += ` AND rarity = $${params.length}`;
    }

    query += ' ORDER BY created_at ASC';
    const result = await db.query(query, params);
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      rarity: row.rarity,
      criteria: row.criteria,
      reward: row.reward,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  /**
   * Get achievement by ID
   */
  static async getAchievementById(id: string): Promise<Achievement | null> {
    const result = await db.query('SELECT * FROM achievements WHERE id = $1', [id]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      rarity: row.rarity,
      criteria: row.criteria,
      reward: row.reward,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Create achievement
   */
  static async createAchievement(data: Partial<Achievement>): Promise<Achievement> {
    const { id, name, description, icon, category, rarity, criteria, reward } = data;
    const result = await db.query(
      `INSERT INTO achievements (id, name, description, icon, category, rarity, criteria, reward)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         icon = EXCLUDED.icon,
         category = EXCLUDED.category,
         rarity = EXCLUDED.rarity,
         criteria = EXCLUDED.criteria,
         reward = EXCLUDED.reward,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [id, name, description, icon, category, rarity, JSON.stringify(criteria || {}), JSON.stringify(reward || {})],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      rarity: row.rarity,
      criteria: row.criteria,
      reward: row.reward,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Get or initialize user progress
   */
  static async getUserProgress(userId: string): Promise<UserProgress> {
    let result = await db.query(
      'SELECT * FROM user_gamification_progress WHERE user_id = $1',
      [userId],
    );

    if (result.rows.length === 0) {
      await db.query(
        `INSERT INTO user_gamification_progress (user_id, level, xp, streak, streak_freeze_count, showcase_badges)
         VALUES ($1, 1, 0, 0, 0, '[]'::jsonb)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId],
      );
      result = await db.query(
        'SELECT * FROM user_gamification_progress WHERE user_id = $1',
        [userId],
      );
    }

    const row = result.rows[0] || { level: 1, xp: '0', streak: 0, last_activity_date: null, streak_freeze_count: 0, showcase_badges: [] };
    const xp = Number(row.xp) || 0;
    const { level, xpToNextLevel } = this.calculateLevelAndNextXP(xp);

    // Get user unlocked achievements & badges
    const achievementsResult = await db.query(
      `SELECT a.*, ua.unlocked_at
       FROM user_achievements ua
       JOIN achievements a ON ua.achievement_id = a.id
       WHERE ua.user_id = $1
       ORDER BY ua.unlocked_at DESC`,
      [userId],
    );

    const unlockedAchievementIds = achievementsResult.rows.map(r => r.id);
    const badges: Badge[] = achievementsResult.rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      icon: r.icon,
      category: r.category,
      unlockedAt: r.unlocked_at,
    }));

    // Calculate user overall rank by XP
    const rankResult = await db.query(
      `SELECT COUNT(*) + 1 as rank
       FROM user_gamification_progress
       WHERE xp > $1`,
      [xp],
    );

    const rank = parseInt(rankResult.rows[0]?.rank || '1', 10);

    return {
      userId,
      level,
      xp,
      xpToNextLevel,
      achievements: unlockedAchievementIds,
      badges,
      streak: row.streak || 0,
      rank,
      last_activity_date: row.last_activity_date ? row.last_activity_date.toISOString().split('T')[0] : null,
      streak_freeze_count: row.streak_freeze_count || 0,
      showcase_badges: Array.isArray(row.showcase_badges) ? row.showcase_badges : [],
    };
  }

  /**
   * Add XP to user and update level
   */
  static async addXP(userId: string, amount: number, source: 'achievement' | 'challenge' | 'streak' | 'level_up' | 'manual', sourceId?: string): Promise<{ xp: number; level: number; leveledUp: boolean }> {
    const currentProgress = await this.getUserProgress(userId);
    const newXP = currentProgress.xp + amount;
    const { level: newLevel } = this.calculateLevelAndNextXP(newXP);
    const leveledUp = newLevel > currentProgress.level;

    await db.query(
      `UPDATE user_gamification_progress
       SET xp = $1, level = $2, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $3`,
      [newXP, newLevel, userId],
    );

    if (amount > 0) {
      await this.logReward(userId, 'xp', amount, source, sourceId, { newLevel, newXP, leveledUp });
    }

    if (leveledUp) {
      await this.logReward(userId, 'xp', 0, 'level_up', `level_${newLevel}`, { level: newLevel });
    }

    return { xp: newXP, level: newLevel, leveledUp };
  }

  /**
   * Unlock achievement for user
   */
  static async unlockAchievement(userId: string, achievementId: string): Promise<{ unlocked: boolean; reward?: Reward }> {
    const achievement = await this.getAchievementById(achievementId);
    if (!achievement) return { unlocked: false };

    const existing = await db.query(
      'SELECT id FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
      [userId, achievementId],
    );

    if (existing.rows.length > 0) {
      return { unlocked: false };
    }

    await db.query(
      `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [userId, achievementId],
    );

    // Grant reward if XP or XLM or Discount
    if (achievement.reward && achievement.reward.type) {
      if (achievement.reward.type === 'xp' && achievement.reward.value > 0) {
        await this.addXP(userId, achievement.reward.value, 'achievement', achievementId);
      } else if (achievement.reward.type === 'xlm' || achievement.reward.type === 'discount') {
        await this.logReward(userId, achievement.reward.type, achievement.reward.value, 'achievement', achievementId, achievement.reward.metadata || {});
      }
    }

    return { unlocked: true, reward: achievement.reward };
  }

  /**
   * Update activity streak
   */
  static async updateStreak(userId: string): Promise<{ streak: number; streakIncreased: boolean; streakReset: boolean }> {
    const progress = await this.getUserProgress(userId);
    const today = new Date().toISOString().split('T')[0];
    const lastDateStr = progress.last_activity_date;

    if (lastDateStr === today) {
      return { streak: progress.streak, streakIncreased: false, streakReset: false };
    }

    let newStreak = progress.streak;
    let streakIncreased = false;
    let streakReset = false;

    if (lastDateStr) {
      const lastDate = new Date(lastDateStr);
      const currentDate = new Date(today);
      const diffTime = Math.abs(currentDate.getTime() - lastDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        newStreak += 1;
        streakIncreased = true;
      } else if (diffDays > 1) {
        if ((progress.streak_freeze_count || 0) > 0) {
          // Use a streak freeze
          await db.query(
            'UPDATE user_gamification_progress SET streak_freeze_count = streak_freeze_count - 1 WHERE user_id = $1',
            [userId],
          );
        } else {
          newStreak = 1;
          streakReset = true;
        }
      }
    } else {
      newStreak = 1;
      streakIncreased = true;
    }

    await db.query(
      `UPDATE user_gamification_progress
       SET streak = $1, last_activity_date = $2, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $3`,
      [newStreak, today, userId],
    );

    // Reward daily active XP
    await this.addXP(userId, 20, 'streak', `daily_${today}`);

    // Check streak achievements
    if (newStreak >= 7) {
      await this.unlockAchievement(userId, 'streak_7');
    }
    if (newStreak >= 30) {
      await this.unlockAchievement(userId, 'streak_30');
    }

    return { streak: newStreak, streakIncreased, streakReset };
  }

  /**
   * Update profile showcase badges
   */
  static async updateShowcaseBadges(userId: string, badgeIds: string[]): Promise<string[]> {
    // Validate that user owns these badges
    const result = await db.query(
      `SELECT achievement_id FROM user_achievements
       WHERE user_id = $1 AND achievement_id = ANY($2)`,
      [userId, badgeIds],
    );

    const validBadgeIds = result.rows.map(r => r.achievement_id);
    const limitedBadgeIds = validBadgeIds.slice(0, 5); // Max 5 showcase badges

    await db.query(
      `UPDATE user_gamification_progress
       SET showcase_badges = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [JSON.stringify(limitedBadgeIds), userId],
    );

    return limitedBadgeIds;
  }

  /**
   * Get Leaderboards (mentors, mentees, skills)
   */
  static async getLeaderboard(
    type: LeaderboardType = 'mentor',
    period: LeaderboardPeriod = 'all-time',
    limit: number = 20,
    offset: number = 0,
    skillName?: string,
  ): Promise<Leaderboard> {
    let query = '';
    const params: any[] = [];

    // Filter time window if needed
    let dateFilter = '';
    if (period === 'daily') {
      dateFilter = "AND p.updated_at >= NOW() - INTERVAL '1 day'";
    } else if (period === 'weekly') {
      dateFilter = "AND p.updated_at >= NOW() - INTERVAL '7 days'";
    } else if (period === 'monthly') {
      dateFilter = "AND p.updated_at >= NOW() - INTERVAL '30 days'";
    }

    if (type === 'skill') {
      params.push(limit, offset);
      let skillWhere = '';
      if (skillName) {
        params.push(`%${skillName.toLowerCase()}%`);
        skillWhere = `AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(u.expertise, '{}'::text[])) AS exp
          WHERE lower(exp) LIKE $${params.length}
        )`;
      }

      query = `
        SELECT
          u.id as user_id,
          CONCAT(u.first_name, ' ', u.last_name) as name,
          u.avatar_url,
          u.role,
          COALESCE(p.xp, 0) as score,
          COALESCE(p.level, 1) as level,
          (SELECT COUNT(*) FROM user_achievements ua WHERE ua.user_id = u.id) as badges_count,
          COALESCE(u.expertise[1], 'General') as skill_name
        FROM users u
        LEFT JOIN user_gamification_progress p ON u.id = p.user_id
        WHERE u.is_active = TRUE ${skillWhere} ${dateFilter}
        ORDER BY score DESC, level DESC
        LIMIT $1 OFFSET $2
      `;
    } else {
      const roleFilter = type === 'mentor' ? "u.role = 'mentor'" : "u.role = 'mentee' OR u.role = 'learner'";
      params.push(limit, offset);

      query = `
        SELECT
          u.id as user_id,
          CONCAT(u.first_name, ' ', u.last_name) as name,
          u.avatar_url,
          u.role,
          COALESCE(p.xp, 0) as score,
          COALESCE(p.level, 1) as level,
          (SELECT COUNT(*) FROM user_achievements ua WHERE ua.user_id = u.id) as badges_count
        FROM users u
        JOIN user_gamification_progress p ON u.id = p.user_id
        WHERE ${roleFilter} AND u.is_active = TRUE ${dateFilter}
        ORDER BY score DESC, level DESC
        LIMIT $1 OFFSET $2
      `;
    }

    const result = await db.query(query, params);

    const entries: LeaderboardEntry[] = result.rows.map((row, idx) => ({
      userId: row.user_id,
      name: row.name ? row.name.trim() : 'Anonymous',
      avatarUrl: row.avatar_url || undefined,
      score: Number(row.score) || 0,
      rank: offset + idx + 1,
      level: Number(row.level) || 1,
      badgesCount: parseInt(row.badges_count || '0', 10),
      role: row.role,
      skillName: row.skill_name,
    }));

    return {
      type,
      period,
      entries,
      total: entries.length,
    };
  }

  /**
   * Get Active Challenges
   */
  static async getActiveChallenges(type?: 'daily' | 'weekly'): Promise<Challenge[]> {
    let query = 'SELECT * FROM challenges WHERE is_active = TRUE';
    const params: any[] = [];

    if (type) {
      params.push(type);
      query += ` AND type = $${params.length}`;
    }

    query += ' ORDER BY created_at DESC';
    const result = await db.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      type: row.type,
      goal_count: row.goal_count,
      category: row.category,
      criteria: row.criteria,
      reward: row.reward,
      start_date: row.start_date,
      end_date: row.end_date,
      is_active: row.is_active,
      created_at: row.created_at,
    }));
  }

  /**
   * Get user progress for active challenges
   */
  static async getUserChallenges(userId: string): Promise<UserChallengeProgress[]> {
    const challenges = await this.getActiveChallenges();
    const result: UserChallengeProgress[] = [];

    for (const ch of challenges) {
      const userProgress = await db.query(
        'SELECT * FROM user_challenge_progress WHERE user_id = $1 AND challenge_id = $2',
        [userId, ch.id],
      );

      if (userProgress.rows.length === 0) {
        result.push({
          id: '',
          userId,
          challengeId: ch.id,
          currentCount: 0,
          completed: false,
          rewardClaimed: false,
          challenge: ch,
        });
      } else {
        const row = userProgress.rows[0];
        result.push({
          id: row.id,
          userId: row.user_id,
          challengeId: row.challenge_id,
          currentCount: row.current_count,
          completed: row.completed,
          completedAt: row.completed_at,
          rewardClaimed: row.reward_claimed,
          challenge: ch,
        });
      }
    }

    return result;
  }

  /**
   * Update challenge progress
   */
  static async updateChallengeProgress(
    userId: string,
    challengeId: string,
    increment: number = 1,
  ): Promise<UserChallengeProgress> {
    const challenge = await db.query('SELECT * FROM challenges WHERE id = $1', [challengeId]);
    if (!challenge.rows[0]) {
      throw new Error('Challenge not found');
    }

    const ch: Challenge = challenge.rows[0];
    const existing = await db.query(
      'SELECT * FROM user_challenge_progress WHERE user_id = $1 AND challenge_id = $2',
      [userId, challengeId],
    );

    let currentCount = increment;
    let completed = false;
    let completedAt: string | undefined = undefined;

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.completed) {
        return {
          id: row.id,
          userId: row.user_id,
          challengeId: row.challenge_id,
          currentCount: row.current_count,
          completed: true,
          completedAt: row.completed_at,
          rewardClaimed: row.reward_claimed,
          challenge: ch,
        };
      }
      currentCount = row.current_count + increment;
    }

    if (currentCount >= ch.goal_count) {
      completed = true;
      completedAt = new Date().toISOString();
    }

    const upsertResult = await db.query(
      `INSERT INTO user_challenge_progress (user_id, challenge_id, current_count, completed, completed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, challenge_id) DO UPDATE SET
         current_count = EXCLUDED.current_count,
         completed = EXCLUDED.completed,
         completed_at = EXCLUDED.completed_at,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, challengeId, currentCount, completed, completedAt],
    );

    const row = upsertResult.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      challengeId: row.challenge_id,
      currentCount: row.current_count,
      completed: row.completed,
      completedAt: row.completed_at,
      rewardClaimed: row.reward_claimed,
      challenge: ch,
    };
  }

  /**
   * Claim Challenge Reward
   */
  static async claimChallengeReward(userId: string, challengeId: string): Promise<{ success: boolean; reward?: Reward }> {
    const progress = await db.query(
      `SELECT ucp.*, c.reward
       FROM user_challenge_progress ucp
       JOIN challenges c ON ucp.challenge_id = c.id
       WHERE ucp.user_id = $1 AND ucp.challenge_id = $2`,
      [userId, challengeId],
    );

    if (!progress.rows[0]) {
      return { success: false };
    }

    const row = progress.rows[0];
    if (!row.completed || row.reward_claimed) {
      return { success: false };
    }

    await db.query(
      `UPDATE user_challenge_progress
       SET reward_claimed = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND challenge_id = $2`,
      [userId, challengeId],
    );

    const reward: Reward = row.reward;
    if (reward && reward.type) {
      if (reward.type === 'xp' && reward.value > 0) {
        await this.addXP(userId, reward.value, 'challenge', challengeId);
      } else {
        await this.logReward(userId, reward.type, reward.value, 'challenge', challengeId, reward.metadata || {});
      }
    }

    return { success: true, reward };
  }

  /**
   * Log Reward transaction
   */
  static async logReward(
    userId: string,
    rewardType: 'xp' | 'xlm' | 'discount' | 'badge',
    amount: number,
    source: 'achievement' | 'challenge' | 'streak' | 'level_up' | 'manual',
    sourceId?: string,
    metadata?: Record<string, any>,
  ): Promise<RewardLog> {
    const result = await db.query(
      `INSERT INTO rewards_log (user_id, reward_type, amount, source, source_id, status, metadata)
       VALUES ($1, $2, $3, $4, $5, 'granted', $6)
       RETURNING *`,
      [userId, rewardType, amount, source, sourceId, JSON.stringify(metadata || {})],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      rewardType: row.reward_type,
      amount: Number(row.amount),
      source: row.source,
      sourceId: row.source_id,
      status: row.status,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }

  /**
   * Get user reward logs
   */
  static async getUserRewardLogs(userId: string): Promise<RewardLog[]> {
    const result = await db.query(
      'SELECT * FROM rewards_log WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      rewardType: row.reward_type,
      amount: Number(row.amount),
      source: row.source,
      sourceId: row.source_id,
      status: row.status,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }
}
