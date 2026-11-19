import { Request, Response } from 'express';
import { GamificationController } from '../gamification.controller';
import { GamificationService } from '../../services/gamification.service';
import { GamificationModel } from '../../models/gamification.model';

jest.mock('../../services/gamification.service');
jest.mock('../../models/gamification.model');

describe('GamificationController', () => {
  let mockReq: Partial<any>;
  let mockRes: Partial<Response>;
  let nextFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      params: {},
      query: {},
      body: {},
      user: { id: 'user-123', userId: 'user-123', role: 'learner' },
    };
    mockRes = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };
    nextFn = jest.fn();
  });

  describe('getMyProgress', () => {
    it('returns user progress for authenticated user', async () => {
      const mockProgress = {
        userId: 'user-123',
        level: 3,
        xp: 900,
        xpToNextLevel: 700,
        achievements: ['first_session'],
        badges: [],
        streak: 5,
        rank: 2,
      };

      (GamificationService.getUserProgress as jest.Mock).mockResolvedValueOnce(mockProgress);

      await GamificationController.getMyProgress(mockReq as any, mockRes as Response, nextFn);

      expect(GamificationService.getUserProgress).toHaveBeenCalledWith('user-123');
      expect(mockRes.json).toHaveBeenCalledWith({ status: 'success', data: mockProgress });
    });

    it('returns 401 if user is unauthenticated', async () => {
      mockReq.user = undefined;

      await GamificationController.getMyProgress(mockReq as any, mockRes as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ status: 'error', message: 'Unauthorized' });
    });
  });

  describe('getLeaderboard', () => {
    it('returns leaderboard entries', async () => {
      mockReq.query = { type: 'mentor', period: 'weekly', limit: '10', offset: '0' };
      const mockLeaderboard = {
        type: 'mentor',
        period: 'weekly',
        entries: [{ userId: 'm1', name: 'Mentor A', score: 500, rank: 1, level: 3, badgesCount: 2 }],
      };

      (GamificationService.getLeaderboard as jest.Mock).mockResolvedValueOnce(mockLeaderboard);

      await GamificationController.getLeaderboard(mockReq as Request, mockRes as Response, nextFn);

      expect(GamificationService.getLeaderboard).toHaveBeenCalledWith('mentor', 'weekly', 10, 0, undefined);
      expect(mockRes.json).toHaveBeenCalledWith({ status: 'success', data: mockLeaderboard });
    });
  });

  describe('claimChallengeReward', () => {
    it('claims reward for completed challenge', async () => {
      mockReq.params = { id: 'ch-1' };
      (GamificationService.claimChallengeReward as jest.Mock).mockResolvedValueOnce({
        success: true,
        reward: { type: 'xp', value: 100 },
      });

      await GamificationController.claimChallengeReward(mockReq as any, mockRes as Response, nextFn);

      expect(GamificationService.claimChallengeReward).toHaveBeenCalledWith('user-123', 'ch-1');
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'success',
        data: { success: true, reward: { type: 'xp', value: 100 } },
      });
    });
  });

  describe('updateShowcase', () => {
    it('updates user badge showcase', async () => {
      mockReq.body = { badgeIds: ['b-1', 'b-2'] };
      (GamificationService.updateShowcase as jest.Mock).mockResolvedValueOnce(['b-1', 'b-2']);

      await GamificationController.updateShowcase(mockReq as any, mockRes as Response, nextFn);

      expect(GamificationService.updateShowcase).toHaveBeenCalledWith('user-123', ['b-1', 'b-2']);
      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'success',
        data: { showcase: ['b-1', 'b-2'] },
      });
    });
  });
});
