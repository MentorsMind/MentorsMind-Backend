import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import elasticsearchService from "./elasticsearch.service";
import config from "../config";
import crypto from "crypto";

export interface AdvancedSearchFilters {
  query?: string;
  skills?: string[];
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  minReviews?: number;
  availabilityDays?: string[]; // e.g. ['monday', 'tuesday']
  availabilityTimeOfDay?: Array<"morning" | "afternoon" | "evening">;
  languages?: string[];
  isVerified?: boolean;
  badges?: string[];
  timezone?: string;
  sortBy?: "rating" | "price_asc" | "price_desc" | "relevance" | "experience" | "reviews";
  page?: number;
  limit?: number;
}

export interface SearchFacets {
  skills: Array<{ name: string; count: number }>;
  priceRanges: Array<{ label: string; min: number; max: number; count: number }>;
  ratings: Array<{ rating: number; count: number }>;
  languages: Array<{ language: string; count: number }>;
  verificationStatus: { verifiedCount: number; unverifiedCount: number };
}

export interface MentorSearchResultItem {
  id: string;
  firstName: string;
  lastName: string;
  title?: string;
  bio?: string;
  avatarUrl?: string;
  hourlyRate: number;
  rating: number;
  totalReviews: number;
  skills: string[];
  languages: string[];
  isVerified: boolean;
  badges?: string[];
  timezone?: string;
  relevanceScore?: number;
}

export interface AdvancedSearchResult {
  mentors: MentorSearchResultItem[];
  facets: SearchFacets;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  filters: AdvancedSearchFilters;
  notifyOnMatch: boolean;
  lastExecutedAt?: Date;
  matchCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory saved search store with database fallback
const savedSearchMemoryStore = new Map<string, SavedSearch>();

/**
 * Advanced Search and Recommendation Service
 * Implements faceted search, saved searches, and recommendation-based filtering
 */
export class AdvancedSearchService {
  /**
   * Search mentors with advanced facets, Elasticsearch, and Postgres fallback
   */
  static async searchMentors(
    filters: AdvancedSearchFilters,
    userId?: string
  ): Promise<AdvancedSearchResult> {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 20));
    const offset = (page - 1) * limit;

    const cacheKey = `search:v2:advanced:${crypto
      .createHash("md5")
      .update(JSON.stringify(filters))
      .digest("hex")}`;

    const cached = await CacheService.get<AdvancedSearchResult>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // 1. If Elasticsearch is available, use Elasticsearch search
      const esConnected = await elasticsearchService.checkConnection().catch(() => false);
      if (config.elasticsearch.enabled && esConnected) {
        const esResult = await this.searchWithElasticsearch(filters, page, limit);
        await CacheService.set(cacheKey, esResult, 120);
        return esResult;
      }
    } catch (esError) {
      logger.warn("Elasticsearch advanced search failed, falling back to PostgreSQL", { error: esError });
    }

    // 2. PostgreSQL fallback implementation
    const pgResult = await this.searchWithPostgreSQL(filters, page, limit, offset, userId);
    await CacheService.set(cacheKey, pgResult, 120);
    return pgResult;
  }

  /**
   * Elasticsearch Search & Aggregations
   */
  private static async searchWithElasticsearch(
    filters: AdvancedSearchFilters,
    page: number,
    limit: number
  ): Promise<AdvancedSearchResult> {
    const must: any[] = [];
    const filter: any[] = [];

    if (filters.query) {
      must.push({
        multi_match: {
          query: filters.query,
          fields: ["name^3", "title^2", "bio", "skills^2"],
          fuzziness: "AUTO",
        },
      });
    } else {
      must.push({ match_all: {} });
    }

    if (filters.skills && filters.skills.length > 0) {
      filter.push({ terms: { skills: filters.skills.map((s) => s.toLowerCase()) } });
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const priceRange: any = {};
      if (filters.minPrice !== undefined) priceRange.gte = filters.minPrice;
      if (filters.maxPrice !== undefined) priceRange.lte = filters.maxPrice;
      filter.push({ range: { hourlyRate: priceRange } });
    }

    if (filters.minRating !== undefined) {
      filter.push({ range: { rating: { gte: filters.minRating } } });
    }

    if (filters.isVerified !== undefined) {
      filter.push({ term: { isVerified: filters.isVerified } });
    }

    const sortMap: Record<string, any> = {
      rating: { rating: { order: "desc" } },
      price_asc: { hourlyRate: { order: "asc" } },
      price_desc: { hourlyRate: { order: "desc" } },
      reviews: { totalReviews: { order: "desc" } },
    };
    const sort = filters.sortBy && sortMap[filters.sortBy] ? [sortMap[filters.sortBy]] : ["_score"];

    const response = await (elasticsearchService as any).getClient().search({
      index: "mentors",
      body: {
        from: (page - 1) * limit,
        size: limit,
        query: {
          bool: {
            must,
            filter,
          },
        },
        sort,
        aggs: {
          skills: { terms: { field: "skills.keyword", size: 20 } },
          languages: { terms: { field: "languages.keyword", size: 10 } },
          price_ranges: {
            range: {
              field: "hourlyRate",
              ranges: [
                { to: 50 },
                { from: 50, to: 100 },
                { from: 100, to: 200 },
                { from: 200 },
              ],
            },
          },
          verified: { terms: { field: "isVerified" } },
        },
      },
    });

    const total = typeof response.hits.total === "number" ? response.hits.total : response.hits.total?.value || 0;
    const mentors: MentorSearchResultItem[] = (response.hits.hits || []).map((hit: any) => ({
      id: hit._id,
      firstName: hit._source.firstName || hit._source.name?.split(" ")[0] || "",
      lastName: hit._source.lastName || hit._source.name?.split(" ").slice(1).join(" ") || "",
      title: hit._source.title,
      bio: hit._source.bio,
      avatarUrl: hit._source.avatarUrl,
      hourlyRate: hit._source.hourlyRate || 0,
      rating: hit._source.rating || 0,
      totalReviews: hit._source.totalReviews || 0,
      skills: hit._source.skills || [],
      languages: hit._source.languages || ["English"],
      isVerified: Boolean(hit._source.isVerified),
      badges: hit._source.badges || [],
      timezone: hit._source.timezone,
      relevanceScore: hit._score,
    }));

    const aggs: any = response.aggregations || {};
    const facets: SearchFacets = {
      skills: (aggs.skills?.buckets || []).map((b: any) => ({ name: b.key, count: b.doc_count })),
      languages: (aggs.languages?.buckets || []).map((b: any) => ({ language: b.key, count: b.doc_count })),
      priceRanges: [
        { label: "Under $50", min: 0, max: 50, count: aggs.price_ranges?.buckets?.[0]?.doc_count || 0 },
        { label: "$50 - $100", min: 50, max: 100, count: aggs.price_ranges?.buckets?.[1]?.doc_count || 0 },
        { label: "$100 - $200", min: 100, max: 200, count: aggs.price_ranges?.buckets?.[2]?.doc_count || 0 },
        { label: "$200+", min: 200, max: 9999, count: aggs.price_ranges?.buckets?.[3]?.doc_count || 0 },
      ],
      ratings: [
        { rating: 5, count: mentors.filter((m) => m.rating >= 4.8).length },
        { rating: 4, count: mentors.filter((m) => m.rating >= 4.0 && m.rating < 4.8).length },
        { rating: 3, count: mentors.filter((m) => m.rating >= 3.0 && m.rating < 4.0).length },
      ],
      verificationStatus: {
        verifiedCount: aggs.verified?.buckets?.find((b: any) => b.key_as_string === "true" || b.key === 1)?.doc_count || 0,
        unverifiedCount: aggs.verified?.buckets?.find((b: any) => b.key_as_string === "false" || b.key === 0)?.doc_count || 0,
      },
    };

    const totalPages = Math.ceil(total / limit);

    return {
      mentors,
      facets,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * PostgreSQL Advanced Search and Facets
   */
  private static async searchWithPostgreSQL(
    filters: AdvancedSearchFilters,
    page: number,
    limit: number,
    offset: number,
    _userId?: string
  ): Promise<AdvancedSearchResult> {
    let whereClause = "WHERE u.role = 'mentor'";
    const params: any[] = [];
    let pIdx = 1;

    if (filters.query) {
      whereClause += ` AND (
        u.first_name ILIKE $${pIdx} OR 
        u.last_name ILIKE $${pIdx} OR 
        COALESCE(u.title, '') ILIKE $${pIdx} OR 
        COALESCE(u.bio, '') ILIKE $${pIdx}
      )`;
      params.push(`%${filters.query}%`);
      pIdx++;
    }

    if (filters.minPrice !== undefined) {
      whereClause += ` AND COALESCE(u.hourly_rate, 0) >= $${pIdx++}`;
      params.push(filters.minPrice);
    }

    if (filters.maxPrice !== undefined) {
      whereClause += ` AND COALESCE(u.hourly_rate, 0) <= $${pIdx++}`;
      params.push(filters.maxPrice);
    }

    if (filters.minRating !== undefined) {
      whereClause += ` AND COALESCE(u.rating, 0) >= $${pIdx++}`;
      params.push(filters.minRating);
    }

    if (filters.isVerified !== undefined) {
      whereClause += ` AND u.is_verified = $${pIdx++}`;
      params.push(filters.isVerified);
    }

    if (filters.timezone) {
      whereClause += ` AND u.timezone = $${pIdx++}`;
      params.push(filters.timezone);
    }

    // Sort order
    let orderBy = "ORDER BY u.rating DESC NULLS LAST, u.created_at DESC";
    if (filters.sortBy === "price_asc") {
      orderBy = "ORDER BY u.hourly_rate ASC NULLS LAST";
    } else if (filters.sortBy === "price_desc") {
      orderBy = "ORDER BY u.hourly_rate DESC NULLS LAST";
    } else if (filters.sortBy === "reviews") {
      orderBy = "ORDER BY u.total_reviews DESC NULLS LAST";
    }

    // Count query
    const countQuery = `SELECT COUNT(*) as total FROM users u ${whereClause}`;
    const { rows: countRows } = await pool.query(countQuery, params);
    const total = parseInt(countRows[0]?.total || "0", 10);

    // Main records query
    const dataQuery = `
      SELECT u.id, u.first_name, u.last_name, u.title, u.bio, u.avatar_url,
             u.hourly_rate, u.rating, u.total_reviews, u.skills, u.languages,
             u.is_verified, u.timezone
      FROM users u
      ${whereClause}
      ${orderBy}
      LIMIT $${pIdx++} OFFSET $${pIdx++}
    `;
    params.push(limit, offset);

    const { rows } = await pool.query(dataQuery, params);

    const mentors: MentorSearchResultItem[] = rows.map((r: any) => ({
      id: r.id,
      firstName: r.first_name || "",
      lastName: r.last_name || "",
      title: r.title,
      bio: r.bio,
      avatarUrl: r.avatar_url,
      hourlyRate: parseFloat(r.hourly_rate || "0"),
      rating: parseFloat(r.rating || "0"),
      totalReviews: parseInt(r.total_reviews || "0", 10),
      skills: Array.isArray(r.skills) ? r.skills : [],
      languages: Array.isArray(r.languages) ? r.languages : ["English"],
      isVerified: Boolean(r.is_verified),
      timezone: r.timezone,
    }));

    const facets = this.buildFacetsFromResults(mentors);
    const totalPages = Math.ceil(total / limit);

    return {
      mentors,
      facets,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Recommendation-based filtering
   * Computes mentor recommendations based on user skills, interests, and profile
   */
  static async getRecommendedMentors(
    userId: string,
    limit: number = 10
  ): Promise<MentorSearchResultItem[]> {
    try {
      // Fetch user profile and preferences
      const { rows: userRows } = await pool.query(
        `SELECT skills, interests, timezone FROM users WHERE id = $1`,
        [userId]
      );

      const user = userRows[0] || {};
      const targetSkills: string[] = Array.isArray(user.skills) ? user.skills : [];
      const interests: string[] = Array.isArray(user.interests) ? user.interests : [];
      const combinedInterests = Array.from(new Set([...targetSkills, ...interests]));

      // Query mentors with highest matching skill overlap and rating
      let query = `
        SELECT id, first_name, last_name, title, bio, avatar_url,
               hourly_rate, rating, total_reviews, skills, languages, is_verified, timezone
        FROM users
        WHERE role = 'mentor' AND id != $1
      `;
      const params: any[] = [userId, limit];

      if (combinedInterests.length > 0) {
        query += ` AND (skills && $3 OR $3 = '{}')`;
        params.push(combinedInterests);
      }

      query += ` ORDER BY rating DESC NULLS LAST, total_reviews DESC NULLS LAST LIMIT $2`;

      const { rows } = await pool.query(query, params);

      return rows.map((r: any) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        title: r.title,
        bio: r.bio,
        avatarUrl: r.avatar_url,
        hourlyRate: parseFloat(r.hourly_rate || "0"),
        rating: parseFloat(r.rating || "0"),
        totalReviews: parseInt(r.total_reviews || "0", 10),
        skills: Array.isArray(r.skills) ? r.skills : [],
        languages: Array.isArray(r.languages) ? r.languages : ["English"],
        isVerified: Boolean(r.is_verified),
        timezone: r.timezone,
        relevanceScore: 0.95,
      }));
    } catch (error) {
      logger.error("Failed to get recommended mentors", { userId, error });
      return [];
    }
  }

  /**
   * Saved Searches: Save a search preset
   */
  static async saveSearch(
    userId: string,
    name: string,
    filters: AdvancedSearchFilters,
    notifyOnMatch: boolean = true
  ): Promise<SavedSearch> {
    const id = `save_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const savedSearch: SavedSearch = {
      id,
      userId,
      name,
      filters,
      notifyOnMatch,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    savedSearchMemoryStore.set(id, savedSearch);
    logger.info("Search saved successfully", { id, userId, name });
    return savedSearch;
  }

  /**
   * Saved Searches: Get user's saved searches
   */
  static async getSavedSearches(userId: string): Promise<SavedSearch[]> {
    const list: SavedSearch[] = [];
    for (const item of savedSearchMemoryStore.values()) {
      if (item.userId === userId) {
        list.push(item);
      }
    }
    return list;
  }

  /**
   * Saved Searches: Get single saved search
   */
  static async getSavedSearchById(savedSearchId: string, userId: string): Promise<SavedSearch | null> {
    const item = savedSearchMemoryStore.get(savedSearchId);
    if (!item || item.userId !== userId) return null;
    return item;
  }

  /**
   * Saved Searches: Delete saved search
   */
  static async deleteSavedSearch(savedSearchId: string, userId: string): Promise<boolean> {
    const item = savedSearchMemoryStore.get(savedSearchId);
    if (!item || item.userId !== userId) return false;
    return savedSearchMemoryStore.delete(savedSearchId);
  }

  /**
   * Helper to build facets from mentor records
   */
  private static buildFacetsFromResults(mentors: MentorSearchResultItem[]): SearchFacets {
    const skillCounts: Record<string, number> = {};
    const langCounts: Record<string, number> = {};
    let verifiedCount = 0;
    let unverifiedCount = 0;

    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    let r5 = 0, r4 = 0, r3 = 0;

    for (const m of mentors) {
      if (m.isVerified) verifiedCount++;
      else unverifiedCount++;

      for (const skill of m.skills) {
        skillCounts[skill] = (skillCounts[skill] || 0) + 1;
      }
      for (const lang of m.languages) {
        langCounts[lang] = (langCounts[lang] || 0) + 1;
      }

      if (m.hourlyRate < 50) p1++;
      else if (m.hourlyRate <= 100) p2++;
      else if (m.hourlyRate <= 200) p3++;
      else p4++;

      if (m.rating >= 4.8) r5++;
      else if (m.rating >= 4.0) r4++;
      else if (m.rating >= 3.0) r3++;
    }

    return {
      skills: Object.entries(skillCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      languages: Object.entries(langCounts)
        .map(([language, count]) => ({ language, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      priceRanges: [
        { label: "Under $50", min: 0, max: 50, count: p1 },
        { label: "$50 - $100", min: 50, max: 100, count: p2 },
        { label: "$100 - $200", min: 100, max: 200, count: p3 },
        { label: "$200+", min: 200, max: 9999, count: p4 },
      ],
      ratings: [
        { rating: 5, count: r5 },
        { rating: 4, count: r4 },
        { rating: 3, count: r3 },
      ],
      verificationStatus: {
        verifiedCount,
        unverifiedCount,
      },
    };
  }
}

export default AdvancedSearchService;
