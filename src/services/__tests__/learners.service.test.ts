import { LearnerService } from '../learners.service';

describe('LearnerService', () => {
  describe('calculateStreaks', () => {
    // Access the private method for testing
    const calculateStreaks = (dates: Date[]) => (LearnerService as any).calculateStreaks(dates);

    it('should return 0 current and 0 longest for 0 sessions', () => {
      const result = calculateStreaks([]);
      expect(result).toEqual({ current: 0, longest: 0 });
    });

    it('should return correct streaks for 1 session', () => {
      // Session today
      const today = new Date();
      const result = calculateStreaks([today]);
      expect(result).toEqual({ current: 1, longest: 1 });

      // Session in the past
      const past = new Date();
      past.setDate(past.getDate() - 10);
      const pastResult = calculateStreaks([past]);
      expect(pastResult).toEqual({ current: 0, longest: 1 });
    });

    it('should calculate correctly for 2 consecutive sessions', () => {
      const d1 = new Date();
      const d2 = new Date();
      d2.setDate(d1.getDate() - 1);

      const result = calculateStreaks([d1, d2]);
      expect(result).toEqual({ current: 2, longest: 2 });
    });

    it('should calculate correctly for 2 non-consecutive sessions', () => {
      const d1 = new Date();
      const d2 = new Date();
      d2.setDate(d1.getDate() - 5);

      const result = calculateStreaks([d1, d2]);
      expect(result).toEqual({ current: 1, longest: 1 });
    });

    it('should correctly handle 5 consecutive then gap then 3 consecutive', () => {
      // Array is ordered descending (newest first)
      const base = new Date();
      const dates: Date[] = [];

      // 3 consecutive days (today, yesterday, 2 days ago)
      for (let i = 0; i < 3; i++) {
        const d = new Date(base);
        d.setDate(base.getDate() - i);
        dates.push(d);
      }

      // 5 consecutive days starting 7 days ago
      for (let i = 7; i < 12; i++) {
        const d = new Date(base);
        d.setDate(base.getDate() - i);
        dates.push(d);
      }

      const result = calculateStreaks(dates);
      expect(result).toEqual({ current: 3, longest: 5 });
    });
  });
});
