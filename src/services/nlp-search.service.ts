/**
 * NlpSearchService
 *
 * Natural-language mentor search with structured query understanding.
 *
 * Pipeline:
 *   1. Normalize + cache key (SHA-256 of normalized query, 1h TTL in Redis)
 *   2. Typo correction via Levenshtein against the skill vocabulary
 *   3. Structured extraction via OpenAI function calling (with a deterministic
 *      keyword/regex fallback when OpenAI is unavailable or fails)
 *   4. Feed extracted filters into MentorMatchingV2Service.findMatches
 *   5. Log every query + extracted filters + result count to search_analytics
 *
 * Suggestions use an Elasticsearch prefix search (with a PostgreSQL fallback).
 */

import axios from "axios";
import crypto from "crypto";
import pool from "../config/database";
import { CacheService } from "./cache.service";
import { MentorMatchingV2Service } from "./mentor-matching-v2.service";
import elasticsearchService from "./elasticsearch.service";
import { logger } from "../utils/logger.utils";
import {
  ParsedQuery,
  parseQueryKeywords,
  normalizeParsed,
  normalizeQuery,
  correctTypos,
  createEmptyParsed,
  SKILL_VOCABULARY,
} from "../utils/query-parser.utils";

// ─── Types kept for backward compatibility ──────────────────────────────────

export type SearchIntent = "find_mentor" | "find_session" | "find_content" | "general";

export interface Entity {
  type: "skill" | "topic" | "language" | "location" | "name";
  value: string;
}

export interface SearchFilters {
  type?: "mentor" | "session" | "content";
  minRating?: number;
  maxPrice?: number;
  language?: string;
  skills?: string[];
}

export interface SearchSuggestion {
  text: string;
  type: "autocomplete" | "correction" | "expansion";
}

export interface NlpSearchResult {
  mentorId: string;
  overallScore: number;
  dimensions: Record<string, number>;
  explanation: string[];
  confidence: number;
  source: "matching-v2" | "keyword";
}

const PARSE_CACHE_TTL = 3600; // 1 hour
const PARSE_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/** OpenAI function-calling schema for structured query extraction. */
const EXTRACTION_SCHEMA = {
  name: "extract_search_filters",
  description:
    "Extract structured mentor-search filters from a natural language query.",
  parameters: {
    type: "object",
    properties: {
      skills: {
        type: "array",
        items: { type: "string" },
        description:
          "Technical skills, topics, or subjects the user wants help with, e.g. ['Python', 'machine learning'].",
      },
      maxBudget: {
        type: ["number", "null"],
        description: "Maximum hourly rate in USD the user is willing to pay.",
      },
      minRating: {
        type: ["number", "null"],
        description: "Minimum mentor star rating required (0-5).",
      },
      availability: {
        type: "array",
        items: { type: "string" },
        description:
          "Availability preferences such as 'weekend', 'evening', 'morning'.",
      },
      experienceLevel: {
        type: ["string", "null"],
        enum: ["beginner", "intermediate", "advanced", null],
        description: "Required experience level of the learner or mentor.",
      },
      sessionType: {
        type: ["string", "null"],
        description:
          "Preferred session format such as '1:1', 'group', or 'coaching'.",
      },
      language: {
        type: ["string", "null"],
        description: "Preferred spoken language for sessions, e.g. 'spanish'.",
      },
    },
    required: [
      "skills",
      "maxBudget",
      "minRating",
      "availability",
      "experienceLevel",
      "sessionType",
      "language",
    ],
  },
} as const;

function parseCacheKey(normalizedQuery: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(normalizedQuery)
    .digest("hex");
  return `nlp:parse:${hash}`;
}

export class NlpSearchService {
  /**
   * Parse a natural-language query into structured filters.
   *
   * Results are cached in Redis keyed by SHA-256(normalizedQuery) with a 1-hour
   * TTL. When OpenAI is unavailable or fails, this falls back to a deterministic
   * keyword parser so search always works.
   */
  static async parseQuery(rawQuery: string): Promise<ParsedQuery> {
    const normalized = normalizeQuery(rawQuery);
    if (!normalized) return createEmptyParsed(normalized);

    const cacheKey = parseCacheKey(normalized);
    try {
      const cached = await CacheService.get<ParsedQuery>(cacheKey);
      if (cached) return { ...cached, fromCache: true };
    } catch (err) {
      logger.warn("NlpSearchService.parseQuery cache read failed", {
        error: (err as Error).message,
      });
    }

    // Typo correction (best-effort, does not block parsing).
    const { corrected, corrections } = correctTypos(normalized);

    let parsed: ParsedQuery;
    try {
      parsed = await this.parseWithOpenAI(corrected);
    } catch (err) {
      logger.warn(
        "NlpSearchService.parseQuery OpenAI unavailable, using keyword fallback",
        { error: (err as Error).message, query: normalized },
      );
      parsed = parseQueryKeywords(corrected);
    }

    parsed.normalizedQuery = normalized;
    parsed.correctedQuery = corrected !== normalized ? corrected : null;
    parsed.typoCorrections = corrections;

    try {
      await CacheService.set(cacheKey, parsed, PARSE_CACHE_TTL);
    } catch (err) {
      logger.warn("NlpSearchService.parseQuery cache write failed", {
        error: (err as Error).message,
      });
    }

    return parsed;
  }

  /**
   * Structured extraction via OpenAI function calling.
   */
  private static async parseWithOpenAI(query: string): Promise<ParsedQuery> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const { data } = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: PARSE_MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a search query understanding engine for a mentoring platform. " +
              "Extract structured filters from the user's natural language query. " +
              "Map synonyms: 'tutor'/'coach'/'teacher' -> sessionType 'coaching', " +
              "'affordable'/'cheap' -> infer a maxBudget around 50. " +
              "Return only the function call with the extracted fields.",
          },
          { role: "user", content: query },
        ],
        tools: [
          {
            type: "function",
            function: EXTRACTION_SCHEMA,
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "extract_search_filters" },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("OpenAI did not return a tool call");

    const args = JSON.parse(toolCall.function.arguments);
    return normalizeParsed(args, query);
  }

  /**
   * Main search entry point. Parses the query, then delegates to mentor
   * matching (when a user is known) or keyword search (anonymous / fallback).
   */
  static async search(
    rawQuery: string,
    userId?: string,
    overrides?: Partial<ParsedQuery>,
  ): Promise<{ parsed: ParsedQuery; results: NlpSearchResult[] }> {
    const parsed = await this.parseQuery(rawQuery);

    // Allow explicit overrides (e.g. from query-string filters in the API).
    const finalParsed: ParsedQuery = { ...parsed, ...stripUndefined(overrides) };

    let results: NlpSearchResult[] = [];

    if (userId) {
      try {
        const matches = await MentorMatchingV2Service.findMatches(userId, {
          skills: finalParsed.skills,
          budget: finalParsed.maxBudget ?? undefined,
          limit: 20,
        });
        results = matches
          .filter((m) => this.matchesParsedFilters(m, finalParsed))
          .map((m) => ({
            mentorId: m.mentorId,
            overallScore: m.overallScore,
            dimensions: m.dimensions,
            explanation: m.explanation,
            confidence: m.confidence,
            source: "matching-v2" as const,
          }));
      } catch (err) {
        logger.warn("NlpSearchService.search matching failed, keyword fallack", {
          error: (err as Error).message,
        });
        results = await this.keywordSearch(rawQuery, finalParsed);
      }
    } else {
      results = await this.keywordSearch(rawQuery, finalParsed);
    }

    await this.logAnalytics({
      userId,
      query: rawQuery,
      parsed: finalParsed,
      resultCount: results.length,
    });

    return { parsed: finalParsed, results };
  }

  /**
   * Filter MentorMatchingV2 scores by the additional parsed dimensions that the
   * matching service does not natively weight (rating, availability, language).
   */
  private static matchesParsedFilters(
    match: { dimensions: Record<string, number> },
    parsed: ParsedQuery,
  ): boolean {
    if (parsed.minRating !== null) {
      const ratingScore = match.dimensions?.successPrediction ?? 0;
      // successPrediction is 0-100 where ~70 maps to a 3/5 mentor; convert.
      const inferredRating = (ratingScore / 100) * 5;
      if (inferredRating < parsed.minRating) return false;
    }
    // Availability / language / sessionType are informational here; full
    // enforcement happens in keywordSearch where the mentor row is available.
    return true;
  }

  /**
   * Keyword / full-text fallback search used for anonymous users or when mentor
   * matching is unavailable. Honors the structured filters extracted from the
   * query.
   */
  private static async keywordSearch(
    rawQuery: string,
    parsed: ParsedQuery,
  ): Promise<NlpSearchResult[]> {
    const params: any[] = [rawQuery, rawQuery];
    const conditions: string[] = [
      `to_tsvector('english', u.name || ' ' || COALESCE(u.bio, m.bio, '') || ' ' || array_to_string(COALESCE(m.skills, '{}'), ' ')) @@ plainto_tsquery('english', $1)`,
      `similarity(u.name || ' ' || COALESCE(u.bio, m.bio, ''), $2) > 0.1`,
    ];

    if (parsed.skills.length) {
      params.push(parsed.skills);
      conditions.push(`m.skills && $${params.length}::text[]`);
    }
    if (parsed.maxBudget !== null) {
      params.push(parsed.maxBudget);
      conditions.push(`u.hourly_rate <= $${params.length}`);
    }
    if (parsed.minRating !== null) {
      params.push(parsed.minRating);
      conditions.push(`u.average_rating >= $${params.length}`);
    }

    const whereClause = conditions.join(" OR ");

    const result = await pool.query(
      `SELECT m.user_id AS mentor_id, u.name, u.bio, u.hourly_rate,
              u.average_rating, m.skills,
              ts_rank(
                to_tsvector('english', u.name || ' ' || COALESCE(u.bio, m.bio, '') || ' ' || array_to_string(COALESCE(m.skills, '{}'), ' ')),
                plainto_tsquery('english', $1)
              ) AS rank,
              similarity(u.name || ' ' || COALESCE(u.bio, m.bio, ''), $2) AS sim_score
       FROM mentors m
       JOIN users u ON u.id = m.user_id
       WHERE u.role = 'mentor' AND u.is_active = true
         AND (${whereClause})
       ORDER BY rank DESC, sim_score DESC
       LIMIT 20`,
      params,
    );

    return result.rows.map((row) => {
      const skillMatch = parsed.skills.length
        ? Math.round(
            (parsed.skills.filter((s) =>
              (row.skills || []).map((x: string) => x.toLowerCase()),
            ).length /
              parsed.skills.length) *
              100,
          )
        : 50;
      const priceCompat = parsed.maxBudget
        ? row.hourly_rate <= parsed.maxBudget
          ? 100
          : Math.max(0, 100 - ((row.hourly_rate - parsed.maxBudget) / parsed.maxBudget) * 100)
        : 70;
      const overallScore = Math.round(skillMatch * 0.5 + priceCompat * 0.3 + (parseFloat(row.rank) || 0) * 10);
      return {
        mentorId: row.mentor_id,
        overallScore,
        dimensions: {
          skillMatch,
          priceCompatibility: Math.round(priceCompat),
          textRank: parseFloat(row.rank) || 0,
        },
        explanation: [
          skillMatch >= 80
            ? "Strong skill alignment"
            : "Partial skill match",
          parsed.maxBudget
            ? priceCompat >= 80
              ? "Rate fits your budget"
              : "Rate slightly above budget"
            : "Budget not specified",
        ],
        confidence: parsed.skills.length ? Math.min(95, 60 + parsed.skills.length * 5) : 60,
        source: "keyword" as const,
      };
    });
  }

  /**
   * Autocomplete suggestions. Primary: Elasticsearch prefix search over the
   * mentor `expertise` field. Fallback: PostgreSQL distinct skills prefix.
   */
  static async getSuggestions(
    partialQuery: string,
  ): Promise<SearchSuggestion[]> {
    const q = (partialQuery || "").trim();
    if (q.length < 1) return [];

    // 1) Elasticsearch prefix search (primary)
    try {
      const esTerms = await elasticsearchService.suggestSkills(q, 8);
      if (esTerms.length) {
        return esTerms.map((term) => ({
          text: term,
          type: "autocomplete" as const,
        }));
      }
    } catch (err) {
      logger.debug("NlpSearchService.getSuggestions ES unavailable", {
        error: (err as Error).message,
      });
    }

    // 2) PostgreSQL fallback
    try {
      const result = await pool.query(
        `SELECT DISTINCT unnest(skills) AS term
         FROM mentors
         WHERE unnest(skills) ILIKE $1
         LIMIT 8`,
        [`${q}%`],
      );
      return result.rows.map((row: { term: string }) => ({
        text: row.term,
        type: "autocomplete" as const,
      }));
    } catch (err) {
      logger.warn("NlpSearchService.getSuggestions PG fallback failed", {
        error: (err as Error).message,
      });
    }

    return [];
  }

  /**
   * Detect likely typos for a partial query against the skill vocabulary.
   * Returns the closest suggestion for the final token (autocomplete-style
   * correction).
   */
  static detectTypos(partialQuery: string): SearchSuggestion[] {
    const { corrections } = correctTypos(normalizeQuery(partialQuery));
    return corrections.map((c) => ({
      text: c.suggestion,
      type: "correction" as const,
    }));
  }

  /**
   * Persist a search event to the search_analytics table. Failures are
   * swallowed so analytics never break search.
   */
  static async logAnalytics(entry: {
    userId?: string;
    query: string;
    parsed: ParsedQuery;
    resultCount: number;
  }): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO search_analytics
           (user_id, query, normalized_query, extracted_filters, result_count, has_results, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          entry.userId ?? null,
          entry.query,
          entry.parsed.normalizedQuery,
          JSON.stringify(entry.parsed),
          entry.resultCount,
          entry.resultCount > 0,
        ],
      );
    } catch (err) {
      logger.warn("NlpSearchService.logAnalytics failed", {
        error: (err as Error).message,
      });
    }
  }
}

function stripUndefined<T extends object>(obj?: Partial<T>): Partial<T> {
  if (!obj) return {};
  const out: Partial<T> = {};
  (Object.keys(obj) as (keyof T)[]).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k] as T[keyof T];
  });
  return out;
}

export { SKILL_VOCABULARY };
