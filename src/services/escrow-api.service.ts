import { EscrowModel, EscrowRecord, EscrowStatus } from '../models/escrow.model';
import { DisputeModel } from '../models/dispute.model';
import pool from '../config/database';
import { SorobanEscrowService } from './sorobanEscrow.service';
import { logger } from '../utils/logger.utils';

export class EscrowApiService {
  /**
   * Create a new escrow contract
   */
  static async createEscrow(data: {
    learnerId: string;
    mentorId: string;
    amount: string;
    currency: string;
    description?: string;
  }): Promise<EscrowRecord> {
    logger.info('Creating escrow', { learnerId: data.learnerId, mentorId: data.mentorId, amount: data.amount });

    const escrow = await EscrowModel.create(data);

    if (SorobanEscrowService.isConfigured()) {
      const onChain = await SorobanEscrowService.createEscrow({
        bookingId: escrow.id,
        learnerId: data.learnerId,
        mentorId: data.mentorId,
        amount: data.amount,
        currency: data.currency,
      });

      if (onChain.txHash) {
        await EscrowModel.updateStatus(escrow.id, escrow.status, {
          stellar_tx_hash: onChain.txHash,
        });
      }

      logger.info('Soroban create_escrow invoked', {
        escrowId: escrow.id,
        contractAddress: onChain.contractAddress,
        onChainEscrowId: onChain.escrowId,
        txHash: onChain.txHash,
      });
    }
    
    logger.info('Escrow created', { escrowId: escrow.id });
    return escrow;
  }

  /**
   * Get escrow details by ID
   */
  static async getEscrowById(id: string): Promise<EscrowRecord | null> {
    return await EscrowModel.findById(id);
  }

  /**
   * Release funds to mentor
   */
  static async releaseEscrow(
    escrowId: string,
    userId: string,
    stellarTxHash?: string
  ): Promise<EscrowRecord> {
    const escrow = await EscrowModel.findById(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    // Validate state transition
    if (escrow.status !== 'funded' && escrow.status !== 'pending') {
      throw new Error(`Cannot release escrow in ${escrow.status} status`);
    }

    // Only learner can release funds
    if (escrow.learner_id !== userId) {
      throw new Error('Only the learner can release funds');
    }

    logger.info('Releasing escrow', { escrowId, userId });

    let txHashFromChain: string | null = null;
    if (SorobanEscrowService.isConfigured()) {
      const chainResult = await SorobanEscrowService.releaseFunds({
        escrowId,
        releasedBy: userId,
      });
      txHashFromChain = chainResult.txHash;
    }

    const updated = await EscrowModel.updateStatus(escrowId, 'released', {
      stellar_tx_hash: stellarTxHash || txHashFromChain || escrow.stellar_tx_hash,
      released_at: new Date(),
    });

    if (!updated) {
      throw new Error('Failed to update escrow status');
    }

    logger.info('Escrow released', { escrowId });
    return updated;
  }

  /**
   * Open a dispute for an escrow
   */
  static async openDispute(
    escrowId: string,
    userId: string,
    reason: string
  ): Promise<{ escrow: EscrowRecord; disputeId: string }> {
    const escrow = await EscrowModel.findById(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    // Validate state
    if (escrow.status === 'released' || escrow.status === 'refunded' || escrow.status === 'cancelled') {
      throw new Error(`Cannot dispute escrow in ${escrow.status} status`);
    }

    if (escrow.status === 'disputed') {
      throw new Error('Escrow already has an active dispute');
    }

    // Only learner or mentor can open dispute
    if (escrow.learner_id !== userId && escrow.mentor_id !== userId) {
      throw new Error('Only the learner or mentor can open a dispute');
    }

    logger.info('Opening dispute', { escrowId, userId, reason });

    if (SorobanEscrowService.isConfigured()) {
      await SorobanEscrowService.openDispute({
        escrowId,
        raisedBy: userId,
        reason,
      });
    }

    // Create dispute record (assuming we need to create it in disputes table)
    const dispute = await pool.query(
      `INSERT INTO disputes (transaction_id, reporter_id, reason, status)
       VALUES ($1, $2, $3, 'open')
       RETURNING id`,
      [escrowId, userId, reason]
    );

    const disputeId = dispute.rows[0].id;

    const updated = await EscrowModel.updateStatus(escrowId, 'disputed', {
      dispute_id: disputeId,
    });

    if (!updated) {
      throw new Error('Failed to update escrow status');
    }

    logger.info('Dispute opened', { escrowId, disputeId });
    return { escrow: updated, disputeId };
  }

  /**
   * Resolve a dispute (admin only)
   */
  static async resolveDispute(
    escrowId: string,
    resolution: 'release_to_mentor' | 'refund_to_learner',
    notes?: string,
    stellarTxHash?: string,
    splitPercentage?: number,
  ): Promise<EscrowRecord> {
    const escrow = await EscrowModel.findById(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    if (escrow.status !== 'disputed') {
      throw new Error('Escrow is not in disputed status');
    }

    if (!escrow.dispute_id) {
      throw new Error('No dispute found for this escrow');
    }

    logger.info('Resolving dispute', { escrowId, resolution, disputeId: escrow.dispute_id });

    let txHashFromChain: string | null = null;
    if (SorobanEscrowService.isConfigured()) {
      const resolvedSplit =
        splitPercentage ?? (resolution === 'release_to_mentor' ? 100 : 0);
      const chainResult = await SorobanEscrowService.resolveDispute({
        escrowId,
        splitPercentage: resolvedSplit,
        resolvedBy: 'admin',
      });
      txHashFromChain = chainResult.txHash;
    }

    // Update dispute status
    await DisputeModel.updateStatus(escrow.dispute_id, 'resolved', notes);

    // Update escrow based on resolution
    const newStatus: EscrowStatus = resolution === 'release_to_mentor' ? 'released' : 'refunded';
    const additionalFields: any = {
      stellar_tx_hash: stellarTxHash || txHashFromChain || escrow.stellar_tx_hash,
    };

    if (resolution === 'release_to_mentor') {
      additionalFields.released_at = new Date();
    } else {
      additionalFields.refunded_at = new Date();
    }

    const updated = await EscrowModel.updateStatus(escrowId, newStatus, additionalFields);

    if (!updated) {
      throw new Error('Failed to update escrow status');
    }

    logger.info('Dispute resolved', { escrowId, resolution });
    return updated;
  }

  /**
   * Process refund to learner
   */
  static async refundEscrow(
    escrowId: string,
    userId: string,
    stellarTxHash?: string
  ): Promise<EscrowRecord> {
    const escrow = await EscrowModel.findById(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    // Validate state
    if (escrow.status === 'released' || escrow.status === 'refunded') {
      throw new Error(`Cannot refund escrow in ${escrow.status} status`);
    }

    // Only mentor can initiate refund
    if (escrow.mentor_id !== userId) {
      throw new Error('Only the mentor can initiate a refund');
    }

    logger.info('Refunding escrow', { escrowId, userId });

    let txHashFromChain: string | null = null;
    if (SorobanEscrowService.isConfigured()) {
      const chainResult = await SorobanEscrowService.refund({
        escrowId,
        refundedBy: userId,
      });
      txHashFromChain = chainResult.txHash;
    }

    const updated = await EscrowModel.updateStatus(escrowId, 'refunded', {
      stellar_tx_hash: stellarTxHash || txHashFromChain || escrow.stellar_tx_hash,
      refunded_at: new Date(),
    });

    if (!updated) {
      throw new Error('Failed to update escrow status');
    }

    logger.info('Escrow refunded', { escrowId });
    return updated;
  }

  /**
   * Get escrow status
   */
  static async getEscrowStatus(escrowId: string): Promise<{
    id: string;
    status: EscrowStatus;
    amount: string;
    currency: string;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const escrow = await EscrowModel.findById(escrowId);
    
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    return {
      id: escrow.id,
      status: escrow.status,
      amount: escrow.amount,
      currency: escrow.currency,
      createdAt: escrow.created_at,
      updatedAt: escrow.updated_at,
    };
  }

  /**
   * List user escrows with optional filtering
   */
  static async listUserEscrows(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      status?: EscrowStatus;
      role?: 'learner' | 'mentor';
    } = {}
  ): Promise<{ escrows: EscrowRecord[]; total: number }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    let escrows = await EscrowModel.findByUserId(userId, limit, offset);

    // Apply filters
    if (options.status) {
      escrows = escrows.filter(e => e.status === options.status);
    }

    if (options.role === 'learner') {
      escrows = escrows.filter(e => e.learner_id === userId);
    } else if (options.role === 'mentor') {
      escrows = escrows.filter(e => e.mentor_id === userId);
    }

    return {
      escrows,
      total: escrows.length,
    };
  }

  /**
   * Validate escrow state transition
   */
  static validateStateTransition(currentStatus: EscrowStatus, newStatus: EscrowStatus): boolean {
    const validTransitions: Record<EscrowStatus, EscrowStatus[]> = {
      pending: ['funded', 'cancelled'],
      funded: ['released', 'disputed', 'refunded'],
      released: [],
      disputed: ['resolved', 'released', 'refunded'],
      resolved: ['released', 'refunded'],
      refunded: [],
      cancelled: [],
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }
}
