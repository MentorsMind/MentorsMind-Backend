jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
  db: {
    query: jest.fn(),
  },
}));

jest.mock('../push.service', () => ({
  PushService: {
    sendStreakMilestone: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../models/gamification.model', () => {
  return {
    GamificationModel: {
      calculateLevelAndNextXP: jest.fn((xp: number) => {
        const numericXp = Math.max(0, Number(xp) || 0);
        const level = Math.floor(Math.sqrt(numericXp / 100)) + 1;
        const nextLevelTarget = Math.pow(level, 2) * 100;
        const xpToNextLevel = nextLevelTarget - numericXp;
        return { level, xpToNextLevel };
      }),
      getUserProgress: jest.fn(),
      addXP: jest.fn(),
      unlockAchievement: jest.fn(),
      updateStreak: jest.fn(),
      updateShowcaseBadges: jest.fn(),
      getAllAchievements: jest.fn(),
      getAchievementById: jest.fn(),
      getLeaderboard: jest.fn(),
      getActiveChallenges: jest.fn(),
      getUserChallenges: jest.fn(),
      updateChallengeProgress: jest.fn(),
      claimChallengeReward: jest.fn(),
      logReward: jest.fn(),
      getUserRewardLogs: jest.fn(),
      createAchievement: jest.fn(),
    },
  };
});

import { GamificationModel, Achievement } from '../../models/gamification.model';
import { GamificationService } from '../gamification.service';
import { PushService } from '../push.service';
import db from '../../config/db';

describe('GamificationService - Point Calculation & Gamification Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Level and Next XP calculation', () => {
    it('calculates level 1 for 0 XP with 100 XP to next level', () => {
      const result = GamificationModel.calculateLevelAndNextXP(0);
      expect(result.level).toBe(1);
      expect(result.xpToNextLevel).toBe(100);
    });

    it('calculates level 1 for 50 XP with 50 XP to next level', () => {
      const result = GamificationModel.calculateLevelAndNextXP(50);
      expect(result.level).toBe(1);
      expect(result.xpToNextLevel).toBe(50);
    });

    it('calculates level 2 for 100 XP with 300 XP to next level (target 400)', () => {
      const result = GamificationModel.calculateLevelAndNextXP(100);
      expect(result.level).toBe(2);
      expect(result.xpToNextLevel).toBe(300);
    });

    it('calculates level 2 for 150 XP with 250 XP to next level', () => {
      const result = GamificationModel.calculateLevelAndNextXP(150);
      expect(result.level).toBe(2);
      expect(result.xpToNextLevel).toBe(250);
    });

    it('calculates level 3 for 400 XP with 500 XP to next level (target 900)', () => {
      const result = GamificationModel.calculateLevelAndNextXP(400);
      expect(result.level).toBe(3);
      expect(result.xpToNextLevel).toBe(500);
    });
  });

  describe('Session completed point calculations', () => {
    it('awards exactly 150 base XP when mentor completes a session', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
        xp: 150,
        level: 2,
        leveledUp: true,
      });
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 3,
        streakIncreased: true,
        streakReset: false,
      });
      (GamificationModel.getUserProgress as jest.Mock).mockResolvedValueOnce({
        userId: 'mentor-1',
        level: 2,
        xp: 150,
        xpToNextLevel: 250,
        achievements: [],
        badges: [],
        streak: 3,
        rank: 1,
      });
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce([]);
      (GamificationModel.getActiveChallenges as jest.Mock).mockResolvedValueOnce([]);

      const result = await GamificationService.onSessionCompleted('mentor-1', 'mentor');

      expect(GamificationModel.addXP).toHaveBeenCalledWith(
        'mentor-1',
        150,
        'manual',
        'session_completed',
      );
      expect(result.xpGained).toBe(150);
      expect(result.level).toBe(2);
      expect(GamificationModel.updateStreak).toHaveBeenCalledWith('mentor-1');
    });

    it('awards exactly 100 base XP when mentee completes a session', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
        xp: 100,
        level: 2,
        leveledUp: true,
      });
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 1,
        streakIncreased: true,
        streakReset: false,
      });
      (GamificationModel.getUserProgress as jest.Mock).mockResolvedValueOnce({
        userId: 'mentee-1',
        level: 2,
        xp: 100,
        xpToNextLevel: 300,
        achievements: [],
        badges: [],
        streak: 1,
        rank: 2,
      });
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce([]);
      (GamificationModel.getActiveChallenges as jest.Mock).mockResolvedValueOnce([]);

      const result = await GamificationService.onSessionCompleted('mentee-1', 'mentee');

      expect(GamificationModel.addXP).toHaveBeenCalledWith(
        'mentee-1',
        100,
        'manual',
        'session_completed',
      );
      expect(result.xpGained).toBe(100);
      expect(result.level).toBe(2);
    });

    it('defaults to 100 base XP when role is not specified', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
        xp: 100,
        level: 2,
        leveledUp: false,
      });
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 1,
        streakIncreased: false,
        streakReset: false,
      });
      (GamificationModel.getUserProgress as jest.Mock).mockResolvedValueOnce({
        userId: 'user-default',
        level: 2,
        xp: 100,
        xpToNextLevel: 300,
        achievements: [],
        badges: [],
        streak: 1,
        rank: 5,
      });
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce([]);
      (GamificationModel.getActiveChallenges as jest.Mock).mockResolvedValueOnce([]);

      const result = await GamificationService.onSessionCompleted('user-default');

      expect(GamificationModel.addXP).toHaveBeenCalledWith(
        'user-default',
        100,
        'manual',
        'session_completed',
      );
      expect(result.xpGained).toBe(100);
    });
  });

  describe('Review submitted point calculations', () => {
    it('awards exactly 50 XP when mentor receives a 5-star review', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
        xp: 50,
        level: 1,
        leveledUp: false,
      });
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({
        unlocked: true,
      });
      (GamificationModel.getAchievementById as jest.Mock).mockResolvedValueOnce({
        id: '5_star_review',
        name: 'Crowd Favorite',
        description: 'Receive 5 star review',
        icon: 'star-5',
        category: 'social',
        rarity: 'epic',
        criteria: { type: 'review_rating', target: 5 },
        reward: { type: 'xp', value: 250 },
      });

      const result = await GamificationService.onReviewSubmitted('mentor-1', 5);

      expect(GamificationModel.addXP).toHaveBeenCalledWith(
        'mentor-1',
        50,
        'manual',
        'review_received',
      );
      expect(result.xpGained).toBe(50);
      expect(GamificationModel.unlockAchievement).toHaveBeenCalledWith(
        'mentor-1',
        '5_star_review',
      );
      expect(result.unlockedAchievements).toHaveLength(1);
      expect(result.unlockedAchievements[0].id).toBe('5_star_review');
    });

    it('awards exactly 20 XP when mentor receives a 4-star review (less than 5)', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
        xp: 20,
        level: 1,
        leveledUp: false,
      });

      const result = await GamificationService.onReviewSubmitted('mentor-1', 4);

      expect(GamificationModel.addXP).toHaveBeenCalledWith(
        'mentor-1',
        20,
        'manual',
        'review_received',
      );
      expect(result.xpGained).toBe(20);
      expect(GamificationModel.unlockAchievement).not.toHaveBeenCalled();
      expect(result.unlockedAchievements).toHaveLength(0);
    });

    it('awards exactly 20 XP for 1-star, 2-star, and 3-star reviews', async () => {
      for (const rating of [1, 2, 3]) {
        (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
          xp: 20,
          level: 1,
          leveledUp: false,
        });

        const result = await GamificationService.onReviewSubmitted('mentor-1', rating);

        expect(GamificationModel.addXP).toHaveBeenCalledWith(
          'mentor-1',
          20,
          'manual',
          'review_received',
        );
        expect(result.xpGained).toBe(20);
        expect(result.unlockedAchievements).toHaveLength(0);
      }
    });
  });

  describe('Learning milestone point calculations', () => {
    it('awards exactly 100 XP when user completes a learning milestone', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
        xp: 100,
        level: 2,
        leveledUp: false,
      });
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({
        unlocked: true,
      });
      (GamificationModel.getAchievementById as jest.Mock).mockResolvedValueOnce({
        id: 'learning_path_completed',
        name: 'Master Scholar',
        description: 'Complete a learning milestone',
        icon: 'book-icon',
        category: 'learning',
        rarity: 'rare',
        criteria: { type: 'learning_milestones', target: 1 },
        reward: { type: 'xp', value: 100 },
      });

      const result = await GamificationService.onLearningMilestoneCompleted('user-1', 'm-42');

      expect(GamificationModel.addXP).toHaveBeenCalledWith(
        'user-1',
        100,
        'manual',
        'milestone_m-42',
      );
      expect(result.xpGained).toBe(100);
      expect(GamificationModel.unlockAchievement).toHaveBeenCalledWith(
        'user-1',
        'learning_path_completed',
      );
      expect(result.unlockedAchievements).toHaveLength(1);
    });
  });

  describe('Streak bonus calculation and milestone announcements', () => {
    it('records activity and triggers announcement on streak milestone 7', async () => {
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 7,
        streakIncreased: true,
        streakReset: false,
      });
      (db.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] }) // milestone not announced yet
        .mockResolvedValueOnce({ rows: [] }); // insert into streak_milestone_notifications

      const result = await GamificationService.recordActivity('user-1');

      expect(result.streak).toBe(7);
      expect(result.streakIncreased).toBe(true);
      expect(PushService.sendStreakMilestone).toHaveBeenCalledWith('user-1', 7);
    });

    it('triggers announcement on milestone 30, 60, and 100', async () => {
      for (const milestone of [30, 60, 100]) {
        (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
          streak: milestone,
          streakIncreased: true,
          streakReset: false,
        });
        (db.query as jest.Mock)
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });

        await GamificationService.recordActivity('user-1');

        expect(PushService.sendStreakMilestone).toHaveBeenCalledWith('user-1', milestone);
      }
    });

    it('does not trigger announcement for non-milestone streaks (e.g. 5, 8, 14)', async () => {
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 8,
        streakIncreased: true,
        streakReset: false,
      });

      const result = await GamificationService.recordActivity('user-1');

      expect(result.streak).toBe(8);
      expect(PushService.sendStreakMilestone).not.toHaveBeenCalled();
    });

    it('does not trigger announcement if streak increased is false', async () => {
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 7,
        streakIncreased: false,
        streakReset: false,
      });

      await GamificationService.recordActivity('user-1');

      expect(PushService.sendStreakMilestone).not.toHaveBeenCalled();
    });

    it('does not duplicate announcement if milestone was already recorded in DB', async () => {
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 7,
        streakIncreased: true,
        streakReset: false,
      });
      (db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ user_id: 'user-1', milestone: 7 }],
      });

      await GamificationService.recordActivity('user-1');

      expect(PushService.sendStreakMilestone).not.toHaveBeenCalled();
    });
  });

  describe('Badge award threshold logic', () => {
    const mockAchievements: Achievement[] = [
      {
        id: 'session_1',
        name: 'First Session',
        description: 'Complete 1 session',
        icon: 'session-1',
        category: 'sessions',
        rarity: 'common',
        criteria: { type: 'session_count', target: 1 },
        reward: { type: 'xp', value: 50 },
      },
      {
        id: 'session_5',
        name: 'Five Sessions',
        description: 'Complete 5 sessions',
        icon: 'session-5',
        category: 'sessions',
        rarity: 'rare',
        criteria: { type: 'session_count', target: 5 },
        reward: { type: 'xp', value: 200 },
      },
      {
        id: 'session_10',
        name: 'Ten Sessions',
        description: 'Complete 10 sessions',
        icon: 'session-10',
        category: 'sessions',
        rarity: 'epic',
        criteria: { type: 'session_count', target: 10 },
        reward: { type: 'xp', value: 500 },
      },
    ];

    it('unlocks badges whose threshold is met (e.g. 5 completed sessions meets target 1 and 5)', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
        xp: 200,
        level: 2,
        leveledUp: false,
      });
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 2,
        streakIncreased: true,
        streakReset: false,
      });
      // User has 4 existing session badges, so this new session makes it 5
      (GamificationModel.getUserProgress as jest.Mock).mockResolvedValueOnce({
        userId: 'user-1',
        level: 2,
        xp: 200,
        xpToNextLevel: 200,
        achievements: [],
        badges: [
          { id: 'b1', category: 'sessions' },
          { id: 'b2', category: 'sessions' },
          { id: 'b3', category: 'sessions' },
          { id: 'b4', category: 'sessions' },
        ],
        streak: 2,
        rank: 1,
      });
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce(mockAchievements);
      (GamificationModel.unlockAchievement as jest.Mock)
        .mockResolvedValueOnce({ unlocked: true }) // session_1 unlocked
        .mockResolvedValueOnce({ unlocked: true }); // session_5 unlocked
      (GamificationModel.getActiveChallenges as jest.Mock).mockResolvedValueOnce([]);

      const result = await GamificationService.onSessionCompleted('user-1', 'mentee');

      expect(GamificationModel.unlockAchievement).toHaveBeenCalledWith('user-1', 'session_1');
      expect(GamificationModel.unlockAchievement).toHaveBeenCalledWith('user-1', 'session_5');
      expect(GamificationModel.unlockAchievement).not.toHaveBeenCalledWith('user-1', 'session_10');
      expect(result.unlockedAchievements).toHaveLength(2);
      expect(result.unlockedAchievements.map(a => a.id)).toEqual(['session_1', 'session_5']);
    });

    it('does not unlock badge when session count is strictly below target', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
        xp: 100,
        level: 2,
        leveledUp: false,
      });
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 1,
        streakIncreased: true,
        streakReset: false,
      });
      // User has 0 existing session badges, so this is session #1
      (GamificationModel.getUserProgress as jest.Mock).mockResolvedValueOnce({
        userId: 'user-2',
        level: 1,
        xp: 100,
        xpToNextLevel: 300,
        achievements: [],
        badges: [],
        streak: 1,
        rank: 10,
      });
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce(mockAchievements);
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: true });
      (GamificationModel.getActiveChallenges as jest.Mock).mockResolvedValueOnce([]);

      const result = await GamificationService.onSessionCompleted('user-2', 'mentee');

      // Only session_1 (target 1) should be unlocked, session_5 and session_10 must not be called
      expect(GamificationModel.unlockAchievement).toHaveBeenCalledTimes(1);
      expect(GamificationModel.unlockAchievement).toHaveBeenCalledWith('user-2', 'session_1');
      expect(result.unlockedAchievements).toHaveLength(1);
      expect(result.unlockedAchievements[0].id).toBe('session_1');
    });

    it('does not include already unlocked achievements if model reports unlocked: false', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({
        xp: 100,
        level: 2,
        leveledUp: false,
      });
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({
        streak: 1,
        streakIncreased: true,
        streakReset: false,
      });
      (GamificationModel.getUserProgress as jest.Mock).mockResolvedValueOnce({
        userId: 'user-3',
        level: 1,
        xp: 100,
        xpToNextLevel: 300,
        achievements: ['session_1'],
        badges: [],
        streak: 1,
        rank: 10,
      });
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce(mockAchievements);
      // Model returns unlocked: false because user already has session_1
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: false });
      (GamificationModel.getActiveChallenges as jest.Mock).mockResolvedValueOnce([]);

      const result = await GamificationService.onSessionCompleted('user-3', 'mentee');

      expect(GamificationModel.unlockAchievement).toHaveBeenCalledWith('user-3', 'session_1');
      expect(result.unlockedAchievements).toHaveLength(0);
    });
  });

  describe('Leaderboards, Challenges and Admin features', () => {
    it('retrieves user progress directly from model', async () => {
      const mockProgress = {
        userId: 'user-1',
        level: 3,
        xp: 450,
        xpToNextLevel: 450,
        achievements: ['first_session'],
        badges: [],
        streak: 5,
        rank: 2,
      };
      (GamificationModel.getUserProgress as jest.Mock).mockResolvedValueOnce(mockProgress);

      const result = await GamificationService.getUserProgress('user-1');

      expect(GamificationModel.getUserProgress).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(mockProgress);
    });

    it('retrieves leaderboards correctly', async () => {
      const mockLeaderboard = {
        type: 'mentor' as const,
        period: 'all-time' as const,
        entries: [
          {
            userId: 'm-1',
            name: 'Mentor Alice',
            score: 1500,
            rank: 1,
            level: 4,
            badgesCount: 5,
          },
        ],
      };
      (GamificationModel.getLeaderboard as jest.Mock).mockResolvedValueOnce(mockLeaderboard);

      const res = await GamificationService.getLeaderboard('mentor', 'all-time', 10, 0);

      expect(GamificationModel.getLeaderboard).toHaveBeenCalledWith('mentor', 'all-time', 10, 0, undefined);
      expect(res.entries).toHaveLength(1);
    });

    it('claims challenge reward successfully', async () => {
      (GamificationModel.claimChallengeReward as jest.Mock).mockResolvedValueOnce({
        success: true,
        reward: { type: 'xp', value: 100 },
      });

      const res = await GamificationService.claimChallengeReward('user-1', 'ch-1');

      expect(GamificationModel.claimChallengeReward).toHaveBeenCalledWith('user-1', 'ch-1');
      expect(res.success).toBe(true);
      expect(res.reward?.value).toBe(100);
    });

    it('updates badge showcase', async () => {
      (GamificationModel.updateShowcaseBadges as jest.Mock).mockResolvedValueOnce(['b-1', 'b-2']);

      const res = await GamificationService.updateShowcase('user-1', ['b-1', 'b-2']);

      expect(GamificationModel.updateShowcaseBadges).toHaveBeenCalledWith('user-1', ['b-1', 'b-2']);
      expect(res).toEqual(['b-1', 'b-2']);
    });
  });
});
