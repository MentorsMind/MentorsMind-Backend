import axios from "axios";
import { logger } from "../utils/logger.utils";

// ─── Public interfaces (as specified in issue #508) ───────────────────────────

export type ContentType = "profile" | "review" | "message";
export type ModerationSeverity = "low" | "medium" | "high" | "critical";
export type ModerationAction = "allow" | "review" | "hide" | "block";

export interface ModerationFlag {
  category: string;
  score: number;
  description: string;
}

export interface ModerationResult {
  contentId: string;
  contentType: ContentType;
  flags: ModerationFlag[];
  severity: ModerationSeverity;
  action: ModerationAction;
  confidence: number;
  /** Which AI provider produced this result */
  provider: "openai" | "perspective" | "heuristic";
  rawScores?: Record<string, number>;
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface OpenAIModerationResult {
  id: string;
  model: string;
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

interface PerspectiveResult {
  attributeScores: Record<
    string,
    { summaryScore: { value: number; type: string } }
  >;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const SEVERITY_THRESHOLDS = {
  critical: 0.85,
  high: 0.65,
  medium: 0.4,
  low: 0.1,
} as const;

/** Max confidence score above which we block automatically (no human review) */
const AUTO_BLOCK_THRESHOLD = 0.9;
/** Scores above this require human review */
const AUTO_REVIEW_THRESHOLD = 0.5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoresToSeverity(maxScore: number): ModerationSeverity {
  if (maxScore >= SEVERITY_THRESHOLDS.critical) return "critical";
  if (maxScore >= SEVERITY_THRESHOLDS.high) return "high";
  if (maxScore >= SEVERITY_THRESHOLDS.medium) return "medium";
  return "low";
}

function severityToAction(
  severity: ModerationSeverity,
  confidence: number,
): ModerationAction {
  if (severity === "critical" && confidence >= AUTO_BLOCK_THRESHOLD)
    return "block";
  if (severity === "critical") return "hide";
  if (severity === "high")
    return confidence >= AUTO_REVIEW_THRESHOLD ? "hide" : "review";
  if (severity === "medium") return "review";
  return "allow";
}

/** Basic heuristic check — used as final fallback when all APIs fail */
function heuristicScan(text: string): {
  flags: ModerationFlag[];
  maxScore: number;
} {
  const patterns: Array<{
    pattern: RegExp;
    category: string;
    score: number;
    description: string;
  }> = [
    {
      pattern: /\b(spam|buy now|click here|free money|make \$\d+)\b/i,
      category: "spam",
      score: 0.7,
      description: "Potential spam content",
    },
    {
      pattern: /\b(https?:\/\/[^\s]+){3,}/g,
      category: "excessive_links",
      score: 0.55,
      description: "Excessive external links",
    },
    {
      pattern: /[A-Z\s!]{30,}/g,
      category: "shouting",
      score: 0.3,
      description: "Excessive capitals / shouting",
    },
  ];

  const flags: ModerationFlag[] = [];
  let maxScore = 0;

  for (const { pattern, category, score, description } of patterns) {
    if (pattern.test(text)) {
      flags.push({ category, score, description });
      if (score > maxScore) maxScore = score;
    }
  }

  return { flags, maxScore };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const AIModerationService = {
  /**
   * Scan content using OpenAI Moderation API.
   * Returns null on any API error (caller should fall back).
   */
  async _scanWithOpenAI(
    text: string,
  ): Promise<{
    flags: ModerationFlag[];
    maxScore: number;
    rawScores: Record<string, number>;
  } | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    try {
      const { data } = await axios.post<OpenAIModerationResult>(
        "https://api.openai.com/v1/moderations",
        { input: text },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 5000,
        },
      );

      const result = data.results[0];
      const rawScores = result.category_scores;
      const flags: ModerationFlag[] = [];
      let maxScore = 0;

      for (const [category, score] of Object.entries(rawScores)) {
        if (score >= SEVERITY_THRESHOLDS.low) {
          flags.push({
            category,
            score,
            description: `OpenAI: ${category.replace(/\//g, " / ")} (score: ${score.toFixed(3)})`,
          });
        }
        if (score > maxScore) maxScore = score;
      }

      return { flags, maxScore, rawScores };
    } catch (err) {
      logger.warn("AIModerationService: OpenAI moderation API failed", { err });
      return null;
    }
  },

  /**
   * Scan content using Google Perspective API.
   * Returns null on any API error (caller should fall back).
   */
  async _scanWithPerspective(
    text: string,
  ): Promise<{
    flags: ModerationFlag[];
    maxScore: number;
    rawScores: Record<string, number>;
  } | null> {
    const apiKey = process.env.PERSPECTIVE_API_KEY;
    if (!apiKey) return null;

    const attributes = [
      "TOXICITY",
      "SEVERE_TOXICITY",
      "IDENTITY_ATTACK",
      "INSULT",
      "PROFANITY",
      "THREAT",
      "SEXUALLY_EXPLICIT",
      "SPAM",
    ];

    try {
      const { data } = await axios.post<PerspectiveResult>(
        `https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${apiKey}`,
        {
          comment: { text },
          languages: ["en"],
          requestedAttributes: Object.fromEntries(
            attributes.map((a) => [a, {}]),
          ),
        },
        { timeout: 5000 },
      );

      const rawScores: Record<string, number> = {};
      const flags: ModerationFlag[] = [];
      let maxScore = 0;

      for (const [attr, val] of Object.entries(data.attributeScores)) {
        const score = val.summaryScore.value;
        rawScores[attr.toLowerCase()] = score;

        if (score >= SEVERITY_THRESHOLDS.low) {
          flags.push({
            category: attr.toLowerCase(),
            score,
            description: `Perspective: ${attr} (score: ${score.toFixed(3)})`,
          });
        }
        if (score > maxScore) maxScore = score;
      }

      return { flags, maxScore, rawScores };
    } catch (err) {
      logger.warn("AIModerationService: Perspective API failed", { err });
      return null;
    }
  },

  /**
   * Main entry point. Scans text content and returns a structured
   * ModerationResult. Provider priority: OpenAI → Perspective → heuristic.
   *
   * This method is intentionally non-throwing: if all providers fail it falls
   * back to a heuristic scan so that normal request flow is never blocked by
   * moderation infrastructure failures.
   */
  async scan(
    contentId: string,
    contentType: ContentType,
    text: string,
  ): Promise<ModerationResult> {
    // Sanitise - strip markdown/html for cleaner scoring
    const plainText = text
      .replace(/<[^>]+>/g, " ")
      .replace(/[*_`#~>]/g, "")
      .trim();

    if (!plainText) {
      return {
        contentId,
        contentType,
        flags: [],
        severity: "low",
        action: "allow",
        confidence: 1,
        provider: "heuristic",
      };
    }

    // 1. Try OpenAI
    const openAIResult = await this._scanWithOpenAI(plainText);
    if (openAIResult) {
      const { flags, maxScore, rawScores } = openAIResult;
      const severity = scoresToSeverity(maxScore);
      const confidence = maxScore;
      return {
        contentId,
        contentType,
        flags,
        severity,
        action: severityToAction(severity, confidence),
        confidence,
        provider: "openai",
        rawScores,
      };
    }

    // 2. Try Perspective API
    const perspectiveResult = await this._scanWithPerspective(plainText);
    if (perspectiveResult) {
      const { flags, maxScore, rawScores } = perspectiveResult;
      const severity = scoresToSeverity(maxScore);
      const confidence = maxScore;
      return {
        contentId,
        contentType,
        flags,
        severity,
        action: severityToAction(severity, confidence),
        confidence,
        provider: "perspective",
        rawScores,
      };
    }

    // 3. Heuristic fallback
    logger.warn(
      "AIModerationService: all AI providers unavailable, using heuristic fallback",
      { contentId, contentType },
    );
    const { flags, maxScore } = heuristicScan(plainText);
    const severity = scoresToSeverity(maxScore);
    const confidence = maxScore > 0 ? maxScore * 0.7 : 0; // lower confidence for heuristic
    return {
      contentId,
      contentType,
      flags,
      severity,
      action: severityToAction(severity, confidence),
      confidence,
      provider: "heuristic",
    };
  },

  /**
   * Convenience wrapper: scan and if the action is "block" or "hide", throws
   * a 422 error so the caller can reject the content before it is persisted.
   * For "review" actions, the content is allowed through but the result is
   * returned so callers can queue it for human review.
   */
  async scanAndEnforce(
    contentId: string,
    contentType: ContentType,
    text: string,
  ): Promise<ModerationResult> {
    const result = await this.scan(contentId, contentType, text);

    if (result.action === "block") {
      logger.warn("AIModerationService: content blocked", {
        contentId,
        contentType,
        severity: result.severity,
        confidence: result.confidence,
      });
      const err: any = new Error(
        "Your content was blocked by our automated moderation system. " +
          "Please review our community guidelines.",
      );
      err.statusCode = 422;
      err.moderationResult = result;
      throw err;
    }

    if (result.action !== "allow") {
      logger.info("AIModerationService: content flagged for review", {
        contentId,
        contentType,
        action: result.action,
        severity: result.severity,
      });
    }

    return result;
  },
};
