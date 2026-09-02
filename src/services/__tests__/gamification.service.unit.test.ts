import { GamificationModel } from '../../models/gamification.model';
import { GamificationService } from '../gamification.service';

jest.mock('../../models/gamification.model', () => {
  const original = jest.requireActual('../../models/gamification.model');
  return {
    ...original,
    GamificationModel: {
      calculateLevelAndNextXP: original.GamificationModel.calculateLevelAndNextXP,
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

describe('GamificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Level & XP calculation', () => {
    it('calculates level 1 for 0 XP', () => {
      const result = GamificationModel.calculateLevelAndNextXP(0);
      expect(result.level).toBe(1);
      expect(result.xpToNextLevel).toBe(100);
    });

    it('calculates level 2 for 150 XP', () => {
      const result = GamificationModel.calculateLevelAndNextXP(150);
      expect(result.level).toBe(2);
      expect(result.xpToNextLevel).toBe(250);
    });

    it('calculates level 3 for 400 XP', () => {
      const result = GamificationModel.calculateLevelAndNextXP(400);
      expect(result.level).toBe(3);
      expect(result.xpToNextLevel).toBe(500);
    });
  });

  describe('onSessionCompleted', () => {
    it('awards XP, updates streak, and checks session achievements', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({ xp: 150, level: 2, leveledUp: true });
      (GamificationModel.updateStreak as jest.Mock).mockResolvedValueOnce({ streak: 1, streakIncreased: true, streakReset: false });
      (GamificationModel.getUserProgress as jest.Mock).mockResolvedValueOnce({
        userId: 'user-1',
        level: 2,
        xp: 150,
        xpToNextLevel: 250,
        achievements: [],
        badges: [],
        streak: 1,
        rank: 1,
      });

      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce([
        {
          id: 'first_session',
          name: 'First Step',
          description: 'Complete your first session',
          icon: 'icon-1',
          category: 'sessions',
          rarity: 'common',
          criteria: { type: 'session_count', target: 1 },
          reward: { type: 'xp', value: 100 },
        },
      ]);

      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({
        unlocked: true,
        reward: { type: 'xp', value: 100 },
      });

      (GamificationModel.getActiveChallenges as jest.Mock).mockResolvedValueOnce([]);

      const result = await GamificationService.onSessionCompleted('user-1', 'mentor');

      expect(GamificationModel.addXP).toHaveBeenCalledWith('user-1', 150, 'manual', 'session_completed');
      expect(GamificationModel.updateStreak).toHaveBeenCalledWith('user-1');
      expect(result.xpGained).toBe(150);
      expect(result.unlockedAchievements).toHaveLength(1);
      expect(result.unlockedAchievements[0].id).toBe('first_session');
    });
  });

  describe('onReviewSubmitted', () => {
    it('awards bonus XP and unlocks achievement for 5 star reviews', async () => {
      (GamificationModel.addXP as jest.Mock).mockResolvedValueOnce({ xp: 50, level: 1, leveledUp: false });
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: true });
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

      expect(GamificationModel.addXP).toHaveBeenCalledWith('mentor-1', 50, 'manual', 'review_received');
      expect(GamificationModel.unlockAchievement).toHaveBeenCalledWith('mentor-1', '5_star_review');
      expect(result.xpGained).toBe(50);
      expect(result.unlockedAchievements).toHaveLength(1);
    });
  });

  describe('Leaderboards & Showcase', () => {
    it('retrieves mentor leaderboard', async () => {
      const mockLeaderboard = {
        type: 'mentor',
        period: 'all-time',
        entries: [
          {
            userId: 'm-1',
            name: 'Mentor Alice',
            score: 1200,
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

    it('updates user badge showcase', async () => {
      (GamificationModel.updateShowcaseBadges as jest.Mock).mockResolvedValueOnce(['b-1', 'b-2']);

      const res = await GamificationService.updateShowcase('user-1', ['b-1', 'b-2']);

      expect(GamificationModel.updateShowcaseBadges).toHaveBeenCalledWith('user-1', ['b-1', 'b-2']);
      expect(res).toEqual(['b-1', 'b-2']);
    });
  });
});
