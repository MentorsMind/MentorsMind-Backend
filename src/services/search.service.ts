import pool from '../config/database';
import { CacheService } from './cache.service';
import { CacheTTL } from '../utils/cache-key.utils';
import { buildSearchQuery } from '../utils/query-builder.utils';
import crypto from 'crypto';

function hashParams(params: Record<string, any>): string {
  return crypto.createHash('md5').update(JSON.stringify(params)).digest('hex').substring(0, 8);
}

export class SearchService {
  /**
   * Search mentors with caching.
   * Uses a distinct cache namespace (mm:search:mentors:v1:*) to avoid
   * collisions with MentorsService.list which returns a different response shape.
   */
  static async searchMentors(filters: any) {
    const cacheKey = `mm:search:mentors:v1:${hashParams(filters)}`;

    const cached = await CacheService.get<any>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const { query, values } = buildSearchQuery(filters);
    const result = await pool.query(query, values);
    const totalCount = result.rows[0]?.total_count || 0;

    const searchResult = {
      mentors: result.rows,
      meta: {
        total: parseInt(totalCount),
        page: parseInt(filters.page) || 1,
        limit: parseInt(filters.limit) || 10,
      },
    };

    await CacheService.set(cacheKey, searchResult, CacheTTL.short);

    return searchResult;
  }
}
