import { ModerationService } from '../moderation.service';
import pool from '../../config/database';

jest.mock('../../config/database', () => ({
  query: jest.fn(),
}));

describe('ModerationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAutoHide', () => {
    it('should hide review content (set is_published = false) when 3 or more flags are present', async () => {
      // Mock the count query to return 3
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ flag_count: '3' }],
      });

      // Mock the hideContent query
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await ModerationService.checkAutoHide('review', 'review-123');

      // First query is the count query
      expect(pool.query).toHaveBeenNthCalledWith(1, expect.any(String), ['review', 'review-123']);
      
      // Second query should be the UPDATE query from hideContent
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        'UPDATE reviews SET is_published = false WHERE id = $1',
        ['review-123']
      );
    });

    it('should not hide content when less than 3 flags are present', async () => {
      // Mock the count query to return 2
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ flag_count: '2' }],
      });

      await ModerationService.checkAutoHide('review', 'review-123');

      expect(pool.query).toHaveBeenCalledTimes(1); // Only the count query
    });
  });
});
