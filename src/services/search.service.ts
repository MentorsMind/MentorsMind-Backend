/**
 * Search Service
 *
 * Provides mentor search via Elasticsearch (primary) or PostgreSQL (fallback).
 *
 * Caching strategy:
 *   - Generic search results cached by filter hash (no user context in cache key)
 *   - User-specific analytics are tracked separately after cache lookup
 *   - TTL: 2 minutes for general searches, 10 minutes for popular/warmed searches
 *   - Cache warming: runs every 15 minutes for top-20 popular queries
 *   - Cache invalidation: call invalidateSearchCache() when mentor profiles update
 */

import pool from '../config/database';
import { CacheService } from './cache.service';
import { CacheTTL } from '../utils/cache-key.utils';
import { buildSearchQuery } from '../utils/query-builder.utils';
import elasticsearchService, { SearchQuery, SearchResult, MentorDocument } from './elasticsearch.service';
import { MessagingService } from './messaging.service';
import config from '../config';
import crypto from 'crypto';
import { logger } from '../utils/logger.utils';

// ── TTL constants ─────────────────────────────────────────────────────────────

/** General search results cache — 2 minutes */
const SEARCH_CACHE_TTL = 120;

/** Pre-warmed popular search cache — 10 minutes */
const POPULAR_SEARCH_CACHE_TTL = 600;

/** Autocomplete suggestions cache — 5 minutes */
const AUTOCOMPLETE_CACHE_TTL = 300;

// ── Key helpers ───────────────────────────────────────────────────────────────

export type GlobalSearchResultType = 'mentor' | 'session' | 'message';

export interface GlobalSearchItem {
  type: GlobalSearchResultType;
  id: string;
  [key: string]: unknown;
}

export interface GlobalSearchOptions {
  query: string;
  types?: GlobalSearchResultType[];
  page?: number;
  limit?: number;
  userId: string;
}

export interface GlobalSearchResult {
  results: GlobalSearchItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    types: GlobalSearchResultType[];
  };
}

function hashParams(params: Record<string, any>): string {
  return crypto.createHash('md5').update(JSON.stringify(params)).digest('hex').substring(0, 8);
}

/** Build a stable, user-agnostic cache key from search filters */
function buildEsCacheKey(filters: any): string {
  // Omit userId from the cache key so generic results are shared across users
  const { userId: _userId, ...cacheableFilters } = filters;
  return `mm:search:es:v1:${hashParams(cacheableFilters)}`;
}

/** Build cache key for PostgreSQL fallback search */
function buildPgCacheKey(filters: any): string {
  const { userId: _userId, ...cacheableFilters } = filters;
  return `mm:search:mentors:v1:${hashParams(cacheableFilters)}`;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SearchService {
  /**
   * Search mentors with Elasticsearch (if enabled) or fallback to PostgreSQL.
   * Uses a distinct cache namespace (mm:search:*) to avoid collisions with
   * MentorsService.list which returns a different response shape.
   */
  static async searchMentors(filters: any, userId?: string) {
    const esEnabled = config.elasticsearch.enabled;
    const esConnected = await elasticsearchService.checkConnection();

    if (esEnabled && esConnected) {
      return this.searchMentorsWithElasticsearch(filters, userId);
    }

    return this.searchMentorsWithPostgreSQL(filters);
  }

  /**
   * Search mentors using Elasticsearch with result caching.
   *
   * Cache strategy:
   *   1. Cache key is based on filters ONLY (no userId) — generic results
   *      are shared across all users to maximise cache hit rate.
   *   2. After obtaining results (from cache or ES), track analytics with userId
   *      so personalization data is still collected.
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

    const cacheKey = buildEsCacheKey(filters);

    // Check cache first — generic results shared across users
    const cached = await CacheService.get<{
      mentors: any[];
      meta: Record<string, any>;
    }>(cacheKey);

    if (cached !== null) {
      // Cache HIT — still track analytics for the specific user asynchronously
      if (userId) {
        elasticsearchService
          .trackSearch(searchQuery.query, searchQuery.filters, cached.meta?.total ?? 0, userId)
          .catch(() => {});
      }
      return cached;
    }

    // Cache MISS — execute search
    try {
      const result: SearchResult<MentorDocument> = await elasticsearchService.searchMentors(searchQuery);

      // Track analytics with user context (does not affect cache)
      await elasticsearchService.trackSearch(
        searchQuery.query,
        searchQuery.filters,
        result.total,
        userId,
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

      // Cache generic results without user context
      await CacheService.set(cacheKey, searchResult, SEARCH_CACHE_TTL);

      return searchResult;
    } catch (error) {
      // Fallback to PostgreSQL if Elasticsearch fails
      logger.warn('Elasticsearch search failed, falling back to PostgreSQL', { error });
      return this.searchMentorsWithPostgreSQL(filters);
    }
  }

  /**
   * Search mentors using PostgreSQL (fallback method).
   */
  private static async searchMentorsWithPostgreSQL(filters: any) {
    const cacheKey = buildPgCacheKey(filters);

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
   * Get autocomplete suggestions for mentor names with caching.
   */
  static async autocomplete(query: string, limit: number = 10): Promise<string[]> {
    // Early return for empty or too-short queries
    const normalised = query.toLowerCase().trim();
    if (normalised.length < 2) {
      return [];
    }
    const cacheKey = `mm:search:autocomplete:${normalised}:${limit}`;

    const cached = await CacheService.get<string[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const esEnabled = config.elasticsearch.enabled;
    const esConnected = await elasticsearchService.checkConnection();

    let suggestions: string[];

    if (esEnabled && esConnected) {
      suggestions = await elasticsearchService.autocomplete(query, 'name', limit);
    } else {
      // Fallback to PostgreSQL for autocomplete
      const result = await pool.query(
        `SELECT name FROM users WHERE role = 'mentor' AND name ILIKE $1 LIMIT $2`,
        [`${query}%`, limit],
      );
      suggestions = result.rows.map((row: any) => row.name);
    }

    await CacheService.set(cacheKey, suggestions, AUTOCOMPLETE_CACHE_TTL);
    return suggestions;
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
      [mentorId],
    );

    if (result.rows.length === 0) {
      return [];
    }

    const expertise = result.rows[0].expertise;
    const similarResult = await pool.query(
      `SELECT * FROM users WHERE role = 'mentor' AND id != $1 AND expertise && $2 LIMIT $3`,
      [mentorId, expertise, limit],
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

    return [];
  }

  /**
   * Unified global search across mentors, sessions, and messages.
   * Results are tagged with a `type` field and concatenated in the order:
   * mentors → sessions → messages. An optional `types` filter restricts
   * which entity kinds are queried.
   */
  static async globalSearch(options: GlobalSearchOptions): Promise<GlobalSearchResult> {
    const { query, userId, page = 1, limit = 10 } = options;
    const types: GlobalSearchResultType[] = options.types && options.types.length > 0
      ? options.types
      : ['mentor', 'session', 'message'];

    const cacheKey = `mm:search:global:${hashParams({ query, types: [...types].sort(), page, limit, userId })}`;

    const cached = await CacheService.get<GlobalSearchResult>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const offset = (page - 1) * limit;
    const results: GlobalSearchItem[] = [];
    let total = 0;

    // ----- Mentors -----
    if (types.includes('mentor')) {
      try {
        const mentorResult = await SearchService.searchMentors(
          { query, page, limit },
          userId,
        );
        const mentors = (mentorResult.mentors as any[]).map((m: any) => ({
          ...m,
          type: 'mentor' as GlobalSearchResultType,
        }));
        results.push(...mentors);
        total += mentorResult.meta?.total ?? mentors.length;
      } catch (err) {
        // Non-fatal: continue with other types
        console.error('[globalSearch] mentor search failed:', err);
      }
    }

    // ----- Sessions / Bookings -----
    if (types.includes('session')) {
      try {
        const pattern = `%${query}%`;
        const sessionRows = await pool.query<{
          id: string;
          title: string | null;
          description: string | null;
          scheduled_at: string;
          status: string;
          mentor_id: string;
          mentee_id: string;
          total_count: string;
        }>(
          `SELECT id, title, description, scheduled_at, status, mentor_id, mentee_id,
                  'session' AS type,
                  COUNT(*) OVER() AS total_count
           FROM bookings
           WHERE (mentor_id = $1 OR mentee_id = $1)
             AND (title ILIKE $2 OR description ILIKE $2)
             AND status NOT IN ('cancelled')
           ORDER BY scheduled_at DESC
           LIMIT $3 OFFSET $4`,
          [userId, pattern, limit, offset],
        );

        const sessions = sessionRows.rows.map((row) => ({
          ...row,
          type: 'session' as GlobalSearchResultType,
        }));
        results.push(...sessions);
        total += parseInt(sessionRows.rows[0]?.total_count ?? '0', 10);
      } catch (err) {
        console.error('[globalSearch] session search failed:', err);
      }
    }

    // ----- Messages -----
    if (types.includes('message')) {
      try {
        const messagingService = new MessagingService();
        const messageResult = await messagingService.searchMessages(userId, query, page, limit);
        const messages = (messageResult.results as any[]).map((m: any) => ({
          ...m,
          type: 'message' as GlobalSearchResultType,
        }));
        results.push(...messages);
        total += messageResult.total;
      } catch (err) {
        console.error('[globalSearch] message search failed:', err);
      }
    }

    const searchResult: GlobalSearchResult = {
      results,
      meta: {
        total,
        page,
        limit,
        types,
      },
    };

    await CacheService.set(cacheKey, searchResult, CacheTTL.short);

    return searchResult;
  }
}
