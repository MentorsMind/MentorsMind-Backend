/**
 * Advanced NLP Search Controller
 *
 * Handles natural language mentor search queries with:
 * - Structured intent extraction
 * - Smart filtering and ranking
 * - Search suggestions and corrections
 * - Query debugging/explanation
 */

import { Request, Response, NextFunction } from "express";
import { AdvancedNlpSearchService } from "../services/advanced-nlp-search.service";
import { logger } from "../utils/logger.utils";
import { AppError } from "../types/error.types";
import { VALIDATION_CODES } from "../constants/error-codes";

export const AdvancedNlpSearchController = {
  /**
   * POST /api/v1/search/mentors/nlp
   *
   * Search mentors using natural language query
   *
   * Request body:
   * {
   *   "query": "I need a Python tutor for beginners under $50/hour available on weekends",
   *   "limit": 20,
   *   "offset": 0
   * }
   *
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "mentors": [...],
   *     "intent": { parsed intent structure },
   *     "totalCount": 15,
   *     "searchQuality": "high",
   *     "explanation": "Found mentors matching: Python skill, beginner level, under $50/hour, available on weekends"
   *   }
   * }
   */
  async searchMentorsNlp(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { query, limit = 20, offset = 0 } = req.body;
      const userId = (req as any).user?.id;

      if (!query || typeof query !== "string" || query.trim().length < 2) {
        throw new AppError(
          VALIDATION_CODES.MISSING_REQUIRED_FIELD as any,
          "Query must be at least 2 characters"
        );
      }

      const trimmedQuery = query.trim();

      // Execute search
      const result = await AdvancedNlpSearchService.searchMentors(
        trimmedQuery,
        Math.min(limit, 100),
        Math.max(offset, 0)
      );

      // Generate explanation of search
      const explanation = generateSearchExplanation(result.intent);

      // Log search for analytics
      await logSearchQuery(userId, trimmedQuery, result.intent, result.mentors);

      res.status(200).json({
        status: "success",
        data: {
          mentors: result.mentors,
          intent: result.intent,
          totalCount: result.totalCount,
          searchQuality: result.searchQuality,
          explanation,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/search/mentors/nlp/parse
   *
   * Parse a query without searching (useful for debugging)
   * Shows what the NLP system understood about the query
   *
   * Query params:
   * - query: Natural language query
   *
   * Response shows parsed intent with confidence score
   */
  async parseQuery(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { query } = req.query;

      if (!query || typeof query !== "string" || query.length < 2) {
        throw new AppError(
          VALIDATION_CODES.MISSING_REQUIRED_FIELD as any,
          "Query parameter required (minimum 2 characters)"
        );
      }

      const intent = AdvancedNlpSearchService.parseQuery(query);

      res.status(200).json({
        status: "success",
        data: {
          query,
          intent,
          explanation: generateSearchExplanation(intent),
          confidence: intent.confidence,
          confidenceLevel:
            intent.confidence > 0.7
              ? "high"
              : intent.confidence > 0.4
                ? "medium"
                : "low",
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/search/suggestions
   *
   * Get search suggestions for autocomplete/typeahead
   *
   * Query params:
   * - q: Partial query for suggestions
   *
   * Response includes:
   * - Skills matching the query
   * - Mentor names
   * - Smart suggestions based on context
   */
  async getSuggestions(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { q } = req.query;

      if (!q || typeof q !== "string" || q.length < 1) {
        return res.status(200).json({
          status: "success",
          data: { suggestions: [] },
        });
      }

      const suggestions = await AdvancedNlpSearchService.getSuggestions(q);

      res.status(200).json({
        status: "success",
        data: { suggestions },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/search/explain
   *
   * Explain what the search system understood about a query
   * Useful for user education and debugging
   *
   * Request body:
   * { "query": "..." }
   *
   * Response explains:
   * - Skills extracted
   * - Filters applied
   * - Confidence level
   * - Why certain mentors are ranked first
   */
  async explainQuery(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { query } = req.body;

      if (!query || typeof query !== "string" || query.length < 2) {
        throw new AppError(
          VALIDATION_CODES.MISSING_REQUIRED_FIELD as any,
          "Query required (minimum 2 characters)"
        );
      }

      const intent = AdvancedNlpSearchService.parseQuery(query);
      const explanation = generateDetailedExplanation(intent);

      res.status(200).json({
        status: "success",
        data: {
          query,
          intent,
          explanation,
          metrics: {
            confidence: intent.confidence,
            skillsExtracted: intent.skills.length,
            filtersApplied: countFilters(intent),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate human-readable explanation of search intent
 */
function generateSearchExplanation(intent: any): string {
  const parts: string[] = [];

  if (intent.skills && intent.skills.length > 0) {
    parts.push(`skills: ${intent.skills.join(", ")}`);
  }

  if (intent.experienceLevel) {
    parts.push(`experience level: ${intent.experienceLevel}`);
  }

  if (intent.maxRate) {
    parts.push(`hourly rate: under $${intent.maxRate}`);
  } else if (intent.minRate) {
    parts.push(`hourly rate: at least $${intent.minRate}`);
  }

  if (intent.availableDays && intent.availableDays.length > 0) {
    parts.push(`available: ${intent.availableDays.join(", ")}`);
  }

  if (intent.minRating) {
    parts.push(`minimum rating: ${intent.minRating} stars`);
  }

  if (intent.teachingStyle && intent.teachingStyle.length > 0) {
    parts.push(`teaching style: ${intent.teachingStyle.join(", ")}`);
  }

  if (parts.length === 0) {
    return "No specific filters applied - showing all available mentors";
  }

  return `Found mentors matching: ${parts.join(" • ")}`;
}

/**
 * Generate detailed explanation with reasoning
 */
function generateDetailedExplanation(intent: any): Record<string, any> {
  return {
    skillsExtracted: {
      values: intent.skills,
      explanation:
        intent.skills.length > 0
          ? `System identified request for ${intent.skills.join(", ")} mentors`
          : "No specific skill mentioned",
    },
    priceFilter: {
      applied: intent.maxRate !== undefined || intent.minRate !== undefined,
      maxRate: intent.maxRate,
      minRate: intent.minRate,
      explanation:
        intent.maxRate
          ? `Budget limit: up to $${intent.maxRate}/hour`
          : intent.minRate
            ? `Budget floor: at least $${intent.minRate}/hour`
            : "No price preference specified",
    },
    availability: {
      applied: intent.availableDays && intent.availableDays.length > 0,
      days: intent.availableDays,
      explanation:
        intent.availableDays && intent.availableDays.length > 0
          ? `Available on: ${intent.availableDays.join(", ")}`
          : "Flexible availability - any time",
    },
    experience: {
      level: intent.experienceLevel,
      yearsMin: intent.yearsOfExperience?.min,
      explanation:
        intent.experienceLevel
          ? `Seeking ${intent.experienceLevel} level instruction`
          : "No specific experience level mentioned",
    },
    confidence: {
      score: intent.confidence,
      level:
        intent.confidence > 0.7
          ? "HIGH"
          : intent.confidence > 0.4
            ? "MEDIUM"
            : "LOW",
      meaning:
        intent.confidence > 0.7
          ? "System is confident about understanding the request"
          : intent.confidence > 0.4
            ? "System partially understood - some context may be missing"
            : "System has low confidence - consider rewording query",
    },
  };
}

/**
 * Count number of filters applied
 */
function countFilters(intent: any): number {
  let count = 0;

  if (intent.skills && intent.skills.length > 0) count++;
  if (intent.maxRate !== undefined || intent.minRate !== undefined) count++;
  if (intent.experienceLevel) count++;
  if (intent.availableDays && intent.availableDays.length > 0) count++;
  if (intent.minRating) count++;
  if (intent.teachingStyle && intent.teachingStyle.length > 0) count++;

  return count;
}

/**
 * Log search query for analytics
 */
async function logSearchQuery(
  userId: string | undefined,
  query: string,
  intent: any,
  results: any[]
): Promise<void> {
  try {
    logger.info("NLP search executed", {
      userId,
      query,
      skillsSearched: intent.skills,
      filtersApplied: countFilters(intent),
      resultsCount: results.length,
      confidence: intent.confidence,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn("Failed to log search query", { error: String(err) });
  }
}
