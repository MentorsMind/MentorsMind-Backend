import { DisputeModel, DisputeRecord } from "../models/dispute.model";
import { DisputeStateMachine } from "./dispute-state-machine.service";
import { AuditLogModel } from "../models/audit-log.model";
import { SorobanEscrowService } from "./sorobanEscrow.service";
import { DatabaseService } from "./database.service";
import {
  NotificationService,
  NotificationChannel,
  NotificationPriority,
} from "./notification.service";
import { NotificationType } from "../models/notifications.model";
import pool from "../config/database";
import {
  emitDisputeOpened,
  emitDisputeResolved,
} from "./outbox.service";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";
import { logger } from "../utils/logger.utils";

export class DisputeService {
  static async openDispute(
    sessionId: string,
    filedById: string,
    type: "payment" | "quality" | "conduct" | "cancellation",
    reason: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<DisputeRecord> {
    const { rows: bookingRows } = await pool.query<{
      mentor_id: string;
      mentee_id: string;
      escrow_id: string | null;
    }>(`SELECT mentor_id, mentee_id, escrow_id FROM bookings WHERE id = $1 LIMIT 1`, [
      sessionId,
    ]);
    const booking = bookingRows[0];
    if (!booking) throw createError(ErrorCode.DISPUTE_SESSION_NOT_FOUND, 404);

    // Uniqueness check: verify no active/open dispute already exists for this booking before cancelling escrow
    const existingDispute = await DisputeModel.findOpenBySessionId(sessionId);
    if (existingDispute) {
      throw createError(ErrorCode.DISPUTE_ALREADY_EXISTS, 409);
    }

    if (booking.escrow_id) {
      const { cancelEscrowRelease } = await import("../queues/escrow-release.queue");
      await cancelEscrowRelease(booking.escrow_id);
    }

    const respondentId =
      booking.mentor_id === filedById ? booking.mentee_id : booking.mentor_id;

    // Atomic writes: dispute INSERT + audit-log INSERT + outbox row.
    // The outbox worker re-dispatches the notification fan-out reliably
    // if the process crashes before sendNotification finishes.
    const dispute = await DatabaseService.withTransaction(async (client) => {
      // In-transaction concurrency check (protects against simultaneous duplicate requests)
      const existingInTx = await DisputeModel.findOpenBySessionId(sessionId, client);
      if (existingInTx) {
        throw createError(ErrorCode.DISPUTE_ALREADY_EXISTS, 409);
      }

      const insertResult = await client.query<DisputeRecord>(
        `INSERT INTO disputes (session_id, filed_by_id, respondent_id, type, reason, status)
         VALUES ($1, $2, $3, $4, $5, 'open')
         RETURNING *`,
        [sessionId, filedById, respondentId, type, reason],
      );
      const created = insertResult.rows[0];
      if (!created) throw createError(ErrorCode.DISPUTE_CREATION_FAILED, 500);

      await client.query(
        `INSERT INTO audit_logs
           (level, action, message, user_id, entity_type, entity_id, metadata, ip_address, user_agent)
         VALUES ('info', 'dispute_opened', $1, $2, 'dispute', $3, $4, NULL, NULL)`,
        [
          `Dispute opened for session ${sessionId}`,
          filedById,
          created.id,
          JSON.stringify({ reason, type }),
        ],
      );

      await emitDisputeOpened(
        {
          disputeId: created.id,
          filedById,
          respondentId,
          bookingId: sessionId,
          type,
          reason,
        },
        { client, userId: filedById },
      );

      return created;
    });

    return dispute;
  }

  /**
   * Adds evidence to a dispute and notifies parties.
   */
  static async uploadEvidence(
    disputeId: string,
    userId: string,
    userRole: string,
    textContent?: string,
    fileUrl?: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ) {
    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) throw createError(ErrorCode.DISPUTE_NOT_FOUND, 404);

    if (dispute.filed_by_id !== userId && dispute.respondent_id !== userId && userRole !== "admin") {
      throw createError(ErrorCode.DISPUTE_UNAUTHORIZED, 403);
    }

    const evidence = await DisputeModel.addEvidence({
      dispute_id: disputeId,
      submitter_id: userId,
      text_content: textContent,
      file_url: fileUrl,
    });

    // Check if we need to auto-transition to under_review conceptually, or just log
    await AuditLogModel.create({
      level: "info",
      action: "dispute_evidence_added",
      message: `Evidence added to dispute ${disputeId}`,
      user_id: userId,
      entity_type: "dispute_evidence",
      entity_id: evidence.id,
      metadata: { file_attached: !!fileUrl },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    return evidence;
  }

  /**
   * Automatically escalate disputes older than 7 days to `investigating`.
   */
  static async escalateOldDisputes(): Promise<number> {
    logger.info("[DisputeService] Checking for old disputes to escalate");
    const oldDisputes = await DisputeModel.findUnresolvedOlderThanDays(7);
    let escalatedCount = 0;

    for (const dispute of oldDisputes) {
      try {
        if (
          dispute.status !== "investigating" &&
          DisputeStateMachine.canTransition(dispute.status, "investigating")
        ) {
          await DisputeModel.updateStatus(
            dispute.id,
            "investigating",
            "Auto-escalated after 7 days",
          );

          await AuditLogModel.create({
            level: "warn",
            action: "dispute_escalated",
            message: `Dispute ${dispute.id} automatically escalated`,
            user_id: null,
            entity_type: "dispute",
            entity_id: dispute.id,
            metadata: { previous_status: dispute.status },
            ip_address: null,
            user_agent: null,
          });

          // Notify reporter and the other party about escalation
          const { rows: escalateBookingRows } = await pool.query<{
            mentor_id: string;
            mentee_id: string;
          }>(`SELECT mentor_id, mentee_id FROM bookings WHERE id = $1 LIMIT 1`, [
            dispute.session_id,
          ]);
          const escalateBooking = escalateBookingRows[0];
          const escalateOtherPartyId =
            escalateBooking &&
            (escalateBooking.mentor_id === dispute.filed_by_id
              ? escalateBooking.mentee_id
              : escalateBooking.mentor_id);

          const escalateNotifications = [
            NotificationService.sendNotification({
              userId: dispute.filed_by_id,
              type: NotificationType.DISPUTE_CREATED,
              channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
              priority: NotificationPriority.HIGH,
              data: { disputeId: dispute.id, event: "dispute_escalated" },
            }),
          ];
          if (escalateOtherPartyId) {
            escalateNotifications.push(
              NotificationService.sendNotification({
                userId: escalateOtherPartyId,
                type: NotificationType.DISPUTE_CREATED,
                channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
                priority: NotificationPriority.HIGH,
                data: { disputeId: dispute.id, event: "dispute_escalated" },
              }),
            );
          }
          await Promise.all(escalateNotifications);
          escalatedCount++;
          logger.info("[DisputeService] Dispute auto-escalated to investigating", {
            disputeId: dispute.id,
          });
        }
      } catch (err) {
        logger.error("[DisputeService] Failed to escalate dispute", {
          disputeId: dispute.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info("[DisputeService] Dispute escalation sweep completed", {
      escalatedCount,
      totalChecked: oldDisputes.length,
    });
    return escalatedCount;
  }

  /**
   * Move dispute to mediation workflow.
   */
  static async mediateDispute(
    disputeId: string,
    adminId: string,
    notes: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<DisputeRecord> {
    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) throw createError(ErrorCode.DISPUTE_NOT_FOUND, 404);

    DisputeStateMachine.assertTransition(dispute.status, "mediation");

    const updated = await DisputeModel.updateStatus(
      disputeId,
      "mediation",
      notes,
    );

    await AuditLogModel.create({
      level: "info",
      action: "dispute_mediated",
      message: `Dispute ${disputeId} moved to mediation by admin ${adminId}`,
      user_id: adminId,
      entity_type: "dispute",
      entity_id: disputeId,
      metadata: { notes },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    return updated!;
  }

  /**
   * Admins resolve a dispute.
   * Looks up the booking's escrow_id and escrow_contract_address via the dispute's
   * session_id, calls the real SorobanEscrowService, and wraps the escrow call
   * + DB status update + outbox event in a single transaction so the durable
   * side-effects remain consistent.
   */
  static async resolveDispute(
    disputeId: string,
    adminId: string,
    mentorPct: number,
    notes: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<DisputeRecord> {
    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) throw createError(ErrorCode.DISPUTE_NOT_FOUND, 404);

    DisputeStateMachine.assertTransition(dispute.status, "resolved");

    // Look up escrow details from the bookings table using the dispute's session_id
    const { rows } = await pool.query<{
      escrow_id: string | null;
      escrow_contract_address: string | null;
      mentor_id: string;
      mentee_id: string;
    }>(
      `SELECT escrow_id, escrow_contract_address, mentor_id, mentee_id FROM bookings WHERE id = $1 LIMIT 1`,
      [dispute.session_id],
    );
    const booking = rows[0];
    if (!booking?.escrow_id) {
      throw createError(ErrorCode.DISPUTE_ESCROW_MISSING, 400);
    }

    // Execute escrow action + DB status update + outbox write atomically.
    // The outbox worker re-dispatches notifications if the process crashes
    // before they finish.
    const updated = await DatabaseService.withTransaction(async (client) => {
      // 1. Call the real Soroban escrow contract's resolve_dispute
      await SorobanEscrowService.resolveDispute({
        escrowId: booking.escrow_id!,
        splitPercentage: mentorPct,
        resolvedBy: adminId,
        contractAddress: booking.escrow_contract_address ?? undefined,
      });

      // 2. Update dispute status inside the same transaction
      const result = await client.query<DisputeRecord>(
        `UPDATE disputes SET status = 'resolved', resolution_notes = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [notes, disputeId],
      );

      if (!result.rows[0]) {
        throw createError(ErrorCode.DISPUTE_UPDATE_FAILED, 500);
      }

      // 3. Outbox event committed atomically with dispute status + escrow call.
      await emitDisputeResolved(
        {
          disputeId,
          filedById: dispute.filed_by_id,
          respondentId:
            booking.mentor_id === dispute.filed_by_id
              ? booking.mentee_id
              : booking.mentor_id,
          bookingId: dispute.session_id,
          mentorPct,
          notes,
        },
        { client, userId: adminId },
      );

      return result.rows[0];
    });

    await AuditLogModel.create({
      level: "info",
      action: "dispute_resolved",
      message: `Dispute ${disputeId} resolved by admin ${adminId} with mentorPct ${mentorPct}`,
      user_id: adminId,
      entity_type: "dispute",
      entity_id: disputeId,
      metadata: { mentorPct, notes },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    return updated;
  }
}
