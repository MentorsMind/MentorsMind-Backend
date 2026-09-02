/// <reference types="jest" />
jest.mock('../baseline-store.service', () => ({
  BaselineStore: {
    getSamples: jest.fn(),
  },
}));

import { MlSecurityService } from '../ml-security.service';
import { BaselineStore } from '../baseline-store.service';

describe('MlSecurityService', () => {
  describe('scoreDeviation', () => {
    it('returns 0 when there are fewer than 2 historical samples', () => {
      expect(MlSecurityService.scoreDeviation(100, [])).toBe(0);
      expect(MlSecurityService.scoreDeviation(100, [5])).toBe(0);
    });

    it('returns 0 when the current value equals the baseline mean', () => {
      expect(MlSecurityService.scoreDeviation(5, [4, 5, 6])).toBe(0);
    });

    it('returns a low score for a value close to the baseline', () => {
      const score = MlSecurityService.scoreDeviation(6, [4, 5, 6, 5, 4, 6]);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThan(50);
    });

    it('returns a high score for a value far from the baseline', () => {
      const score = MlSecurityService.scoreDeviation(1000, [4, 5, 6, 5, 4, 6]);
      expect(score).toBeGreaterThan(50);
    });

    it('clamps at 100 for extreme deviations', () => {
      const score = MlSecurityService.scoreDeviation(1_000_000, [1, 2, 3]);
      expect(score).toBe(100);
    });

    it('falls back to a stddev of 1 when all samples are identical', () => {
      // stddev = 0 -> divisor falls back to 1, so |current - mean| is used directly
      const score = MlSecurityService.scoreDeviation(10, [5, 5, 5]);
      expect(score).toBeCloseTo(100, 0); // |10-5|/1 = 5 = MAX_Z_SCORE -> saturates
    });

    it('ignores non-finite samples', () => {
      const score = MlSecurityService.scoreDeviation(5, [4, 5, 6, NaN, Infinity]);
      expect(score).toBe(0);
    });
  });

  describe('computeVelocityScore', () => {
    const now = new Date('2026-08-24T12:00:00Z');
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

    it('returns 0 for no events', () => {
      expect(MlSecurityService.computeVelocityScore([], 60_000, 5)).toBe(0);
    });

    it('returns 0 when threshold is not exceeded', () => {
      const events = [now, minutesAgo(1), minutesAgo(2)];
      const score = MlSecurityService.computeVelocityScore(events, 10 * 60_000, 5);
      expect(score).toBe(0);
    });

    it('returns 0 for a non-positive threshold', () => {
      const events = [now, minutesAgo(1)];
      expect(MlSecurityService.computeVelocityScore(events, 60_000, 0)).toBe(0);
    });

    it('scales up when the event count exceeds the threshold', () => {
      const events = [now, minutesAgo(1), minutesAgo(2), minutesAgo(3), minutesAgo(4), minutesAgo(5)];
      const score = MlSecurityService.computeVelocityScore(events, 10 * 60_000, 3);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('saturates at 100 once count reaches 3x the threshold', () => {
      const events = Array.from({ length: 10 }, (_, i) => minutesAgo(i));
      const score = MlSecurityService.computeVelocityScore(events, 15 * 60_000, 3);
      expect(score).toBe(100);
    });

    it('only counts events within the window relative to the latest event', () => {
      const events = [now, minutesAgo(120)]; // one event way outside the window
      const score = MlSecurityService.computeVelocityScore(events, 10 * 60_000, 1);
      expect(score).toBe(0); // only 1 event counted within window, not > threshold
    });
  });

  describe('scoreDeviationForUser', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('scores against the override samples without touching BaselineStore', async () => {
      const score = await MlSecurityService.scoreDeviationForUser('user-1', 6, [4, 5, 6, 5, 4, 6]);

      expect(BaselineStore.getSamples).not.toHaveBeenCalled();
      expect(score).toBe(MlSecurityService.scoreDeviation(6, [4, 5, 6, 5, 4, 6]));
    });

    it('loads samples from BaselineStore when no override is given', async () => {
      (BaselineStore.getSamples as jest.Mock).mockResolvedValue([0, 1, 1, 1, 2]);

      const score = await MlSecurityService.scoreDeviationForUser('user-1', 5);

      expect(BaselineStore.getSamples).toHaveBeenCalledWith('user-1');
      expect(score).toBe(MlSecurityService.scoreDeviation(5, [0, 1, 1, 1, 2]));
    });

    it('returns 0 when BaselineStore has no samples for the user yet', async () => {
      (BaselineStore.getSamples as jest.Mock).mockResolvedValue([]);

      const score = await MlSecurityService.scoreDeviationForUser('user-1', 5);

      expect(score).toBe(0);
    });
  });
});
