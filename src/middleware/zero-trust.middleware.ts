/**
 * Zero Trust Middleware
 *
 * Factory producing per-resource-sensitivity middleware that performs
 * continuous, identity-based access control: on every request it assesses
 * risk, evaluates it against the resource's policy, and either allows,
 * demands step-up MFA, or denies access.
 *
 * MUST be mounted AFTER `authenticate` (src/middleware/auth.middleware.ts) —
 * it relies on `req.user` already being populated from the verified JWT.
 *
 * Not wired into any route by this change — route owners opt in explicitly,
 * e.g.:
 *   router.get("/admin/reports", authenticate, zeroTrust(RESOURCE_SENSITIVITY.CRITICAL), handler)
 *
 * Part of issue #839 "Implement Zero Trust Security Model".
 */

import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.middleware";
import { RiskAssessmentService } from "../services/risk-assessment.service";
import { PolicyEngineService } from "../services/policy-engine.service";
import { AuditLogService, extractIpAddress } from "../services/auditLog.service";
import { ResourceSensitivity } from "../config/security-policies";
import { logger } from "../utils/logger.utils";

export interface RiskContext {
  score: number;
  signals: string[];
}

declare module "../types/auth.types" {
  interface AuthenticatedRequest {
    riskContext?: RiskContext;
  }
}

/**
 * Whether this request already carries evidence of a fresh step-up MFA
 * verification.
 *
 * Assumption (documented per task): the existing auth flow embeds an
 * `mfaVerified` boolean claim directly in the JWT (see
 * src/middleware/auth.middleware.ts, `req.user.mfaVerified`), set when the
 * user completes TOTP/MFA verification (src/services/mfa.service.ts /
 * mfa-otp.service.ts). There is no separate "step-up" endpoint that mutates
 * an existing session in place — a user who has verified MFA on their
 * current token is treated as having satisfied step-up. As a secondary,
 * more the request-scoped signal, we also honor an `X-MFA-Verified: true`
 * header, which a future step-up-MFA endpoint could set on a short-lived
 * basis without requiring a full token reissue.
 */
function hasFreshMfaEvidence(req: AuthenticatedRequest): boolean {
  if (req.user?.mfaVerified) return true;
  const header = req.headers["x-mfa-verified"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  return headerValue === "true";
}

export function zeroTrust(resourceSensitivity: ResourceSensitivity) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: "Authentication required before zero-trust evaluation.",
      });
      return;
    }

    const userId = req.user.userId;
    const ipAddress = extractIpAddress(req);

    try {
      const { score, signals } = await RiskAssessmentService.assess(req);
      const decision = PolicyEngineService.evaluate(score, resourceSensitivity);

      if (decision === "deny") {
        AuditLogService.log({
          userId,
          action: "zero_trust.access_denied",
          resourceType: "zero_trust",
          resourceId: req.originalUrl,
          ipAddress,
          userAgent: (req.headers["user-agent"] as string) || null,
          metadata: { riskScore: score, signals, resourceSensitivity },
        }).catch((err) => logger.error({ err }, "zero-trust: failed to audit-log denial"));

        res.status(403).json({
          success: false,
          error: "Access denied by zero-trust policy",
          riskScore: score,
          signals,
        });
        return;
      }

      if (decision === "step_up_mfa") {
        if (hasFreshMfaEvidence(req)) {
          req.riskContext = { score, signals };
          next();
          return;
        }

        AuditLogService.log({
          userId,
          action: "zero_trust.step_up_mfa_required",
          resourceType: "zero_trust",
          resourceId: req.originalUrl,
          ipAddress,
          userAgent: (req.headers["user-agent"] as string) || null,
          metadata: { riskScore: score, signals, resourceSensitivity },
        }).catch((err) => logger.error({ err }, "zero-trust: failed to audit-log step-up requirement"));

        res.status(428).json({
          success: false,
          error: "Step-up MFA required",
          mfaRequired: true,
          riskScore: score,
        });
        return;
      }

      // decision === "allow"
      req.riskContext = { score, signals };
      next();
    } catch (err) {
      // Fail closed on unexpected errors in the risk pipeline itself — a
      // zero-trust gate that silently opens on internal failure defeats its
      // own purpose.
      logger.error({ err, userId }, "zero-trust: evaluation failed");
      res.status(500).json({
        success: false,
        error: "Zero-trust evaluation failed",
      });
    }
  };
}
