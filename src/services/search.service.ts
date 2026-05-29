import pool from '../config/database';
import { CacheService } from './cache.service';
import { CacheTTL } from '../utils/cache-key.utils';
import { buildSearchQuery } from '../utils/query-builder.utils';
import elasticsearchService, { SearchQuery, SearchResult, MentorDocument } from './elasticsearch.service';
import config from '../config';
import crypto from 'crypto';

function hashParams(params: Record<string, any>): string {
  return crypto.createHash('md5').update(JSON.stringify(params)).digest('hex').substring(0, 8);
}

export class SearchService {
  /**
   * Search mentors with Elasticsearch (if enabled) or fallback to PostgreSQL.
   * Uses a distinct cache namespace (mm:search:mentors:v2:*) to avoid
   * collisions with MentorsService.list which returns a different response shape.
   */
  static async searchMentors(filters: any, userId?: string) {
    // Check if Elasticsearch is enabled and connected
    const esEnabled = config.elasticsearch.enabled;
    const esConnected = await elasticsearchService.checkConnection();

    if (esEnabled && esConnected) {
      return this.searchMentorsWithElasticsearch(filters, userId);
    }

    // Fallback to PostgreSQL search
    return this.searchMentorsWithPostgreSQL(filters);
  }

  /**
   * Search mentors using Elasticsearch for advanced full-text search.
   */
  private static async searchMentorsWithElasticsearch(filters: any, userId?: string) {
    const { query, skills, minPrice, maxPrice, minRating, language, page = 1, limit = 10, sort = 'relevance' } = filters;

    const searchQuery: SearchQuery = {
      query: query || '',
      filters: {
        skills: skills ? (Array.isArray(skills) ? skills : [skills]) : undefined,
        priceRange: minPrice && maxPrice ? [parseFloat(minPrice), parseFloat(maxPrice)] : undefined,
        rating: minRating ? parseFloat(minRating) : undefined,
        languages: language ? [language] : undefined,
      },
      page: parseInt(page),
      limit: Math.min(parseInt(limit), config.elasticsearch.search.maxPageSize),
      sort,
    };

    try {
      const result: SearchResult<MentorDocument> = await elasticsearchService.searchMentors(searchQuery);

      // Track search analytics
      await elasticsearchService.trackSearch(
        searchQuery.query,
        searchQuery.filters,
        result.total,
        userId
      );

      const searchResult = {
        mentors: result.hits,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          aggregations: result.aggregations,
        },
      };

      return searchResult;
    } catch (error) {
      // Fallback to PostgreSQL if Elasticsearch fails
      console.error('Elasticsearch search failed, falling back to PostgreSQL:', error);
      return this.searchMentorsWithPostgreSQL(filters);
    }
  }

  /**
   * Search mentors using PostgreSQL (fallback method).
   */
  private static async searchMentorsWithPostgreSQL(filters: any) {
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

  /**
   * Get autocomplete suggestions for mentor names.
   */
  static async autocomplete(query: string, limit: number = 10): Promise<string[]> {
    const esEnabled = config.elasticsearch.enabled;
    const esConnected = await elasticsearchService.checkConnection();

    if (esEnabled && esConnected) {
      return elasticsearchService.autocomplete(query, 'name', limit);
    }

    // Fallback to PostgreSQL for autocomplete
    const result = await pool.query(
      `SELECT name FROM users WHERE role = 'mentor' AND name ILIKE $1 LIMIT $2`,
      [`${query}%`, limit]
    );
    return result.rows.map((row: any) => row.name);
  }

  /**
   * Get similar mentors based on expertise and bio.
   */
  static async getSimilarMentors(mentorId: string, limit: number = 5): Promise<any[]> {
    const esEnabled = config.elasticsearch.enabled;
    const esConnected = await elasticsearchService.checkConnection();

    if (esEnabled && esConnected) {
      return elasticsearchService.getSimilarMentors(mentorId, limit);
    }

    // Fallback to PostgreSQL for similar mentors
    const result = await pool.query(
      `SELECT expertise FROM users WHERE id = $1 AND role = 'mentor'`,
      [mentorId]
    );

    if (result.rows.length === 0) {
      return [];
    }

    const expertise = result.rows[0].expertise;
    const similarResult = await pool.query(
      `SELECT * FROM users WHERE role = 'mentor' AND id != $1 AND expertise && $2 LIMIT $3`,
      [mentorId, expertise, limit]
    );

    return similarResult.rows;
  }

  /**
   * Get popular search queries.
   */
  static async getPopularSearches(limit: number = 10): Promise<Array<{ query: string; count: number }>> {
    const esEnabled = config.elasticsearch.enabled;
    const esConnected = await elasticsearchService.checkConnection();

    if (esEnabled && esConnected) {
      return elasticsearchService.getPopularSearches(limit);
    }

    // Return empty array if Elasticsearch is not available
    return [];
  }
}
