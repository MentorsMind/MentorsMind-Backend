/**
 * Threat Detection Service
 *
 * Correlates recent login/access signals for a user and produces a combined
 * anomaly score using the statistical utilities in ml-security.service.ts
 * (heuristic z-score / velocity scoring — NOT a trained ML model, see the
 * honesty note in that file).
 *
 * Signals used (grounded in tables that already exist on this branch):
 *   - Failed login attempts: LoginAttemptsService (Redis-backed counter,
 *     keyed by email). This gives us a fast, already-tracked failed-attempt
 *     count but is NOT per-user-id and has no per-attempt timestamp history,
 *     so it only contributes a coarse "failed attempt count" signal.
 *   - access_risk_log (added for issue #839, read via AccessRiskModel):
 *     per-request rows keyed by user_id with ip_address + created_at, used
 *     here read-only to compute (a) login/access event velocity within a
 *     window and (b) distinct-IP count in the window ("IP diversity spike").
 *
 * Limitation: if a user has no access_risk_log activity yet (e.g. the
 * zero-trust middleware hasn't logged a request for them), the velocity/IP
 * signals will be based on whatever rows exist, which may be sparse. That is
 * an accepted limitation given the currently queryable schema — this service
 * does not fabricate additional signals.
 */

import { AccessRiskModel } from "../models/access-risk.model";
import { LoginAttemptsService } from "./loginAttempts.service";
import { MlSecurityService } from "./ml-security.service";
import { logger } from "../utils/logger";

export type ThreatSeverity = "low" | "medium" | "high" | "critical";

export interface ThreatDetectionContext {
  ip: string;
  userAgent: string;
  timestamp: Date;
  /** Optional: email associated with the login event, used to look up failed-attempt count. */
  email?: string;
}

export interface ThreatDetectionResult {
  threatDetected: boolean;
  incidentType?: string;
  severity?: ThreatSeverity;
  score: number;
}

// ── Thresholds ──────────────────────────────────────────────────────────────

export const THREAT_SCORE_THRESHOLDS = {
  MEDIUM: 40,
  HIGH: 70,
  CRITICAL: 90,
} as const;

/** Look-back window for correlating recent access-risk-log activity. */
const CORRELATION_WINDOW_MINUTES = 30;
const CORRELATION_WINDOW_MS = CORRELATION_WINDOW_MINUTES * 60 * 1000;

/** More than this many access events in the window is considered high velocity. */
const VELOCITY_THRESHOLD_EVENTS = 8;

/** More than this many distinct IPs in the window is considered an IP diversity spike. */
const DISTINCT_IP_SPIKE_THRESHOLD = 3;

function severityForScore(score: number): ThreatSeverity {
  if (score >= THREAT_SCORE_THRESHOLDS.CRITICAL) return "critical";
  if (score >= THREAT_SCORE_THRESHOLDS.HIGH) return "high";
  return "medium";
}

export const ThreatDetectionService = {
  /**
   * Analyze a login/access event for a user and decide whether it looks
   * anomalous enough to constitute a security threat.
   */
  async analyzeLoginEvent(
    userId: string,
    context: ThreatDetectionContext,
  ): Promise<ThreatDetectionResult> {
    // Signal 1: recent access-risk-log activity (velocity + IP diversity).
    const recentLog = await AccessRiskModel.getRecentForUser(
      userId,
      CORRELATION_WINDOW_MINUTES,
    );
    const recentTimestamps = recentLog.map((row) => new Date(row.created_at));
    // Include the current event so velocity reflects the event that triggered analysis.
    recentTimestamps.push(context.timestamp);

    const velocityScore = MlSecurityService.computeVelocityScore(
      recentTimestamps,
      CORRELATION_WINDOW_MS,
      VELOCITY_THRESHOLD_EVENTS,
    );

    const distinctIps = await AccessRiskModel.countDistinctIpsSince(
      userId,
      new Date(Date.now() - CORRELATION_WINDOW_MS),
    );
    // Scored against the user's Redis-backed 30-day rolling baseline
    // (see baseline-store.service.ts) instead of a hardcoded sample set —
    // the baseline is refreshed asynchronously by baselineRefresh.job.ts,
    // so this stays a cheap Redis read on the hot path.
    const ipDiversityScore = await MlSecurityService.scoreDeviationForUser(
      userId,
      distinctIps,
    );

    // Signal 2: failed login attempts (coarse, email-keyed counter).
    let failedAttempts = 0;
    if (context.email) {
      try {
        const status = await LoginAttemptsService.getStatus(context.email);
        failedAttempts = status.attempts;
      } catch (error) {
        logger.warn("Failed to read login attempt status", {
          userId,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
    // 0 failed attempts → 0. Scale toward 100 as attempts approach the
    // permanent-lockout threshold used elsewhere in the app (20 attempts).
    const failedAttemptScore = Math.min(100, (failedAttempts / 20) * 100);

    // Combine signals: weighted sum, capped at 100.
    const combinedScore = Math.min(
      100,
      velocityScore * 0.4 + ipDiversityScore * 0.35 + failedAttemptScore * 0.25,
    );

    if (combinedScore < THREAT_SCORE_THRESHOLDS.MEDIUM) {
      return { threatDetected: false, score: combinedScore };
    }

    // Pick the dominant signal to label the incident type.
    let incidentType = "behavioral_deviation";
    if (failedAttemptScore >= velocityScore && failedAttemptScore >= ipDiversityScore) {
      incidentType = "credential_stuffing_pattern";
    } else if (ipDiversityScore >= velocityScore) {
      incidentType = "ip_diversity_spike";
    } else {
      incidentType = "anomalous_login_velocity";
    }

    return {
      threatDetected: true,
      incidentType,
      severity: severityForScore(combinedScore),
      score: combinedScore,
    };
  },
};
