/**
 * query-parser.utils.ts
 *
 * Pure, dependency-free helpers for NLP search query understanding:
 *   - normalizeQuery: canonicalize a raw query for caching/comparison
 *   - levenshtein: edit-distance for typo detection
 *   - correctTypos: token-level Levenshtein correction against a skill vocabulary
 *   - parseQueryKeywords: deterministic regex/keyword fallback parser used when
 *     OpenAI function calling is unavailable or fails.
 */

export type ExperienceLevel = "beginner" | "intermediate" | "advanced" | null;

export interface ParsedQuery {
  skills: string[];
  maxBudget: number | null;
  minRating: number | null;
  availability: string[];
  experienceLevel: ExperienceLevel;
  sessionType: string | null;
  language: string | null;
  /** Canonical normalized query used for cache keys. */
  normalizedQuery: string;
  /** Query after typo correction (null when unchanged). */
  correctedQuery: string | null;
  /** Token-level corrections that were applied. */
  typoCorrections: { original: string; suggestion: string }[];
  /** True when the result came from the Redis cache (set by the service). */
  fromCache?: boolean;
}

/**
 * Known skill vocabulary used for typo correction and keyword extraction.
 * Extend this list as new skills are introduced to the platform.
 */
export const SKILL_VOCABULARY: string[] = [
  "Python",
  "JavaScript",
  "TypeScript",
  "Java",
  "C++",
  "C#",
  "Go",
  "Rust",
  "Ruby",
  "PHP",
  "Swift",
  "Kotlin",
  "Scala",
  "SQL",
  "HTML",
  "CSS",
  "React",
  "Vue",
  "Angular",
  "Node.js",
  "Node",
  "Express",
  "Django",
  "Flask",
  "FastAPI",
  "Spring",
  "Machine Learning",
  "Deep Learning",
  "Artificial Intelligence",
  "Data Science",
  "Data Structures",
  "Algorithms",
  "Docker",
  "Kubernetes",
  "AWS",
  "Azure",
  "GCP",
  "DevOps",
  "Cybersecurity",
  "Blockchain",
  "Rust",
  "GraphQL",
  "MongoDB",
  "PostgreSQL",
  "MySQL",
  "Redis",
  "Linux",
  "Git",
  "TensorFlow",
  "PyTorch",
  "Pandas",
  "NumPy",
  "Excel",
  "Statistics",
  "Psychology",
  "Public Speaking",
  "Leadership",
];

/** Canonicalize whitespace and casing for stable cache keys and comparison. */
export function normalizeQuery(rawQuery: string): string {
  return (rawQuery || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Classic Levenshtein edit distance (iterative, O(n*m) with O(min) space).
 * Case-insensitive by convention — callers should lowercase inputs.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export interface TypoCorrection {
  original: string;
  suggestion: string;
}

/**
 * Detect and correct likely typos in a query against a known vocabulary using
 * Levenshtein distance. A token is only corrected when it is "close enough"
 * (distance <= maxDistance AND distance is meaningfully smaller than the token
 * length) to avoid over-correcting valid but rare words.
 */
export function correctTypos(
  query: string,
  vocabulary: string[] = SKILL_VOCABULARY,
  maxDistance = 2,
): { corrected: string; corrections: TypoCorrection[] } {
  const tokens = query.split(/\s+/);
  const corrections: TypoCorrection[] = [];

  const correctedTokens = tokens.map((token) => {
    const clean = token.replace(/[^a-z0-9]/gi, "");
    if (!clean) return token;

    const lower = clean.toLowerCase();
    let best: { word: string; dist: number } | null = null;

    for (const word of vocabulary) {
      const dist = levenshtein(lower, word.toLowerCase());
      if (dist > 0 && dist <= maxDistance) {
        if (!best || dist < best.dist) best = { word, dist };
      }
    }

    // Only correct when the best candidate is clearly closer than the original.
    if (best && best.dist < clean.length) {
      corrections.push({ original: clean, suggestion: best.word });
      // Preserve any surrounding punctuation from the original token.
      return token.replace(clean, best.word);
    }
    return token;
  });

  return {
    corrected: correctedTokens.join(" "),
    corrections,
  };
}

/**
 * Deterministic, dependency-free query parser used as a fallback when OpenAI
 * function calling is unavailable or fails. Extracts the structured filter
 * schema documented in the issue from keyword/regex patterns.
 */
export function parseQueryKeywords(rawQuery: string): ParsedQuery {
  const normalized = normalizeQuery(rawQuery);
  const lower = normalized;

  const skills: string[] = [];
  for (const skill of SKILL_VOCABULARY) {
    if (lower.includes(skill.toLowerCase())) skills.push(skill);
  }

  let maxBudget: number | null = null;
  const priceMatch = lower.match(
    /(?:under|below|max|less than|cheaper than|<=?|up to|within)\s*\$?(\d+(?:\.\d+)?)/,
  );
  if (priceMatch) maxBudget = parseFloat(priceMatch[1]);
  // Heuristic: "affordable" / "cheap" / "budget" implies a budget cap.
  if (
    maxBudget === null &&
    /affordable|cheap|budget-friendly|budget friendly/.test(lower)
  ) {
    maxBudget = 50;
  }

  let minRating: number | null = null;
  const ratingMatch = lower.match(/(\d+(?:\.\d+)?)\s*\+?\s*stars?/);
  if (ratingMatch) minRating = parseFloat(ratingMatch[1]);

  const availability: string[] = [];
  if (/weekend|weekends/.test(lower)) availability.push("weekend");
  if (/evening|night|after hours|after work/.test(lower)) availability.push("evening");
  if (/morning/.test(lower)) availability.push("morning");
  if (/afternoon/.test(lower)) availability.push("afternoon");

  let experienceLevel: ExperienceLevel = null;
  if (/beginner|starter|intro|basic|fundamental|new to/.test(lower))
    experienceLevel = "beginner";
  else if (/intermediate|mid[-\s]?level|some experience/.test(lower))
    experienceLevel = "intermediate";
  else if (/advanced|expert|senior|professional|experienced/.test(lower))
    experienceLevel = "advanced";

  let sessionType: string | null = null;
  if (/one on one|1:1|1-on-1|private|individual|personal/.test(lower))
    sessionType = "1:1";
  else if (/group|class|batch|cohort|workshop/.test(lower)) sessionType = "group";
  else if (/coach|mentor|tutor|teacher/.test(lower)) sessionType = "coaching";

  let language: string | null = null;
  const langMatch = lower.match(/\b(?:in|speaking|language)\s+([a-z]{2,})\b/);
  if (langMatch) language = langMatch[1];

  return {
    skills,
    maxBudget,
    minRating,
    availability,
    experienceLevel,
    sessionType,
    language,
    normalizedQuery: normalized,
    correctedQuery: null,
    typoCorrections: [],
  };
}

/**
 * Coerce an arbitrary object (e.g. OpenAI tool-call arguments) into a valid
 * ParsedQuery, applying sane defaults for missing/null fields.
 */
export function normalizeParsed(obj: any, normalizedQuery: string): ParsedQuery {
  const asStringArray = (v: any): string[] => {
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    if (typeof v === "string" && v.length) return [v];
    return [];
  };
  const asNullableNumber = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const asNullableString = (v: any): string | null => {
    if (v === null || v === undefined || v === "") return null;
    return String(v);
  };

  const experienceLevels: ExperienceLevel[] = [
    "beginner",
    "intermediate",
    "advanced",
  ];
  const exp = asNullableString(obj?.experienceLevel);
  const experienceLevel: ExperienceLevel =
    experienceLevels.includes(exp as ExperienceLevel) ? (exp as ExperienceLevel) : null;

  return {
    skills: asStringArray(obj?.skills),
    maxBudget: asNullableNumber(obj?.maxBudget),
    minRating: asNullableNumber(obj?.minRating),
    availability: asStringArray(obj?.availability),
    experienceLevel,
    sessionType: asNullableString(obj?.sessionType),
    language: asNullableString(obj?.language),
    normalizedQuery,
    correctedQuery: null,
    typoCorrections: [],
  };
}

export function createEmptyParsed(normalizedQuery: string): ParsedQuery {
  return {
    skills: [],
    maxBudget: null,
    minRating: null,
    availability: [],
    experienceLevel: null,
    sessionType: null,
    language: null,
    normalizedQuery,
    correctedQuery: null,
    typoCorrections: [],
  };
}
