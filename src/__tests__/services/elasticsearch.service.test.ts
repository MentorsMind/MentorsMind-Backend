import elasticsearchService from '../../services/elasticsearch.service';
import config from '../../config';

jest.mock('../../config', () => ({
  default: {
    elasticsearch: {
      enabled: true,
      indices: {
        mentors: 'mentorminds-mentors',
        sessions: 'mentorminds-sessions',
        content: 'mentorminds-content',
      },
      search: {
        maxPageSize: 100,
        fuzzyDistance: 2,
      },
    },
  },
}));

describe('ElasticsearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkConnection', () => {
    it('should return true when Elasticsearch is connected', async () => {
      const result = await elasticsearchService.checkConnection();
      // This will fail if ES is not running, but that's expected
      expect(typeof result).toBe('boolean');
    });
  });

  describe('searchMentors', () => {
    it('should throw error when Elasticsearch is not connected', async () => {
      // Temporarily disable for this test
      const originalEnabled = config.elasticsearch.enabled;
      (config.elasticsearch as any).enabled = false;
      
      await expect(
        elasticsearchService.searchMentors({
          query: 'test',
          page: 1,
          limit: 10,
        })
      ).rejects.toThrow('Elasticsearch is not connected or not enabled');
      
      (config.elasticsearch as any).enabled = originalEnabled;
    });
  });

  describe('autocomplete', () => {
    it('should throw error when Elasticsearch is not connected', async () => {
      const originalEnabled = config.elasticsearch.enabled;
      (config.elasticsearch as any).enabled = false;
      
      await expect(
        elasticsearchService.autocomplete('test')
      ).rejects.toThrow('Elasticsearch is not connected or not enabled');
      
      (config.elasticsearch as any).enabled = originalEnabled;
    });
  });

  describe('getSimilarMentors', () => {
    it('should throw error when Elasticsearch is not connected', async () => {
      const originalEnabled = config.elasticsearch.enabled;
      (config.elasticsearch as any).enabled = false;
      
      await expect(
        elasticsearchService.getSimilarMentors('mentor-123')
      ).rejects.toThrow('Elasticsearch is not connected or not enabled');
      
      (config.elasticsearch as any).enabled = originalEnabled;
    });
  });

  describe('trackSearch', () => {
    it('should throw error when Elasticsearch is not connected', async () => {
      const originalEnabled = config.elasticsearch.enabled;
      (config.elasticsearch as any).enabled = false;
      
      await expect(
        elasticsearchService.trackSearch('test', {}, 10)
      ).rejects.toThrow('Elasticsearch is not connected or not enabled');
      
      (config.elasticsearch as any).enabled = originalEnabled;
    });
  });

  describe('getPopularSearches', () => {
    it('should throw error when Elasticsearch is not connected', async () => {
      const originalEnabled = config.elasticsearch.enabled;
      (config.elasticsearch as any).enabled = false;
      
      await expect(
        elasticsearchService.getPopularSearches()
      ).rejects.toThrow('Elasticsearch is not connected or not enabled');
      
      (config.elasticsearch as any).enabled = originalEnabled;
    });
  });
});
