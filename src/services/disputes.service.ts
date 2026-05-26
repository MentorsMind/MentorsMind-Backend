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

export class DisputeService {
  /**
   * Opens a new dispute.
   */
  static async openDispute(
    transactionId: string,
    reporterId: string,
    reason: string,
  ): Promise<DisputeRecord> {
    const dispute = await DisputeModel.create({
      transaction_id: transactionId,
      reporter_id: reporterId,
      reason,
    });

    await AuditLogModel.create({
      level: "info",
      action: "dispute_opened",
      message: `Dispute opened for transaction ${transactionId}`,
      user_id: reporterId,
      entity_type: "dispute",
      entity_id: dispute.id,
      metadata: { reason },
      ip_address: null,
      user_agent: null,
    });

    // Notify reporter and the other party (mentor or mentee)
    const { rows: bookingRows } = await pool.query<{
      mentor_id: string;
      mentee_id: string;
    }>(`SELECT mentor_id, mentee_id FROM bookings WHERE id = $1 LIMIT 1`, [
      transactionId,
    ]);
    const booking = bookingRows[0];
    const otherPartyId =
      booking &&
      (booking.mentor_id === reporterId
        ? booking.mentee_id
        : booking.mentor_id);

    const openedNotifications = [
      NotificationService.sendNotification({
        userId: reporterId,
        type: NotificationType.DISPUTE_CREATED,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        priority: NotificationPriority.HIGH,
        data: { disputeId: dispute.id, event: "dispute_opened" },
      }),
    ];
    if (otherPartyId) {
      openedNotifications.push(
        NotificationService.sendNotification({
          userId: otherPartyId,
          type: NotificationType.DISPUTE_CREATED,
          channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
          priority: NotificationPriority.HIGH,
          data: { disputeId: dispute.id, event: "dispute_opened" },
        }),
      );
    }
    await Promise.all(openedNotifications);

    return dispute;
  }

  /**
   * Adds evidence to a dispute and notifies parties.
   */
  static async uploadEvidence(
    disputeId: string,
    userId: string,
    textContent?: string,
    fileUrl?: string,
  ) {
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
      ip_address: null,
      user_agent: null,
    });

    return evidence;
  }

  /**
   * Automatically escalate disputes older than 7 days to `under_review`.
   */
  static async escalateOldDisputes(): Promise<number> {
    const oldDisputes = await DisputeModel.findUnresolvedOlderThanDays(7);
    let escalatedCount = 0;

    for (const dispute of oldDisputes) {
      if (DisputeStateMachine.canTransition(dispute.status, "under_review")) {
        await DisputeModel.updateStatus(
          dispute.id,
          "under_review",
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
          dispute.transaction_id,
        ]);
        const escalateBooking = escalateBookingRows[0];
        const escalateOtherPartyId =
          escalateBooking &&
          (escalateBooking.mentor_id === dispute.reporter_id
            ? escalateBooking.mentee_id
            : escalateBooking.mentor_id);

        const escalateNotifications = [
          NotificationService.sendNotification({
            userId: dispute.reporter_id,
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
      }
    }
    return escalatedCount;
  }

  /**
   * Admins resolve a dispute.
   * Looks up the booking's escrow_id and escrow_contract_address via the dispute's
   * transaction_id, calls the real SorobanEscrowService, and wraps the escrow call
   * + DB status update in a single transaction so they succeed or fail together.
   */
  static async resolveDispute(
    disputeId: string,
    adminId: string,
    resolutionType: "full_refund" | "partial_refund" | "release",
    notes: string,
  ): Promise<DisputeRecord> {
    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) throw new Error("Dispute not found");

    DisputeStateMachine.assertTransition(dispute.status, "resolved");

    // Look up escrow details from the bookings table using the dispute's transaction_id
    const { rows } = await pool.query<{
      escrow_id: string | null;
      escrow_contract_address: string | null;
      mentor_id: string;
      mentee_id: string;
    }>(
      `SELECT escrow_id, escrow_contract_address, mentor_id, mentee_id FROM bookings WHERE id = $1 LIMIT 1`,
      [dispute.transaction_id],
    );
    const booking = rows[0];
    if (!booking?.escrow_id) {
      throw new Error(
        `No escrow_id found for booking ${dispute.transaction_id}`,
      );
    }

    // Execute escrow action + DB status update atomically
    const updated = await DatabaseService.withTransaction(async (client) => {
      // 1. Call the real Soroban escrow contract
      if (
        resolutionType === "full_refund" ||
        resolutionType === "partial_refund"
      ) {
        await SorobanEscrowService.refund({
          escrowId: booking.escrow_id!,
          refundedBy: adminId,
          contractAddress: booking.escrow_contract_address ?? undefined,
        });
      } else {
        await SorobanEscrowService.releaseFunds({
          escrowId: booking.escrow_id!,
          releasedBy: adminId,
          contractAddress: booking.escrow_contract_address ?? undefined,
        });
      }

      // 2. Update dispute status inside the same transaction
      const result = await client.query<DisputeRecord>(
        `UPDATE disputes SET status = 'resolved', resolution_notes = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [notes, disputeId],
      );
      return result.rows[0];
    });

    await AuditLogModel.create({
      level: "info",
      action: "dispute_resolved",
      message: `Dispute ${disputeId} resolved by admin ${adminId} via ${resolutionType}`,
      user_id: adminId,
      entity_type: "dispute",
      entity_id: disputeId,
      metadata: { resolutionType, notes },
      ip_address: null,
      user_agent: null,
    });

    await NotificationService.sendNotification({
      userId: dispute.reporter_id,
      type: NotificationType.SYSTEM_ALERT,
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      priority: NotificationPriority.HIGH,
      data: { disputeId, event: "dispute_resolved", resolutionType },
    });

    // Notify the other party (mentor or mentee)
    const resolveOtherPartyId =
      booking.mentor_id === dispute.reporter_id
        ? booking.mentee_id
        : booking.mentor_id;
    if (resolveOtherPartyId) {
      await NotificationService.sendNotification({
        userId: resolveOtherPartyId,
        type: NotificationType.SYSTEM_ALERT,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        priority: NotificationPriority.HIGH,
        data: { disputeId, event: "dispute_resolved", resolutionType },
      });
    }

    return updated;
  }
}
