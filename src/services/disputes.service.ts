import { DisputeModel, DisputeRecord } from '../models/dispute.model';
import { DisputeStateMachine } from './dispute-state-machine.service';
import { AuditLogModel } from '../models/audit-log.model';
import { logger } from '../utils/logger';

// Placeholder for Escrow API integration (Issue #B10)
export const EscrowService = {
  async processResolution(transactionId: string, action: 'refund' | 'release'): Promise<void> {
    logger.info(`[EscrowService] Processing ${action} for transaction ${transactionId}`);
  }
};

// Placeholder for Notification System integration (Issue #B15)
export const NotificationService = {
  async notifyDisputeUpdate(userId: string, disputeId: string, event: string): Promise<void> {
    logger.info(`[NotificationService] Sending email to ${userId} regarding dispute ${disputeId}: ${event}`);
  }
};

export class DisputeService {
  /**
   * Opens a new dispute.
   */
  static async openDispute(transactionId: string, reporterId: string, reason: string): Promise<DisputeRecord> {
    const dispute = await DisputeModel.create({ transaction_id: transactionId, reporter_id: reporterId, reason });
    
    await AuditLogModel.create({
      level: 'info', action: 'dispute_opened', message: `Dispute opened for transaction ${transactionId}`,
      user_id: reporterId, entity_type: 'dispute', entity_id: dispute.id, metadata: { reason },
      ip_address: null, user_agent: null
    });

    await NotificationService.notifyDisputeUpdate(reporterId, dispute.id, 'Dispute Opened');
    return dispute;
  }

  /**
   * Adds evidence to a dispute and notifies parties.
   */
  static async uploadEvidence(disputeId: string, userId: string, textContent?: string, fileUrl?: string) {
    const evidence = await DisputeModel.addEvidence({ dispute_id: disputeId, submitter_id: userId, text_content: textContent, file_url: fileUrl });
    
    // Check if we need to auto-transition to under_review conceptually, or just log
    await AuditLogModel.create({
      level: 'info', action: 'dispute_evidence_added', message: `Evidence added to dispute ${disputeId}`,
      user_id: userId, entity_type: 'dispute_evidence', entity_id: evidence.id, metadata: { file_attached: !!fileUrl },
      ip_address: null, user_agent: null
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
      if (DisputeStateMachine.canTransition(dispute.status, 'under_review')) {
        await DisputeModel.updateStatus(dispute.id, 'under_review', 'Auto-escalated after 7 days');
        
        await AuditLogModel.create({
          level: 'warn', action: 'dispute_escalated', message: `Dispute ${dispute.id} automatically escalated`,
          user_id: null, entity_type: 'dispute', entity_id: dispute.id, metadata: { previous_status: dispute.status },
          ip_address: null, user_agent: null
        });

        await NotificationService.notifyDisputeUpdate(dispute.reporter_id, dispute.id, 'Dispute auto-escalated to admin review');
        escalatedCount++;
      }
    }
    return escalatedCount;
  }

  /**
   * Admins resolve a dispute.
   */
  static async resolveDispute(
    disputeId: string, adminId: string, resolutionType: 'full_refund' | 'partial_refund' | 'release', notes: string
  ): Promise<DisputeRecord> {
    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) throw new Error('Dispute not found');

    DisputeStateMachine.assertTransition(dispute.status, 'resolved');
    
    const updated = await DisputeModel.updateStatus(disputeId, 'resolved', notes);

    // Trigger escrow behavior
    if (resolutionType === 'full_refund' || resolutionType === 'partial_refund') {
      await EscrowService.processResolution(dispute.transaction_id, 'refund');
    } else if (resolutionType === 'release') {
      await EscrowService.processResolution(dispute.transaction_id, 'release');
    }

    await AuditLogModel.create({
      level: 'info', action: 'dispute_resolved', message: `Dispute ${disputeId} resolved by admin ${adminId} via ${resolutionType}`,
      user_id: adminId, entity_type: 'dispute', entity_id: disputeId, metadata: { resolutionType, notes },
      ip_address: null, user_agent: null
    });

    await NotificationService.notifyDisputeUpdate(dispute.reporter_id, disputeId, `Dispute resolved: ${resolutionType}`);

    return updated!;
  }
}
