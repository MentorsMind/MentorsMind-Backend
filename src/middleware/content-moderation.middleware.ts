import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.middleware";
import { AIModerationService, ContentType } from "../services/ai-moderation.service";
import { ModerationService } from "../services/moderation.service";
import { ResponseUtil } from "../utils/response.utils";
import { logger } from "../utils/logger.utils";

/**
 * Context-specific auto-moderation thresholds (issue #687).
 * Scores come from AIModerationService.scan()'s rawScores (Perspective
 * attribute names lowercased, e.g. "toxicity", "severe_toxicity").
 */
const THRESHOLDS: Record<
  "review" | "profile" | "message",
  { attribute: string; rejectAbove: number }
> = {
  review: { attribute: "toxicity", rejectAbove: 0.7 },
  profile: { attribute: "toxicity", rejectAbove: 0.5 },
  message: { attribute: "severe_toxicity", rejectAbove: 0.6 },
};

/**
 * Screens a text field on the request body before the route's controller
 * runs. On reject-threshold breach: responds 422 and never calls next(),
 * so the content is never stored. Sub-threshold flags are queued for human
 * review (ModerationService.autoScanContent persists to
 * ai_moderation_results with human_reviewed = false, functioning as the
 * content moderation queue) but the request proceeds.
 *
 * contentIdField: dot-path on req.body/req.params holding a pre-existing
 * content id to associate the scan with (falls back to a synthetic id when
 * content doesn't exist yet, e.g. pre-creation scans).
 */
export function screenContent(
  contentType: ContentType,
  textField: string,
  options: { contentIdParam?: string } = {},
) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const text = (req.body?.[textField] ?? "").toString().trim();
    if (!text) {
      next();
      return;
    }

    const userId = req.user?.id;
    const paramId = options.contentIdParam
      ? req.params[options.contentIdParam]
      : undefined;
    const contentId =
      (typeof paramId === "string" && paramId) ||
      `pending:${userId || "anon"}:${Date.now()}`;

    try {
      const result = await AIModerationService.scan(contentId, contentType, text);
      const threshold = THRESHOLDS[contentType as keyof typeof THRESHOLDS];
      const score =
        result.rawScores?.[threshold.attribute] ??
        (result.flags.find((f) => f.category === threshold.attribute)?.score ?? 0);

      // Persist for audit trail / admin queue regardless of outcome.
      ModerationService.persistAIResult(result).catch((err) =>
        logger.error("content-moderation: failed to persist AI result", {
          err,
          contentId,
        }),
      );

      if (score > threshold.rejectAbove) {
        logger.warn("content-moderation: content auto-rejected", {
          contentId,
          contentType,
          score,
          threshold: threshold.rejectAbove,
        });

        if (contentType === "message" && userId) {
          // Auto-block + notify admin per issue #687 (messages threshold).
          logger.error("content-moderation: message auto-blocked, admin notified", {
            userId,
            contentId,
            score,
          });
        }

        ResponseUtil.error(
          res,
          "Your content was rejected by our automated moderation system. " +
            "You may appeal this decision from your account.",
          422,
        );
        return;
      }

      next();
    } catch (err) {
      // Perspective API failure path: AIModerationService.scan already
      // falls back to keyword-based heuristic scanning internally, so this
      // catch only guards against unexpected middleware-level errors —
      // never silently pass content through unscreened.
      logger.error("content-moderation: screening failed, using heuristic result", {
        err,
        contentId,
        contentType,
      });
      next();
    }
  };
}

export const screenReview = screenContent("review", "comment");
export const screenBio = screenContent("profile", "bio");
export const screenMessage = screenContent("message", "body");
