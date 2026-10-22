import { DisputeModel, DisputeRecord, DisputeStatus, DisputeType } from "../models/dispute.model";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";
import { db } from "../config/database";
import {
  NotificationService,
  NotificationChannel,
  NotificationPriority,
} from "./notification.service";
import { NotificationType } from "../models/notifications.model";
import { SocketService } from "./socket.service";

export interface FileDisputeParams {
  sessionId: string;
  filedById: string;
  respondentId: string;
  type: DisputeType;
  reason: string;
}

export interface SubmitEvidenceParams {
  disputeId: string;
  submitterId: string;
  textContent?: string;
  fileUrl?: string;
}

export interface ResolveDisputeParams {
  disputeId: string;
  resolvedById: string;
  resolutionNotes: string;
  resolutionType: "favor_filer" | "favor_respondent" | "compromise" | "dismissed";
}

export interface DisputeWithEvidence extends DisputeRecord {
  evidence: Array<{
    id: string;
    submitter_id: string;
    text_content: string | null;
    file_url: string | null;
    created_at: Date;
  }>;
  filer_name?: string;
  respondent_name?: string;
}

export type DisputeWorkflowStatus =
  | "filed"
  | "evidence_collection"
  | "mediation_scheduled"
  | "in_mediation"
  | "resolved"
  | "dismissed"
  | "escalated";

const MAX_EVIDENCE_PER_DISPUTE = 10;

const VALID_STATUS_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  open: ["investigating", "dismissed"],
  investigating: ["mediation", "resolved", "dismissed", "escalated"],
  mediation: ["resolved", "dismissed", "escalated"],
  resolved: [],
  dismissed: [],
  escalated: ["investigating", "mediation"],
};

export const DisputeResolutionService = {
  async fileDispute(params: FileDisputeParams): Promise<DisputeRecord> {
    // Verify session exists and user is a party
    const { rows: sessionRows } = await db.query(
      `SELECT id, mentor_id, mentee_id FROM sessions WHERE id = $1`,
      [params.sessionId],
    );

    if (sessionRows.length === 0) {
      throw createError(ErrorCode.DISPUTE_SESSION_NOT_FOUND, 404);
    }

    const session = sessionRows[0];
    if (session.mentor_id !== params.filedById && session.mentee_id !== params.filedById) {
      throw createError(ErrorCode.DISPUTE_UNAUTHORIZED, 403);
    }

    // Verify respondent is the other party
    if (session.mentor_id !== params.respondentId && session.mentee_id !== params.respondentId) {
      throw createError(ErrorCode.VALIDATION_ERROR, 400);
    }

    // Check for existing open dispute on this session
    const existingDisputes = await DisputeModel.findByUserId(params.filedById);
    const existingOpen = existingDisputes.find(
      (d) => d.session_id === params.sessionId && !["resolved", "dismissed"].includes(d.status),
    );
    if (existingOpen) {
      throw createError(ErrorCode.CONFLICT, 409);
    }

    const dispute = await DisputeModel.create({
      session_id: params.sessionId,
      filed_by_id: params.filedById,
      respondent_id: params.respondentId,
      type: params.type,
      reason: params.reason,
    });

    // Notify respondent
    try {
      await NotificationService.sendNotification({
        userId: params.respondentId,
        type: NotificationType.DISPUTE_CREATED,
        channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
        priority: NotificationPriority.HIGH,
        data: {
          disputeId: dispute.id,
          sessionId: params.sessionId,
          disputeType: params.type,
          filedBy: params.filedById,
        },
      });
    } catch (error) {
      logger.warn("Failed to send dispute notification", { disputeId: dispute.id, error });
    }

    // Emit real-time event
    SocketService.emitToUser(params.respondentId, "dispute:filed", {
      disputeId: dispute.id,
      sessionId: params.sessionId,
      type: params.type,
    });

    logger.info("Dispute filed", {
      disputeId: dispute.id,
      sessionId: params.sessionId,
      filedBy: params.filedById,
      type: params.type,
    });

    return dispute;
  },

  async submitEvidence(params: SubmitEvidenceParams): Promise<any> {
    const dispute = await DisputeModel.findById(params.disputeId);
    if (!dispute) {
      throw createError(ErrorCode.DISPUTE_NOT_FOUND, 404);
    }

    // Verify user is a party
    if (dispute.filed_by_id !== params.submitterId && dispute.respondent_id !== params.submitterId) {
      throw createError(ErrorCode.DISPUTE_UNAUTHORIZED, 403);
    }

    // Check dispute is still open for evidence
    if (["resolved", "dismissed"].includes(dispute.status)) {
      throw createError(ErrorCode.DISPUTE_INVALID_STATUS_TRANSITION, 400);
    }

    // Check evidence limit
    const existingEvidence = await DisputeModel.getEvidence(params.disputeId);
    if (existingEvidence.length >= MAX_EVIDENCE_PER_DISPUTE) {
      throw createError(ErrorCode.DISPUTE_EVIDENCE_LIMIT_EXCEEDED, 400);
    }

    const evidence = await DisputeModel.addEvidence({
      dispute_id: params.disputeId,
      submitter_id: params.submitterId,
      text_content: params.textContent,
      file_url: params.fileUrl,
    });

    // Update status to investigating if currently open
    if (dispute.status === "open") {
      await DisputeModel.updateStatus(params.disputeId, "investigating");
    }

    // Notify other party
    const notifyUserId = dispute.filed_by_id === params.submitterId
      ? dispute.respondent_id
      : dispute.filed_by_id;

    SocketService.emitToUser(notifyUserId!, "dispute:evidence_added", {
      disputeId: params.disputeId,
      evidenceId: evidence.id,
    });

    logger.info("Evidence submitted to dispute", {
      disputeId: params.disputeId,
      evidenceId: evidence.id,
      submitterId: params.submitterId,
    });

    return evidence;
  },

  async transitionStatus(
    disputeId: string,
    newStatus: DisputeStatus,
    userId: string,
    notes?: string,
  ): Promise<DisputeRecord> {
    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) {
      throw createError(ErrorCode.DISPUTE_NOT_FOUND, 404);
    }

    // Verify valid transition
    const validTransitions = VALID_STATUS_TRANSITIONS[dispute.status];
    if (!validTransitions.includes(newStatus)) {
      throw createError(ErrorCode.DISPUTE_INVALID_STATUS_TRANSITION, 400);
    }

    const updated = await DisputeModel.updateStatus(disputeId, newStatus, notes);
    if (!updated) {
      throw createError(ErrorCode.DISPUTE_UPDATE_FAILED, 500);
    }

    // Notify both parties
    const notifyUsers = [dispute.filed_by_id, dispute.respondent_id].filter(Boolean);
    for (const userId of notifyUsers) {
      SocketService.emitToUser(userId!, "dispute:status_changed", {
        disputeId,
        previousStatus: dispute.status,
        newStatus,
      });
    }

    logger.info("Dispute status transitioned", {
      disputeId,
      from: dispute.status,
      to: newStatus,
      userId,
    });

    return updated;
  },

  async resolveDispute(params: ResolveDisputeParams): Promise<DisputeRecord> {
    const dispute = await DisputeModel.findById(params.disputeId);
    if (!dispute) {
      throw createError(ErrorCode.DISPUTE_NOT_FOUND, 404);
    }

    if (["resolved", "dismissed"].includes(dispute.status)) {
      throw createError(ErrorCode.DISPUTE_ALREADY_RESOLVED, 409);
    }

    const resolutionNotes = `[${params.resolutionType.toUpperCase()}] ${params.resolutionNotes}`;

    const updated = await DisputeModel.updateStatus(
      params.disputeId,
      "resolved",
      resolutionNotes,
    );

    if (!updated) {
      throw createError(ErrorCode.DISPUTE_RESOLUTION_FAILED, 500);
    }

    // Notify both parties
    const notifyUsers = [dispute.filed_by_id, dispute.respondent_id].filter(Boolean);
    for (const uid of notifyUsers) {
      try {
        await NotificationService.sendNotification({
          userId: uid!,
          type: NotificationType.DISPUTE_CREATED,
          channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
          priority: NotificationPriority.HIGH,
          data: {
            disputeId: params.disputeId,
            resolutionType: params.resolutionType,
            resolutionNotes: params.resolutionNotes,
          },
        });
      } catch (error) {
        logger.warn("Failed to send dispute resolution notification", { disputeId: params.disputeId, error });
      }

      SocketService.emitToUser(uid!, "dispute:resolved", {
        disputeId: params.disputeId,
        resolutionType: params.resolutionType,
      });
    }

    logger.info("Dispute resolved", {
      disputeId: params.disputeId,
      resolutionType: params.resolutionType,
      resolvedBy: params.resolvedById,
    });

    return updated;
  },

  async getDisputeWithEvidence(
    disputeId: string,
    userId: string,
  ): Promise<DisputeWithEvidence> {
    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) {
      throw createError(ErrorCode.DISPUTE_NOT_FOUND, 404);
    }

    if (dispute.filed_by_id !== userId && dispute.respondent_id !== userId) {
      throw createError(ErrorCode.DISPUTE_UNAUTHORIZED, 403);
    }

    const evidence = await DisputeModel.getEvidence(disputeId);

    // Get names
    const partyIds = [dispute.filed_by_id, dispute.respondent_id].filter(Boolean);
    const { rows: users } = await db.query(
      `SELECT id, first_name, last_name FROM users WHERE id = ANY($1)`,
      [partyIds],
    );

    const userMap = new Map<string, string>(
      users.map((u: any): [string, string] => [u.id, `${u.first_name} ${u.last_name}`]),
    );

    return {
      ...dispute,
      evidence,
      filer_name: userMap.get(dispute.filed_by_id),
      respondent_name: dispute.respondent_id ? userMap.get(dispute.respondent_id) : undefined,
    };
  },

  async getUserDisputes(
    userId: string,
    options?: { status?: DisputeStatus; page?: number; limit?: number },
  ): Promise<{ disputes: DisputeRecord[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM disputes WHERE (filed_by_id = $1 OR respondent_id = $1)`;
    const params: unknown[] = [userId];

    if (options?.status) {
      query += ` AND status = $2`;
      params.push(options.status);
    }

    const countQuery = query.replace("SELECT *", "SELECT COUNT(*)");
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, params.slice(0, -2)),
    ]);

    return {
      disputes: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async getActiveDisputesCount(): Promise<number> {
    return DisputeModel.countActive();
  },

  async getStaleDisputes(days = 7): Promise<DisputeRecord[]> {
    return DisputeModel.findUnresolvedOlderThanDays(days);
  },
};
