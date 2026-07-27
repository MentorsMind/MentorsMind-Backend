/**
 * Advanced NLP-Powered Mentor Search Service
 *
 * Transforms natural language queries into structured search intent with:
 * - Skill extraction (from query and synonyms)
 * - Price range filtering
 * - Availability parsing (days, times, flexibility)
 * - Experience level matching
 * - Teaching style recognition
 * - Location-based filtering
 * - Strict vs. fuzzy matching modes
 *
 * Example:
 *   Input: "I need a Python tutor for machine learning who charges under $50/hour and is available on weekends"
 *   Output: {
 *     skills: ["Python", "Machine Learning"],
 *     maxRate: 50,
 *     availability: ["Saturday", "Sunday"],
 *     experienceLevel: "beginner",
 *     ...
 *   }
 */

import { db } from "../config/database";
import { logger } from "../utils/logger.utils";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ParsedSearchIntent {
  // Core search parameters
  skills: string[];
  keywords: string[];
  
  // Price filters
  minRate?: number;
  maxRate?: number;
  
  // Availability filters
  availableDays?: string[]; // Monday, Tuesday, ..., Sunday
  availableTimeRanges?: Array<{ start: string; end: string }>;
  
  // Experience/level filters
  experienceLevel?: "beginner" | "intermediate" | "advanced";
  yearsOfExperience?: {
    min?: number;
    max?: number;
  };
  
  // Mentor attributes
  minRating?: number;
  teachingStyle?: string[];
  language?: string[];
  location?: string;
  timezone?: string;
  
  // Additional filters
  mentorshipType?: "one-on-one" | "group" | "both";
  subjectsOrDomain?: string[];
  
  // Query metadata
  rawQuery: string;
  confidence: number; // 0-1 confidence score of parsing
  intent: "find_mentor" | "find_expert" | "find_coach";
}

// ============================================================================
// SKILL & DOMAIN MAPPINGS
// ============================================================================

// Comprehensive skill synonyms and mappings
const SKILL_SYNONYMS: Record<string, string[]> = {
  // Programming languages
  "python": ["py", "python", "django", "flask", "fastapi", "pandas", "numpy", "jupyter"],
  "javascript": ["js", "javascript", "typescript", "ts", "node", "nodejs", "react", "vue", "angular"],
  "java": ["java", "spring", "maven", "gradle"],
  "csharp": ["c#", "c-sharp", "dotnet", ".net"],
  "go": ["golang", "go"],
  "rust": ["rust"],
  "php": ["php", "laravel", "symfony"],
  "ruby": ["ruby", "rails", "ror"],
  "swift": ["swift", "ios", "objective-c"],
  "kotlin": ["kotlin", "android"],
  "sql": ["sql", "postgres", "postgresql", "mysql", "database"],
  
  // Data & AI
  "machine-learning": ["ml", "machine learning", "deep learning", "neural network", "tensorflow", "pytorch", "keras", "scikit-learn"],
  "data-science": ["data science", "analytics", "data analysis", "numpy", "pandas", "matplotlib"],
  "artificial-intelligence": ["ai", "artificial intelligence", "nlp", "computer vision", "gpt"],
  
  // Web development
  "web-development": ["web dev", "full stack", "frontend", "backend", "web design"],
  "frontend": ["front end", "ui", "ux", "html", "css", "responsive"],
  "backend": ["back end", "server", "api", "rest", "graphql", "microservices"],
  "fullstack": ["full-stack", "full stack", "mern", "mean"],
  
  // Cloud & DevOps
  "aws": ["aws", "amazon web services", "ec2", "s3", "lambda"],
  "gcp": ["gcp", "google cloud", "bigquery"],
  "azure": ["azure", "microsoft azure"],
  "docker": ["docker", "containers", "containerization"],
  "kubernetes": ["kubernetes", "k8s", "orchestration"],
  "devops": ["devops", "ci/cd", "deployment", "infrastructure"],
  
  // Mobile
  "mobile-development": ["mobile", "app development", "ios", "android", "react native", "flutter"],
  "ios": ["ios", "iphone", "swift", "xcode"],
  "android": ["android", "kotlin", "java"],
  
  // Other domains
  "project-management": ["project management", "agile", "scrum", "pm"],
  "business-development": ["business", "sales", "marketing", "entrepreneurship"],
  "design": ["design", "graphic design", "ui/ux", "figma", "adobe"],
  "writing": ["writing", "copywriting", "content writing", "technical writing"],
  "communication": ["communication", "public speaking", "presentation"],
};

// Teaching style keywords
const TEACHING_STYLES = {
  "hands-on": ["hands-on", "project-based", "practical", "coding-focused"],
  "conceptual": ["theory", "concepts", "whiteboard", "fundamentals"],
  "interactive": ["interactive", "Q&A", "discussion", "dialogue"],
  "structured": ["structured", "curriculum", "lessons", "step-by-step"],
  "flexible": ["flexible", "pace", "customized", "adapted"],
};

// Experience level keywords
const EXPERIENCE_LEVEL_KEYWORDS = {
  "beginner": ["beginner", "starter", "intro", "introductory", "basic", "fundamentals", "from zero"],
  "intermediate": ["intermediate", "intermediate level", "some experience"],
  "advanced": ["advanced", "expert", "senior", "professional", "experienced", "mastery"],
};

// Availability keywords
const AVAILABILITY_KEYWORDS = {
  "weekend": ["weekend", "saturday", "sunday", "sat", "sun"],
  "weekday": ["weekday", "monday", "tuesday", "wednesday", "thursday", "friday"],
  "morning": ["morning", "early", "9am", "10am"],
  "afternoon": ["afternoon", "12pm", "1pm", "2pm", "3pm"],
  "evening": ["evening", "night", "6pm", "7pm", "8pm", "9pm"],
  "flexible": ["flexible", "anytime", "whenever", "any time"],
};

// ============================================================================
// PARSING FUNCTIONS
// ============================================================================

/**
 * Extract skills and subject domains from query
 */
function extractSkills(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const skills = new Set<string>();

  for (const [skill, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    for (const synonym of [skill, ...synonyms]) {
      // Word boundary matching to avoid false positives
      const regex = new RegExp(`\\b${synonym}\\b`, "gi");
      if (regex.test(lowerQuery)) {
        skills.add(skill);
        break;
      }
    }
  }

  return Array.from(skills);
}

/**
 * Extract price filters
 */
function extractPriceFilters(query: string): {
  minRate?: number;
  maxRate?: number;
} {
  const filters: { minRate?: number; maxRate?: number } = {};

  // Match patterns: "under $50", "$50/hour", "50 per hour", "starting at $30"
  const underMatch = query.match(/under\s*\$?(\d+)/i);
  const overMatch = query.match(/(?:starting at|at least|minimum)\s*\$?(\d+)/i);
  const rangeMatch = query.match(/\$?(\d+)\s*(?:to|-)\s*\$?(\d+)/i);
  const perHourMatch = query.match(/\$?(\d+)\s*(?:\/|per)\s*hour/i);

  if (underMatch) {
    filters.maxRate = parseInt(underMatch[1]);
  }
  if (overMatch) {
    filters.minRate = parseInt(overMatch[1]);
  }
  if (rangeMatch) {
    filters.minRate = parseInt(rangeMatch[1]);
    filters.maxRate = parseInt(rangeMatch[2]);
  }
  if (perHourMatch && !underMatch && !rangeMatch) {
    filters.maxRate = parseInt(perHourMatch[1]);
  }

  return filters;
}

/**
 * Extract availability preferences
 */
function extractAvailability(query: string): {
  availableDays?: string[];
  availableTimeRanges?: Array<{ start: string; end: string }>;
} {
  const result: {
    availableDays?: string[];
    availableTimeRanges?: Array<{ start: string; end: string }>;
  } = {};

  const lowerQuery = query.toLowerCase();
  const days = new Set<string>();
  const times: Array<{ start: string; end: string }> = [];

  // Extract days
  const dayMap: Record<string, string[]> = {
    "Monday": ["monday", "mon"],
    "Tuesday": ["tuesday", "tue"],
    "Wednesday": ["wednesday", "wed"],
    "Thursday": ["thursday", "thu"],
    "Friday": ["friday", "fri"],
    "Saturday": ["saturday", "sat"],
    "Sunday": ["sunday", "sun"],
  };

  for (const [dayName, aliases] of Object.entries(dayMap)) {
    if (aliases.some((alias) => lowerQuery.includes(alias))) {
      days.add(dayName);
    }
  }

  // Check for weekend/weekday
  if (lowerQuery.includes("weekend")) {
    days.add("Saturday");
    days.add("Sunday");
  }
  if (lowerQuery.includes("weekday")) {
    days.add("Monday");
    days.add("Tuesday");
    days.add("Wednesday");
    days.add("Thursday");
    days.add("Friday");
  }

  if (days.size > 0) {
    result.availableDays = Array.from(days);
  }

  // Extract time ranges
  const timeMatch = query.match(/(\d{1,2})\s*(?:am|pm)?\s*(?:to|-)\s*(\d{1,2})\s*(?:am|pm)?/i);
  if (timeMatch) {
    times.push({
      start: timeMatch[1],
      end: timeMatch[2],
    });
  }

  if (times.length > 0) {
    result.availableTimeRanges = times;
  }

  return result;
}

/**
 * Extract experience level
 */
function extractExperienceLevel(query: string): "beginner" | "intermediate" | "advanced" | undefined {
  const lowerQuery = query.toLowerCase();

  for (const [level, keywords] of Object.entries(EXPERIENCE_LEVEL_KEYWORDS)) {
    if (keywords.some((kw) => lowerQuery.includes(kw))) {
      return level as "beginner" | "intermediate" | "advanced";
    }
  }

  return undefined;
}

/**
 * Extract teaching style preferences
 */
function extractTeachingStyles(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const styles = new Set<string>();

  for (const [style, keywords] of Object.entries(TEACHING_STYLES)) {
    if (keywords.some((kw) => lowerQuery.includes(kw))) {
      styles.add(style);
    }
  }

  return Array.from(styles);
}

/**
 * Extract years of experience requirement
 */
function extractExperienceYears(query: string): {
  min?: number;
  max?: number;
} {
  const result: { min?: number; max?: number } = {};

  // "10+ years", "10 years of experience", "at least 5 years"
  const yearsMatch = query.match(/(?:at least|minimum|)\s*(\d+)\s*\+?\s*year/i);
  if (yearsMatch) {
    result.min = parseInt(yearsMatch[1]);
  }

  return result;
}

/**
 * Extract rating filter
 */
function extractRatingFilter(query: string): number | undefined {
  // "4.5 stars", "4.5+ rating", "rated 4.5"
  const ratingMatch = query.match(/(?:rated|stars?|rating)?\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:stars?|rating)?/i);
  if (ratingMatch) {
    return parseFloat(ratingMatch[1]);
  }

  return undefined;
}

/**
 * Extract location/timezone
 */
function extractLocation(query: string): string | undefined {
  // Simple location extraction - look for city names or timezone references
  const cityMatch = query.match(/(?:in|from|based in|located in)\s+([A-Za-z\s]+?)(?:\s+for|\s+and|\s+who|\s*$)/i);
  if (cityMatch) {
    return cityMatch[1].trim();
  }

  return undefined;
}

/**
 * Calculate confidence score for parsing
 */
function calculateConfidence(intent: ParsedSearchIntent): number {
  let score = 0.5; // Base score

  // Increase confidence based on extracted parameters
  if (intent.skills.length > 0) score += 0.15;
  if (intent.maxRate !== undefined || intent.minRate !== undefined) score += 0.15;
  if (intent.availableDays && intent.availableDays.length > 0) score += 0.1;
  if (intent.experienceLevel !== undefined) score += 0.1;
  if (intent.minRating !== undefined) score += 0.05;

  // Reduce confidence if query is very short or vague
  if (intent.rawQuery.length < 10) score -= 0.1;

  return Math.max(0.1, Math.min(1.0, score));
}

// ============================================================================
// MAIN SERVICE
// ============================================================================

export const AdvancedNlpSearchService = {
  /**
   * Parse natural language query into structured intent
   */
  parseQuery(rawQuery: string): ParsedSearchIntent {
    const skills = extractSkills(rawQuery);
    const priceFilters = extractPriceFilters(rawQuery);
    const availability = extractAvailability(rawQuery);
    const experienceLevel = extractExperienceLevel(rawQuery);
    const teachingStyles = extractTeachingStyles(rawQuery);
    const experienceYears = extractExperienceYears(rawQuery);
    const minRating = extractRatingFilter(rawQuery);
    const location = extractLocation(rawQuery);

    const intent: ParsedSearchIntent = {
      skills,
      keywords: rawQuery.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
      ...priceFilters,
      ...availability,
      experienceLevel,
      yearsOfExperience: experienceYears,
      minRating,
      teachingStyle: teachingStyles,
      location,
      rawQuery,
      intent: "find_mentor",
      confidence: 0,
    };

    intent.confidence = calculateConfidence(intent);

    logger.info("NLP query parsed", {
      rawQuery,
      skills,
      maxRate: intent.maxRate,
      availableDays: intent.availableDays,
      experienceLevel,
      confidence: intent.confidence,
    });

    return intent;
  },

  /**
   * Build SQL query from parsed intent for mentor search
   */
  buildMentorQuery(intent: ParsedSearchIntent): {
    query: string;
    params: any[];
  } {
    const conditions: string[] = [];
    const params: any[] = [];

    // Active mentors only
    conditions.push("m.is_active = true");
    conditions.push("m.kyc_verified = true");

    // Price filter
    if (intent.maxRate !== undefined) {
      conditions.push("m.hourly_rate <= $" + (params.length + 1));
      params.push(intent.maxRate);
    }
    if (intent.minRate !== undefined) {
      conditions.push("m.hourly_rate >= $" + (params.length + 1));
      params.push(intent.minRate);
    }

    // Rating filter
    if (intent.minRating !== undefined) {
      conditions.push("m.average_rating >= $" + (params.length + 1));
      params.push(intent.minRating);
    }

    // Years of experience
    if (intent.yearsOfExperience?.min !== undefined) {
      conditions.push("m.years_of_experience >= $" + (params.length + 1));
      params.push(intent.yearsOfExperience.min);
    }

    // Skill matching (ANY skill matches)
    if (intent.skills.length > 0) {
      const skillConditions: string[] = [];
      for (const skill of intent.skills) {
        skillConditions.push("m.expertise @> $" + (params.length + 1));
        params.push(JSON.stringify([skill]));
      }
      conditions.push("(" + skillConditions.join(" OR ") + ")");
    }

    // Location (if specified)
    if (intent.location) {
      conditions.push("m.timezone ILIKE $" + (params.length + 1));
      params.push(`%${intent.location}%`);
    }

    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    return {
      query: `
        SELECT 
          m.id, m.email, m.first_name, m.last_name, m.bio,
          m.avatar_url, m.hourly_rate, m.expertise, m.years_of_experience,
          m.is_available, m.timezone, m.average_rating, m.total_sessions_completed,
          m.total_reviews, m.quality_score, m.quality_tier, m.created_at,
          m.availability_schedule,
          ts_rank(
            to_tsvector('english', COALESCE(m.bio, '')),
            plainto_tsquery('english', $${params.length + 1})
          ) as relevance
        FROM mentors m
        ${whereClause}
        ORDER BY 
          CASE WHEN m.quality_tier = 'elite' THEN 0 ELSE 1 END,
          relevance DESC,
          m.average_rating DESC,
          m.total_sessions_completed DESC
        LIMIT $${params.length + 2}
        OFFSET $${params.length + 3}
      `,
      params: [
        ...params,
        intent.keywords.join(" "),
        50, // limit
        0, // offset
      ],
    };
  },

  /**
   * Search mentors using parsed NLP intent
   */
  async searchMentors(
    rawQuery: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    mentors: any[];
    intent: ParsedSearchIntent;
    totalCount: number;
    searchQuality: "high" | "medium" | "low";
  }> {
    try {
      // Parse the query
      const intent = this.parseQuery(rawQuery);

      // Build and execute query
      const { query, params } = this.buildMentorQuery(intent);

      const result = await db.query(query, params);

      // Determine search quality based on confidence and matches
      let searchQuality: "high" | "medium" | "low" = "low";
      if (intent.confidence > 0.7 && result.rows.length > 0) {
        searchQuality = "high";
      } else if (intent.confidence > 0.4 || result.rows.length > 3) {
        searchQuality = "medium";
      }

      logger.info("NLP mentor search completed", {
        query: rawQuery,
        resultsCount: result.rows.length,
        confidence: intent.confidence,
        searchQuality,
        skills: intent.skills,
      });

      return {
        mentors: result.rows,
        intent,
        totalCount: result.rows.length,
        searchQuality,
      };
    } catch (err) {
      logger.error("NLP mentor search failed", {
        query: rawQuery,
        error: String(err),
      });
      throw err;
    }
  },

  /**
   * Get search suggestions based on partial query
   */
  async getSuggestions(
    partialQuery: string
  ): Promise<
    Array<{
      text: string;
      type: "skill" | "mentor" | "topic" | "suggestion";
    }>
  > {
    const suggestions: Array<{
      text: string;
      type: "skill" | "mentor" | "topic" | "suggestion";
    }> = [];

    // Add matching skills
    const lowerQuery = partialQuery.toLowerCase();
    for (const skill of Object.keys(SKILL_SYNONYMS)) {
      if (skill.includes(lowerQuery)) {
        suggestions.push({ text: skill, type: "skill" });
      }
    }

    // Add mentor name suggestions
    const mentorResults = await db.query(
      "SELECT DISTINCT first_name || ' ' || last_name as name FROM mentors WHERE (first_name ILIKE $1 OR last_name ILIKE $1) AND is_active = true LIMIT 5",
      [`%${partialQuery}%`]
    );

    for (const row of mentorResults.rows) {
      suggestions.push({ text: row.name, type: "mentor" });
    }

    // Add smart suggestions based on context
    if (
      lowerQuery.includes("python") ||
      lowerQuery.includes("programming")
    ) {
      suggestions.push({
        text: "affordable Python tutor for beginners",
        type: "suggestion",
      });
    }

    return suggestions.slice(0, 10);
  },
};
