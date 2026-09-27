jest.mock('../../models/gamification.model', () => ({
  GamificationModel: {
    getLeaderboard: jest.fn(),
  },
}));

import { GamificationModel, Leaderboard } from '../../models/gamification.model';
import { LeaderboardService } from '../leaderboard.service';

const emptyBoard = (type: any, period: any): Leaderboard => ({
  type,
  period,
  entries: [],
  total: 0,
});

describe('LeaderboardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLeaderboard', () => {
    it('passes canonical arguments through to the model', async () => {
      (GamificationModel.getLeaderboard as jest.Mock).mockResolvedValueOnce(
        emptyBoard('mentor', 'weekly'),
      );

      await LeaderboardService.getLeaderboard('mentor', 'weekly', 10, 5, 'stellar');

      expect(GamificationModel.getLeaderboard).toHaveBeenCalledWith(
        'mentor',
        'weekly',
        10,
        5,
        'stellar',
      );
    });

    it('clamps limit to 100 and defaults to 20 when invalid', async () => {
      (GamificationModel.getLeaderboard as jest.Mock).mockResolvedValueOnce(
        emptyBoard('mentor', 'all-time'),
      );
      await LeaderboardService.getLeaderboard('mentor', 'all-time', 500, 0);
      expect(GamificationModel.getLeaderboard).toHaveBeenCalledWith(
        'mentor',
        'all-time',
        100,
        0,
        undefined,
      );

      (GamificationModel.getLeaderboard as jest.Mock).mockResolvedValueOnce(
        emptyBoard('mentor', 'all-time'),
      );
      await LeaderboardService.getLeaderboard('mentor', 'all-time', NaN as any, -1);
      expect(GamificationModel.getLeaderboard).toHaveBeenLastCalledWith(
        'mentor',
        'all-time',
        20,
        0,
        undefined,
      );
    });
  });

  describe('normalizeCategory', () => {
    it.each([
      ['sessions', 'mentor'],
      ['mentors', 'mentor'],
      ['mentor', 'mentor'],
      ['mentees', 'mentee'],
      ['mentee', 'mentee'],
      ['skills', 'skill'],
      ['skill', 'skill'],
      ['anything-else', 'mentor'],
      [undefined, 'mentor'],
    ])('maps %s -> %s', (input, expected) => {
      expect(LeaderboardService.normalizeCategory(input as any)).toBe(expected);
    });
  });

  describe('normalizePeriod', () => {
    it.each([
      ['daily', 'daily'],
      ['weekly', 'weekly'],
      ['monthly', 'monthly'],
      ['all-time', 'all-time'],
      ['all_time', 'all-time'],
      ['alltime', 'all-time'],
      ['bogus', 'all-time'],
      [undefined, 'all-time'],
    ])('maps %s -> %s', (input, expected) => {
      expect(LeaderboardService.normalizePeriod(input as any)).toBe(expected);
    });
  });

  describe('getLeaderboardByCategory', () => {
    it('maps sessions + monthly aliases to mentor + monthly', async () => {
      (GamificationModel.getLeaderboard as jest.Mock).mockResolvedValueOnce(
        emptyBoard('mentor', 'monthly'),
      );

      await LeaderboardService.getLeaderboardByCategory('sessions', 'monthly', 5, 0);

      expect(GamificationModel.getLeaderboard).toHaveBeenCalledWith(
        'mentor',
        'monthly',
        5,
        0,
        undefined,
      );
    });

    it('maps mentees -> mentee', async () => {
      (GamificationModel.getLeaderboard as jest.Mock).mockResolvedValueOnce(
        emptyBoard('mentee', 'all-time'),
      );
      await LeaderboardService.getLeaderboardByCategory('mentees', 'all-time');
      expect(GamificationModel.getLeaderboard).toHaveBeenCalledWith(
        'mentee',
        'all-time',
        20,
        0,
        undefined,
      );
    });

    it('maps skills -> skill and forwards the skill filter', async () => {
      (GamificationModel.getLeaderboard as jest.Mock).mockResolvedValueOnce(
        emptyBoard('skill', 'weekly'),
      );
      await LeaderboardService.getLeaderboardByCategory('skills', 'weekly', 10, 0, 'rust');
      expect(GamificationModel.getLeaderboard).toHaveBeenCalledWith(
        'skill',
        'weekly',
        10,
        0,
        'rust',
      );
    });
  });
});
