jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    elasticsearch: { enabled: true, search: { maxPageSize: 100 } },
  },
}));

import pool from '../../config/database';
import { CacheService } from '../cache.service';
import elasticsearchService from '../elasticsearch.service';
import { SearchService } from '../search.service';

describe('SearchService Elasticsearch timeout fallback', () => {
  afterEach(() => jest.restoreAllMocks());

  it('falls back to PostgreSQL when an Elasticsearch query times out', async () => {
    jest.spyOn(elasticsearchService, 'checkConnection').mockResolvedValue(true);
    jest.spyOn(elasticsearchService, 'searchMentors').mockRejectedValue(new Error('request timed out'));
    jest.spyOn(CacheService, 'get').mockResolvedValue(null);
    jest.spyOn(CacheService, 'set').mockResolvedValue(undefined);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as never);

    await SearchService.searchMentors({ query: 'distributed systems', page: 1, limit: 10 });

    expect(querySpy).toHaveBeenCalled();
  });
});
