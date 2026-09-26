jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../models/gamification.model', () => ({
  GamificationModel: {
    getAllAchievements: jest.fn(),
    getAchievementById: jest.fn(),
    createAchievement: jest.fn(),
    unlockAchievement: jest.fn(),
    updateShowcaseBadges: jest.fn(),
    getUserProgress: jest.fn(),
  },
}));

import { GamificationModel, Achievement, Badge } from '../../models/gamification.model';
import { AchievementService } from '../achievement.service';

const makeAchievement = (
  id: string,
  target: number,
  category: Achievement['category'] = 'sessions',
): Achievement => ({
  id,
  name: id,
  description: id,
  icon: 'icon',
  category,
  rarity: 'common',
  criteria: { type: 'session_count', target },
  reward: { type: 'xp', value: 50 },
});

describe('AchievementService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listAchievements / getAchievementById / createAchievement', () => {
    it('delegates listing to the model with category + rarity', async () => {
      const list: Achievement[] = [makeAchievement('a1', 1)];
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce(list);

      const res = await AchievementService.listAchievements('sessions', 'rare');

      expect(GamificationModel.getAllAchievements).toHaveBeenCalledWith('sessions', 'rare');
      expect(res).toEqual(list);
    });

    it('delegates getAchievementById to the model', async () => {
      const ach = makeAchievement('a1', 1);
      (GamificationModel.getAchievementById as jest.Mock).mockResolvedValueOnce(ach);

      const res = await AchievementService.getAchievementById('a1');

      expect(GamificationModel.getAchievementById).toHaveBeenCalledWith('a1');
      expect(res).toEqual(ach);
    });

    it('delegates createAchievement to the model', async () => {
      const ach = makeAchievement('a1', 1);
      (GamificationModel.createAchievement as jest.Mock).mockResolvedValueOnce(ach);

      const res = await AchievementService.createAchievement({ id: 'a1' });

      expect(GamificationModel.createAchievement).toHaveBeenCalledWith({ id: 'a1' });
      expect(res).toEqual(ach);
    });
  });

  describe('unlockForUser', () => {
    it('returns unlocked:false when the model reports a duplicate', async () => {
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: false });

      const res = await AchievementService.unlockForUser('u1', 'a1');

      expect(res).toEqual({ unlocked: false });
      expect(GamificationModel.getAchievementById).not.toHaveBeenCalled();
    });

    it('returns the achievement definition on a fresh unlock', async () => {
      const ach = makeAchievement('a1', 1);
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: true });
      (GamificationModel.getAchievementById as jest.Mock).mockResolvedValueOnce(ach);

      const res = await AchievementService.unlockForUser('u1', 'a1');

      expect(res.unlocked).toBe(true);
      expect(res.achievement).toEqual(ach);
    });
  });

  describe('getUserAchievements / getShowcase / updateShowcase', () => {
    it('returns badges from user progress', async () => {
      const badges: Badge[] = [
        { id: 'b1', name: 'B1', description: '', icon: '', category: 'sessions', unlockedAt: '2024-01-01' },
      ];
      (GamificationModel.getUserProgress as jest.Mock).mockResolvedValueOnce({
        badges,
        showcase_badges: ['b1'],
      });

      await expect(AchievementService.getUserAchievements('u1')).resolves.toEqual(badges);
      await expect(AchievementService.getShowcase('u1')).resolves.toEqual(['b1']);
    });

    it('delegates showcase updates to the model', async () => {
      (GamificationModel.updateShowcaseBadges as jest.Mock).mockResolvedValueOnce(['b1', 'b2']);

      const res = await AchievementService.updateShowcase('u1', ['b1', 'b2']);

      expect(GamificationModel.updateShowcaseBadges).toHaveBeenCalledWith('u1', ['b1', 'b2']);
      expect(res).toEqual(['b1', 'b2']);
    });
  });

  describe('evaluateSessionAchievements', () => {
    const achievements: Achievement[] = [
      makeAchievement('session_1', 1),
      makeAchievement('session_5', 5),
      makeAchievement('session_10', 10),
    ];

    it('unlocks only the achievements whose target is met', async () => {
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce(achievements);
      (GamificationModel.unlockAchievement as jest.Mock)
        .mockResolvedValueOnce({ unlocked: true })  // session_1
        .mockResolvedValueOnce({ unlocked: true }); // session_5

      const res = await AchievementService.evaluateSessionAchievements('u1', 5);

      expect(GamificationModel.unlockAchievement).toHaveBeenCalledTimes(2);
      expect(GamificationModel.unlockAchievement).toHaveBeenNthCalledWith(1, 'u1', 'session_1');
      expect(GamificationModel.unlockAchievement).toHaveBeenNthCalledWith(2, 'u1', 'session_5');
      expect(res.map((a) => a.id)).toEqual(['session_1', 'session_5']);
    });

    it('ignores non session_count criteria', async () => {
      const mixed: Achievement[] = [
        { ...makeAchievement('streak_7', 7), criteria: { type: 'streak_days', target: 7 } },
        makeAchievement('session_1', 1),
      ];
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce(mixed);
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: true });

      const res = await AchievementService.evaluateSessionAchievements('u1', 1);

      expect(GamificationModel.unlockAchievement).toHaveBeenCalledTimes(1);
      expect(GamificationModel.unlockAchievement).toHaveBeenCalledWith('u1', 'session_1');
      expect(res.map((a) => a.id)).toEqual(['session_1']);
    });

    it('skips achievements where the model reports already unlocked', async () => {
      (GamificationModel.getAllAchievements as jest.Mock).mockResolvedValueOnce(achievements);
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: false });

      const res = await AchievementService.evaluateSessionAchievements('u1', 1);

      expect(res).toEqual([]);
    });
  });

  describe('evaluateReviewAchievements', () => {
    it('unlocks 5_star_review on a 5-star rating', async () => {
      const ach = { ...makeAchievement('5_star_review', 5), category: 'social' as const };
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: true });
      (GamificationModel.getAchievementById as jest.Mock).mockResolvedValueOnce(ach);

      const res = await AchievementService.evaluateReviewAchievements('u1', 5);

      expect(GamificationModel.unlockAchievement).toHaveBeenCalledWith('u1', '5_star_review');
      expect(res.map((a) => a.id)).toEqual(['5_star_review']);
    });

    it('does nothing for ratings below 5', async () => {
      const res = await AchievementService.evaluateReviewAchievements('u1', 4);

      expect(GamificationModel.unlockAchievement).not.toHaveBeenCalled();
      expect(res).toEqual([]);
    });
  });

  describe('evaluateStreakAchievements', () => {
    it('unlocks streak_7 at exactly 7', async () => {
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: true });
      (GamificationModel.getAchievementById as jest.Mock).mockResolvedValueOnce(
        makeAchievement('streak_7', 7, 'social'),
      );

      const res = await AchievementService.evaluateStreakAchievements('u1', 7);

      expect(res.map((a) => a.id)).toEqual(['streak_7']);
    });

    it('unlocks streak_7 and streak_30 at 30+', async () => {
      (GamificationModel.unlockAchievement as jest.Mock)
        .mockResolvedValueOnce({ unlocked: true })
        .mockResolvedValueOnce({ unlocked: true });
      (GamificationModel.getAchievementById as jest.Mock)
        .mockResolvedValueOnce(makeAchievement('streak_7', 7, 'social'))
        .mockResolvedValueOnce(makeAchievement('streak_30', 30, 'social'));

      const res = await AchievementService.evaluateStreakAchievements('u1', 30);

      expect(res.map((a) => a.id)).toEqual(['streak_7', 'streak_30']);
    });

    it('does nothing below 7', async () => {
      const res = await AchievementService.evaluateStreakAchievements('u1', 6);

      expect(GamificationModel.unlockAchievement).not.toHaveBeenCalled();
      expect(res).toEqual([]);
    });
  });

  describe('evaluateLearningAchievements', () => {
    it('unlocks learning_path_completed', async () => {
      (GamificationModel.unlockAchievement as jest.Mock).mockResolvedValueOnce({ unlocked: true });
      (GamificationModel.getAchievementById as jest.Mock).mockResolvedValueOnce(
        makeAchievement('learning_path_completed', 1, 'learning'),
      );

      const res = await AchievementService.evaluateLearningAchievements('u1');

      expect(res.map((a) => a.id)).toEqual(['learning_path_completed']);
    });
  });
});
