/**
 * Incident Response Service
 *
 * Comprehensive automated security incident response system providing:
 *   - Incident detection and classification (type + MITRE ATT&CK mapping)
 *   - Automated response playbooks per severity/category
 *   - Timeline reconstruction with event sourcing
 *   - SIEM integration (alert ingestion and correlation)
 *   - Escalation, containment, and recovery workflows
 *
 * Playbook execution order:
 *   1. DETECT  → classify incident, map to MITRE technique
 *   2. CONTAIN → account lock, IP block, session revocation
 *   3. ALERT   → email / in-app notification to user and security team
 *   4. COLLECT → trigger forensics collection via ForensicsService
 *   5. RECORD  → persist incident, timeline, audit log, SIEM push
 *   6. REVIEW  → schedule manual review if severity >= high
 *
 * Part of issue #840 "Automated Security Incident Response System".
 */

import pool from "../config/database";
import { logger } from "../utils/logger";
import { NotificationService } from "./notification.service";
import { NotificationType, NotificationChannel } from "../models/notifications.model";
import { AuditLogService } from "./auditLog.service";
import {
  SecurityIncidentModel,
  type SecuritySeverity,
  type SecurityIncidentStatus,
  type IncidentCategory,
  type SecurityIncident,
  type CreateSecurityIncidentPayload,
} from "../models/security-incident.model";
import type { ThreatDetectionResult } from "./threat-detection.service";
import { SiemAdapterService } from "./siem-adapter.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IncidentContext {
  userId: string;
  ip?: string;
  userAgent?: string;
  resource?: string;
  email?: string;
  sessionId?: string;
  requestId?: string;
  extraData?: Record<string, unknown>;
}

export interface PlaybookResult {
  incidentId: string;
  actionsExecuted: string[];
  actionsSkipped: string[];
  errors: string[];
  status: SecurityIncidentStatus;
  escalated: boolean;
  containedAt?: Date;
}

export interface SiemAlert {
  /** External SIEM correlation ID */
  alertId: string;
  /** SIEM system name (splunk | elastic_siem | sentinel | chronicle) */
  source: "splunk" | "elastic_siem" | "sentinel" | "chronicle" | "custom";
  severity: SecuritySeverity;
  title: string;
  description: string;
  incidentType: string;
  /** ISO8601 timestamp from the SIEM */
  detectedAt: string;
  affectedUserId?: string;
  affectedResource?: string;
  sourceIp?: string;
  rawAlert?: Record<string, unknown>;
}

export interface SiemPushPayload {
  incidentId: string;
  incidentType: string;
  severity: SecuritySeverity;
  category: IncidentCategory;
  mitreTags: string[];
  status: SecurityIncidentStatus;
  userId: string | null;
  sourceIp: string | null;
  affectedResource: string | null;
  occurredAt: string;
  responseActions: string[];
  score: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_LOCK_DURATION_MS = 60 * 60 * 1000; // 1 hour
const EXTENDED_LOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours for critical

/** Minimum score below which no incident is recorded. */
const MIN_INCIDENT_SCORE = 40;

/** MITRE ATT&CK technique IDs mapped to common incident types. */
const MITRE_MAPPING: Record<string, string[]> = {
  credential_stuffing_pattern: ["T1110.004", "T1078"],
  brute_force_login: ["T1110.001", "T1078"],
  password_spray: ["T1110.003", "T1078"],
  anomalous_login_velocity: ["T1078", "T1110"],
  ip_diversity_spike: ["T1078.001", "T1550"],
  behavioral_deviation: ["T1078", "T1134"],
  session_hijacking: ["T1563", "T1550.004"],
  privilege_escalation: ["T1068", "T1548"],
  data_exfiltration: ["T1041", "T1030", "T1020"],
  api_abuse: ["T1190", "T1059"],
  account_takeover: ["T1078", "T1621"],
  mfa_bypass: ["T1621", "T1556"],
  rate_limit_bypass: ["T1190", "T1110"],
  suspicious_download: ["T1105", "T1020"],
};

/** Incident type → category mapping. */
const CATEGORY_MAPPING: Record<string, IncidentCategory> = {
  credential_stuffing_pattern: "credential_stuffing",
  brute_force_login: "brute_force",
  password_spray: "brute_force",
  anomalous_login_velocity: "authentication",
  ip_diversity_spike: "anomalous_behavior",
  behavioral_deviation: "anomalous_behavior",
  session_hijacking: "authorization",
  privilege_escalation: "authorization",
  data_exfiltration: "data_exfiltration",
  api_abuse: "anomalous_behavior",
  account_takeover: "authentication",
  mfa_bypass: "authentication",
  rate_limit_bypass: "policy_violation",
  suspicious_download: "data_exfiltration",
};

// ─── Internal action helpers ──────────────────────────────────────────────────

async function lockAccount(
  userId: string,
  durationMs: number,
): Promise<void> {
  await pool.query(
    `UPDATE users SET locked_until = $2, updated_at = NOW() WHERE id = $1`,
    [userId, new Date(Date.now() + durationMs)],
  );
}

async function revokeActiveSessions(userId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE user_sessions
     SET revoked = true, revoked_at = NOW(), revoke_reason = 'security_incident'
     WHERE user_id = $1 AND revoked = false`,
    [userId],
  );
  return rowCount ?? 0;
}

async function sendSecurityAlert(
  userId: string,
  severity: SecuritySeverity,
  incidentType: string,
  incidentId: string,
  score: number,
): Promise<void> {
  try {
    const isCritical = severity === "critical";
    const isHigh = severity === "high";

    await NotificationService.sendNotification({
      userId,
      type: NotificationType.SYSTEM_ALERT,
      channels: isCritical
        ? [NotificationChannel.EMAIL, NotificationChannel.IN_APP]
        : [NotificationChannel.IN_APP],
      title: isCritical
        ? "⚠️ Critical security alert — account locked"
        : isHigh
        ? "⚠️ Suspicious activity detected on your account"
        : "Security notice: unusual activity detected",
      message: isCritical
        ? "We detected a critical security threat and have temporarily locked your account. If this was not you, please reset your password immediately and contact support."
        : isHigh
        ? "We detected unusual activity on your account. Review your recent sessions and consider changing your password."
        : "We detected minor unusual activity on your account. No action required if this was you.",
      data: { incidentType, severity, score, incidentId },
    });
  } catch (error) {
    logger.error("Failed to send security alert notification", {
      userId,
      incidentType,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

// ─── Incident Response Service ────────────────────────────────────────────────

export const IncidentResponseService = {

  // ── Primary entry point ─────────────────────────────────────────────────────

  /**
   * Handle a ThreatDetectionResult — the existing integration point.
   * Kept compatible with the original signature used by the security-analysis worker.
   */
  async handle(
    userId: string,
    detection: ThreatDetectionResult,
    context?: Partial<IncidentContext>,
  ): Promise<void> {
    if (!detection.threatDetected || !detection.severity || !detection.incidentType) {
      return;
    }

    const ctx: IncidentContext = {
      userId,
      ip: context?.ip,
      userAgent: context?.userAgent,
      resource: context?.resource,
      email: context?.email,
      sessionId: context?.sessionId,
      requestId: context?.requestId,
      extraData: context?.extraData,
    };

    await this.executePlaybook(
      ctx,
      detection.incidentType,
      detection.severity,
      detection.score,
      { rawDetection: detection },
    );
  },

  // ── Detection and Classification ────────────────────────────────────────────

  /**
   * Classify a raw incident type into a structured IncidentCategory and
   * look up applicable MITRE ATT&CK technique IDs.
   */
  classify(incidentType: string): {
    category: IncidentCategory;
    mitreTags: string[];
  } {
    const category: IncidentCategory =
      CATEGORY_MAPPING[incidentType] ?? "unknown";
    const mitreTags: string[] = MITRE_MAPPING[incidentType] ?? [];
    return { category, mitreTags };
  },

  /**
   * Ingest an external SIEM alert and create/correlate an internal incident.
   * Returns the created or matched incident.
   */
  async ingestSiemAlert(alert: SiemAlert): Promise<SecurityIncident> {
    // Check if we already have an incident with this SIEM correlation ID
    const existing = await SecurityIncidentModel.findBySiemRef(alert.alertId);
    if (existing.length > 0) {
      // Record recurrence
      const matched = existing[0];
      await SecurityIncidentModel.recordRecurrence(matched.id);
      await SecurityIncidentModel.addTimelineEvent(
        matched.id,
        "SIEM_ALERT_RECEIVED",
        `Duplicate SIEM alert received from ${alert.source}: ${alert.title}`,
        "siem-integration",
        { alertId: alert.alertId, source: alert.source, rawAlert: alert.rawAlert },
      );
      logger.info(
        { incidentId: matched.id, siemRef: alert.alertId },
        "SIEM alert correlated with existing incident",
      );
      return matched;
    }

    const { category, mitreTags } = this.classify(alert.incidentType);

    // Create new incident from SIEM alert
    const incident = await SecurityIncidentModel.create({
      userId: alert.affectedUserId ?? null,
      incidentType: alert.incidentType,
      category,
      severity: alert.severity,
      details: {
        siemSource: alert.source,
        title: alert.title,
        description: alert.description,
        rawAlert: alert.rawAlert ?? {},
      },
      status: "open",
      mitreTags,
      siemRef: alert.alertId,
      sourceIp: alert.sourceIp ?? null,
      affectedResource: alert.affectedResource ?? null,
      firstSeenAt: new Date(alert.detectedAt),
    });

    await SecurityIncidentModel.addTimelineEvent(
      incident.id,
      "INCIDENT_CREATED",
      `Incident created from SIEM alert (${alert.source}): ${alert.title}`,
      "siem-integration",
      { alertId: alert.alertId, source: alert.source },
    );

    logger.info(
      { incidentId: incident.id, siemRef: alert.alertId, source: alert.source },
      "Incident created from SIEM alert",
    );

    // If it's high/critical, run the playbook automatically
    if (alert.severity === "critical" || alert.severity === "high") {
      if (alert.affectedUserId) {
        await this.executePlaybook(
          { userId: alert.affectedUserId, ip: alert.sourceIp, resource: alert.affectedResource ?? undefined },
          alert.incidentType,
          alert.severity,
          null,
          { siemRef: alert.alertId },
        );
      }
    }

    return incident;
  },

  // ── Playbook Execution ──────────────────────────────────────────────────────

  /**
   * Execute the full response playbook for a detected incident.
   *
   * Playbook steps (per severity):
   *
   *   low / medium  → RECORD only
   *   high          → RECORD, ALERT (in-app), COLLECT forensics
   *   critical      → RECORD, LOCK account, REVOKE sessions, ALERT (email+in-app), COLLECT forensics, ESCALATE
   */
  async executePlaybook(
    ctx: IncidentContext,
    incidentType: string,
    severity: SecuritySeverity,
    score: number | null,
    extraDetails?: Record<string, unknown>,
  ): Promise<PlaybookResult> {
    const actionsExecuted: string[] = [];
    const actionsSkipped: string[] = [];
    const errors: string[] = [];
    let escalated = false;
    let containedAt: Date | undefined;

    const { category, mitreTags } = this.classify(incidentType);

    // ── Step 1: Create incident record ──────────────────────────────────────
    const incident = await SecurityIncidentModel.create({
      userId: ctx.userId,
      incidentType,
      category,
      severity,
      score,
      details: {
        ...(extraDetails ?? {}),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        resource: ctx.resource,
        sessionId: ctx.sessionId,
        requestId: ctx.requestId,
        ...(ctx.extraData ?? {}),
      },
      status: "open",
      mitreTags,
      sourceIp: ctx.ip ?? null,
      sourceUserAgent: ctx.userAgent ?? null,
      affectedResource: ctx.resource ?? null,
    });

    await SecurityIncidentModel.addTimelineEvent(
      incident.id,
      "INCIDENT_CREATED",
      `Incident created: ${incidentType} (severity=${severity}, score=${score ?? "N/A"})`,
      "system",
      { incidentType, severity, score, category, mitreTags },
    );
    actionsExecuted.push("incident_recorded");

    // ── Step 2: Containment actions (critical and high) ──────────────────────
    if (severity === "critical") {
      // Lock account for 24 hours
      try {
        await lockAccount(ctx.userId, EXTENDED_LOCK_DURATION_MS);
        actionsExecuted.push("account_locked_24h");
        containedAt = new Date();
        await SecurityIncidentModel.addTimelineEvent(
          incident.id,
          "ACCOUNT_LOCKED",
          `Account locked for 24 hours due to critical incident`,
          "system",
          { lockDurationMs: EXTENDED_LOCK_DURATION_MS },
        );
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`account_lock_failed: ${msg}`);
        logger.error("Failed to lock account", { userId: ctx.userId, error: msg });
      }

      // Revoke all active sessions
      try {
        const revokedCount = await revokeActiveSessions(ctx.userId);
        actionsExecuted.push(`sessions_revoked:${revokedCount}`);
        await SecurityIncidentModel.addTimelineEvent(
          incident.id,
          "SESSIONS_REVOKED",
          `${revokedCount} active session(s) revoked`,
          "system",
          { revokedCount },
        );
      } catch (err) {
        const msg = (err as Error).message;
        // Session table may not exist in all environments — log and continue
        errors.push(`session_revoke_failed: ${msg}`);
        actionsSkipped.push("session_revocation");
      }

      escalated = true;
    } else if (severity === "high") {
      // Lock for 1 hour only
      try {
        await lockAccount(ctx.userId, ACCOUNT_LOCK_DURATION_MS);
        actionsExecuted.push("account_locked_1h");
        containedAt = new Date();
        await SecurityIncidentModel.addTimelineEvent(
          incident.id,
          "ACCOUNT_LOCKED",
          `Account locked for 1 hour due to high-severity incident`,
          "system",
          { lockDurationMs: ACCOUNT_LOCK_DURATION_MS },
        );
      } catch (err) {
        errors.push(`account_lock_failed: ${(err as Error).message}`);
        actionsSkipped.push("account_lock");
      }
    } else {
      actionsSkipped.push("containment_not_required");
    }

    // ── Step 3: Alert user ──────────────────────────────────────────────────
    if (severity === "critical" || severity === "high") {
      await sendSecurityAlert(ctx.userId, severity, incidentType, incident.id, score ?? 0);
      actionsExecuted.push("user_alert_sent");
      await SecurityIncidentModel.addTimelineEvent(
        incident.id,
        "ALERT_SENT",
        `Security alert notification sent to user`,
        "system",
        { severity, channels: severity === "critical" ? ["email", "in_app"] : ["in_app"] },
      );
    } else {
      actionsSkipped.push("user_alert_low_severity");
    }

    // ── Step 4: Audit log ───────────────────────────────────────────────────
    try {
      await AuditLogService.log({
        userId: ctx.userId,
        action: "SECURITY_INCIDENT_DETECTED",
        resourceType: "security_incident",
        resourceId: incident.id,
        newValue: { incidentType, severity, score, category, mitreTags },
        metadata: {
          source: "incident-response",
          playbook: severity,
          actionsExecuted,
          ip: ctx.ip,
        },
      });
      actionsExecuted.push("audit_logged");
    } catch (err) {
      errors.push(`audit_log_failed: ${(err as Error).message}`);
    }

    // ── Step 5: Determine final status ──────────────────────────────────────
    let finalStatus: SecurityIncidentStatus;
    if (severity === "critical") {
      finalStatus = "escalated";
    } else if (severity === "high") {
      finalStatus = "investigating";
    } else {
      finalStatus = "auto_resolved";
    }

    const responseActionSummary = actionsExecuted.join(",");
    await SecurityIncidentModel.updateStatus(incident.id, finalStatus, responseActionSummary);

    await SecurityIncidentModel.addTimelineEvent(
      incident.id,
      "STATUS_UPDATED",
      `Incident status set to '${finalStatus}' after playbook execution`,
      "system",
      { status: finalStatus, actionsExecuted, errors },
    );

    // ── Step 6: Push to SIEM ────────────────────────────────────────────────
    if (severity === "critical" || severity === "high") {
      await this.pushToSiem({
        incidentId: incident.id,
        incidentType,
        severity,
        category,
        mitreTags,
        status: finalStatus,
        userId: ctx.userId,
        sourceIp: ctx.ip ?? null,
        affectedResource: ctx.resource ?? null,
        occurredAt: incident.created_at.toISOString(),
        responseActions: actionsExecuted,
        score,
      });
      actionsExecuted.push("siem_notified");
    }

    logger.warn("Security incident playbook executed", {
      userId: ctx.userId,
      incidentId: incident.id,
      incidentType,
      severity,
      score,
      actionsExecuted,
      escalated,
      errors: errors.length,
    });

    return {
      incidentId: incident.id,
      actionsExecuted,
      actionsSkipped,
      errors,
      status: finalStatus,
      escalated,
      containedAt,
    };
  },

  // ── Timeline Reconstruction ─────────────────────────────────────────────────

  /**
   * Reconstruct the full timeline for an incident, enriched with context.
   * Returns a chronologically-sorted list of events ready for analyst review.
   */
  async reconstructTimeline(incidentId: string): Promise<{
    incident: SecurityIncident | null;
    timeline: Array<{
      timestamp: Date;
      eventType: string;
      actor: string | null;
      description: string;
      metadata: Record<string, unknown>;
    }>;
    evidence: Awaited<ReturnType<typeof SecurityIncidentModel.getEvidence>>;
  }> {
    const [incident, timeline, evidence] = await Promise.all([
      SecurityIncidentModel.findById(incidentId),
      SecurityIncidentModel.getTimeline(incidentId),
      SecurityIncidentModel.getEvidence(incidentId),
    ]);

    const enrichedTimeline = timeline.map((e) => ({
      timestamp: e.occurred_at,
      eventType: e.event_type,
      actor: e.actor,
      description: e.description,
      metadata: e.metadata,
    }));

    // Prepend a synthetic "first_seen" marker based on the incident's first_seen_at
    if (incident && incident.first_seen_at < (timeline[0]?.occurred_at ?? incident.created_at)) {
      enrichedTimeline.unshift({
        timestamp: incident.first_seen_at,
        eventType: "THREAT_FIRST_OBSERVED",
        actor: null,
        description: `Threat pattern first observed (type: ${incident.incident_type})`,
        metadata: { source: "reconstruction" },
      });
    }

    return { incident, timeline: enrichedTimeline, evidence };
  },

  // ── SIEM Integration ────────────────────────────────────────────────────────

  /**
   * Push incident telemetry to all configured SIEM backends via
   * SiemAdapterService (Elastic + generic webhook adapters).
   *
   * On success: records a SIEM_PUSH_SUCCESS timeline event.
   * On partial/full failure: adds each failed adapter to the dead-letter
   *   queue (inside SiemAdapterService) and records a SIEM_PUSH_FAILED
   *   timeline event so analysts can see the gap.
   *
   * This method is non-fatal — SIEM push errors never abort the playbook.
   */
  async pushToSiem(payload: SiemPushPayload): Promise<void> {
    try {
      const result = await SiemAdapterService.push(payload);

      if (result.success) {
        // Record success in the incident timeline
        await SecurityIncidentModel.addTimelineEvent(
          payload.incidentId,
          "SIEM_PUSH_SUCCESS",
          `Incident telemetry delivered to SIEM (adapters: ${result.delivered.join(", ")})`,
          "siem-integration",
          {
            delivered: result.delivered,
            incidentId: payload.incidentId,
            severity: payload.severity,
          },
        );

        logger.info(
          { incidentId: payload.incidentId, delivered: result.delivered },
          "Incident pushed to SIEM successfully",
        );
      } else {
        // At least one adapter failed — record each failure in the timeline
        for (const failure of result.failed) {
          await SecurityIncidentModel.addTimelineEvent(
            payload.incidentId,
            "SIEM_PUSH_FAILED",
            `SIEM push failed for adapter '${failure.adapter}': ${failure.error}. Payload stored in dead-letter queue.`,
            "siem-integration",
            {
              adapter: failure.adapter,
              error: failure.error,
              dlqStored: true,
              incidentId: payload.incidentId,
            },
          );
        }

        // If some adapters succeeded, also record partial success
        if (result.delivered.length > 0) {
          await SecurityIncidentModel.addTimelineEvent(
            payload.incidentId,
            "SIEM_PUSH_PARTIAL",
            `SIEM push partially succeeded (delivered: ${result.delivered.join(", ")}; failed: ${result.failed.map((f) => f.adapter).join(", ")})`,
            "siem-integration",
            { delivered: result.delivered, failed: result.failed.map((f) => f.adapter) },
          );
        }

        logger.error(
          { incidentId: payload.incidentId, failed: result.failed, delivered: result.delivered },
          "SIEM push failed for one or more adapters — see dead-letter queue",
        );
      }
    } catch (err) {
      // Unexpected error from SiemAdapterService itself — non-fatal, log and continue
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { incidentId: payload.incidentId, error: errMsg },
        "Unexpected error in pushToSiem — continuing playbook",
      );
      try {
        await SecurityIncidentModel.addTimelineEvent(
          payload.incidentId,
          "SIEM_PUSH_FAILED",
          `Unexpected SIEM push error: ${errMsg}. Incident telemetry may be incomplete.`,
          "siem-integration",
          { error: errMsg, dlqStored: false },
        );
      } catch {
        // best-effort timeline update
      }
    }
  },

  // ── Incident Management ─────────────────────────────────────────────────────

  /** List incidents with filters. */
  async listIncidents(
    filter: Parameters<typeof SecurityIncidentModel.list>[0],
  ) {
    return SecurityIncidentModel.list(filter);
  },

  /** Get full incident details including timeline and evidence. */
  async getIncidentDetails(incidentId: string) {
    return this.reconstructTimeline(incidentId);
  },

  /** Update incident status manually (e.g. analyst closes or dismisses). */
  async updateIncidentStatus(
    incidentId: string,
    status: SecurityIncidentStatus,
    analystNotes?: string,
    actor?: string,
  ): Promise<SecurityIncident | null> {
    const incident = await SecurityIncidentModel.updateStatus(incidentId, status);
    if (!incident) return null;

    if (analystNotes) {
      await SecurityIncidentModel.patch(incidentId, { analystNotes });
    }

    await SecurityIncidentModel.addTimelineEvent(
      incidentId,
      "STATUS_UPDATED",
      `Status manually updated to '${status}'${analystNotes ? `: ${analystNotes}` : ""}`,
      actor ?? "analyst",
      { previousStatus: incident.status, newStatus: status },
    );

    return incident;
  },

  /** Get incident statistics for the dashboard. */
  async getStats(fromDate: Date, toDate: Date) {
    return SecurityIncidentModel.getStats(fromDate, toDate);
  },

  /** Add an analyst note to the incident timeline. */
  async addAnalystNote(
    incidentId: string,
    note: string,
    analystId: string,
  ): Promise<void> {
    await SecurityIncidentModel.addTimelineEvent(
      incidentId,
      "ANALYST_NOTE",
      note,
      analystId,
      {},
    );
    await SecurityIncidentModel.patch(incidentId, { analystNotes: note });
  },
};
