import { SearchService } from '../../services/search.service';
import elasticsearchService from '../../services/elasticsearch.service';
import config from '../../config';

jest.mock('../../services/elasticsearch.service');
jest.mock('../../config', () => ({
  default: {
    elasticsearch: {
      enabled: true,
      search: {
        maxPageSize: 100,
      },
    },
  },
}));

describe('SearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('searchMentors', () => {
    it('should use Elasticsearch when enabled and connected', async () => {
      (elasticsearchService.checkConnection as jest.Mock).mockResolvedValue(true);
      (elasticsearchService.searchMentors as jest.Mock).mockResolvedValue({
        hits: [{ id: '1', name: 'Test Mentor' }],
        total: 1,
        page: 1,
        limit: 10,
      });
      (elasticsearchService.trackSearch as jest.Mock).mockResolvedValue(undefined);

      const result = await SearchService.searchMentors({ query: 'test' });

      expect(elasticsearchService.searchMentors).toHaveBeenCalled();
      expect(result.mentors).toEqual([{ id: '1', name: 'Test Mentor' }]);
    });

    it('should fallback to PostgreSQL when Elasticsearch is disabled', async () => {
      (config.elasticsearch as any).enabled = false;
      (elasticsearchService.checkConnection as jest.Mock).mockResolvedValue(false);

      const result = await SearchService.searchMentors({ query: 'test' });

      expect(elasticsearchService.searchMentors).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      
      (config.elasticsearch as any).enabled = true;
    });

    it('should fallback to PostgreSQL when Elasticsearch fails', async () => {
      (elasticsearchService.checkConnection as jest.Mock).mockResolvedValue(true);
      (elasticsearchService.searchMentors as jest.Mock).mockRejectedValue(new Error('ES failed'));

      const result = await SearchService.searchMentors({ query: 'test' });

      expect(result).toBeDefined();
    });
  });

  describe('autocomplete', () => {
    it('should use Elasticsearch when enabled and connected', async () => {
      (elasticsearchService.checkConnection as jest.Mock).mockResolvedValue(true);
      (elasticsearchService.autocomplete as jest.Mock).mockResolvedValue(['Test Mentor', 'Test User']);

      const result = await SearchService.autocomplete('test');

      expect(elasticsearchService.autocomplete).toHaveBeenCalledWith('test', 10);
      expect(result).toEqual(['Test Mentor', 'Test User']);
    });

    it('should fallback to PostgreSQL when Elasticsearch is disabled', async () => {
      (config.elasticsearch as any).enabled = false;
      (elasticsearchService.checkConnection as jest.Mock).mockResolvedValue(false);

      const result = await SearchService.autocomplete('test');

      expect(elasticsearchService.autocomplete).not.toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
      
      (config.elasticsearch as any).enabled = true;
    });
  });

  describe('getSimilarMentors', () => {
    it('should use Elasticsearch when enabled and connected', async () => {
      (elasticsearchService.checkConnection as jest.Mock).mockResolvedValue(true);
      (elasticsearchService.getSimilarMentors as jest.Mock).mockResolvedValue([
        { id: '2', name: 'Similar Mentor' },
      ]);

      const result = await SearchService.getSimilarMentors('mentor-123');

      expect(elasticsearchService.getSimilarMentors).toHaveBeenCalledWith('mentor-123', 5);
      expect(result).toEqual([{ id: '2', name: 'Similar Mentor' }]);
    });

    it('should fallback to PostgreSQL when Elasticsearch is disabled', async () => {
      (config.elasticsearch as any).enabled = false;
      (elasticsearchService.checkConnection as jest.Mock).mockResolvedValue(false);

      const result = await SearchService.getSimilarMentors('mentor-123');

      expect(elasticsearchService.getSimilarMentors).not.toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
      
      (config.elasticsearch as any).enabled = true;
    });
  });

  describe('getPopularSearches', () => {
    it('should use Elasticsearch when enabled and connected', async () => {
      (elasticsearchService.checkConnection as jest.Mock).mockResolvedValue(true);
      (elasticsearchService.getPopularSearches as jest.Mock).mockResolvedValue([
        { query: 'javascript', count: 100 },
        { query: 'python', count: 80 },
      ]);

      const result = await SearchService.getPopularSearches();

      expect(elasticsearchService.getPopularSearches).toHaveBeenCalledWith(10);
      expect(result).toEqual([
        { query: 'javascript', count: 100 },
        { query: 'python', count: 80 },
      ]);
    });

    it('should return empty array when Elasticsearch is disabled', async () => {
      (config.elasticsearch as any).enabled = false;
      (elasticsearchService.checkConnection as jest.Mock).mockResolvedValue(false);

      const result = await SearchService.getPopularSearches();

      expect(elasticsearchService.getPopularSearches).not.toHaveBeenCalled();
      expect(result).toEqual([]);
      
      (config.elasticsearch as any).enabled = true;
    });
  });
});
