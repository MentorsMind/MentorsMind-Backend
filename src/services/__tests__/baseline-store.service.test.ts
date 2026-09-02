/// <reference types="jest" />

const mockPipelineExec = jest.fn().mockResolvedValue([]);
const mockPipeline = {
  zrem: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  zremrangebyscore: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: mockPipelineExec,
};

jest.mock('../../config/redis', () => ({
  redis: {
    zrangebyscore: jest.fn(),
    pipeline: jest.fn(() => mockPipeline),
  },
}));

import { redis } from '../../config/redis';
import { BaselineStore } from '../baseline-store.service';

describe('BaselineStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSamples', () => {
    it('parses counts out of stored members', async () => {
      (redis.zrangebyscore as jest.Mock).mockResolvedValue([
        '19960:2',
        '19961:0',
        '19962:5',
      ]);

      const samples = await BaselineStore.getSamples('user-1');

      expect(samples).toEqual([2, 0, 5]);
    });

    it('returns an empty array when the user has no baseline yet', async () => {
      (redis.zrangebyscore as jest.Mock).mockResolvedValue([]);

      const samples = await BaselineStore.getSamples('user-1');

      expect(samples).toEqual([]);
    });

    it('returns an empty array and does not throw on Redis errors', async () => {
      (redis.zrangebyscore as jest.Mock).mockRejectedValue(new Error('connection lost'));

      const samples = await BaselineStore.getSamples('user-1');

      expect(samples).toEqual([]);
    });
  });

  describe('recordDailyCount', () => {
    it('removes the old entry for the day, writes the new one, and trims the window', async () => {
      (redis.zrangebyscore as jest.Mock).mockResolvedValue(['19960:1']);

      await BaselineStore.recordDailyCount('user-1', new Date('2024-08-01T00:00:00Z'), 3);

      expect(mockPipeline.zrem).toHaveBeenCalledWith(expect.any(String), '19960:1');
      expect(mockPipeline.zadd).toHaveBeenCalled();
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalled();
      expect(mockPipeline.expire).toHaveBeenCalled();
      expect(mockPipelineExec).toHaveBeenCalled();
    });

    it('does not throw on Redis errors', async () => {
      (redis.zrangebyscore as jest.Mock).mockRejectedValue(new Error('connection lost'));

      await expect(
        BaselineStore.recordDailyCount('user-1', new Date(), 1),
      ).resolves.toBeUndefined();
    });
  });
});
