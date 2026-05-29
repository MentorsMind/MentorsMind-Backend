// @ts-nocheck
import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { EscrowApiService } from '../services/escrow-api.service';
import { ResponseUtil } from '../utils/response.utils';
import { 
  CreateEscrowInput, 
  DisputeEscrowInput, 
  ResolveDisputeInput,
  ListEscrowsQuery 
} from '../validators/schemas/escrow.schemas';
import { AuditLogService, extractIpAddress } from '../services/auditLog.service';

export const EscrowController = {
  /** POST /api/v1/escrow - Create escrow contract */
  async createEscrow(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { mentorId, amount, currency = 'XLM', description } = req.body as CreateEscrowInput;
    const learnerId = req.user!.id;

    try {
      const escrow = await EscrowApiService.createEscrow({
        learnerId,
        mentorId,
        amount,
        currency,
        description,
      });

      // Log escrow creation
      await AuditLogService.log({
        userId: learnerId,
        action: 'ESCROW_CREATED',
        resourceType: 'escrow',
        resourceId: escrow.id,
        newValue: { amount, currency, mentorId, status: escrow.status },
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });

      ResponseUtil.created(res, escrow, 'Escrow contract created successfully');
    } catch (error) {
      ResponseUtil.error(res, error instanceof Error ? error.message : 'Failed to create escrow');
    }
  },

  /** GET /api/v1/escrow/:id - Get escrow details */
  async getEscrow(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const userId = req.user!.id;

    try {
      const escrow = await EscrowApiService.getEscrowById(id);

      if (!escrow) {
        ResponseUtil.notFound(res, 'Escrow not found');
        return;
      }

      // Check authorization - only learner, mentor, or admin can view
      if (escrow.learner_id !== userId && escrow.mentor_id !== userId && req.user!.role !== 'admin') {
        ResponseUtil.forbidden(res, 'You do not have permission to view this escrow');
        return;
      }

      ResponseUtil.success(res, escrow, 'Escrow retrieved successfully');
    } catch (error) {
      ResponseUtil.error(res, error instanceof Error ? error.message : 'Failed to retrieve escrow');
    }
  },

  /** POST /api/v1/escrow/:id/release - Release funds to mentor */
  async releaseEscrow(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const userId = req.user!.id;
    const { stellarTxHash } = req.body || {};

    try {
      const oldEscrow = await EscrowApiService.getEscrowById(id);
      const escrow = await EscrowApiService.releaseEscrow(id, userId, stellarTxHash);
      
      // Log escrow release
      await AuditLogService.log({
        userId,
        action: 'ESCROW_RELEASED',
        resourceType: 'escrow',
        resourceId: id,
        oldValue: { status: oldEscrow?.status },
        newValue: { status: escrow.status, stellarTxHash },
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      
      ResponseUtil.success(res, escrow, 'Funds released to mentor successfully');
    } catch (error) {
      ResponseUtil.error(res, error instanceof Error ? error.message : 'Failed to release funds');
    }
  },

  /** POST /api/v1/escrow/:id/dispute - Open a dispute */
  async openDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const userId = req.user!.id;
    const { reason } = req.body as DisputeEscrowInput;

    try {
      const result = await EscrowApiService.openDispute(id, userId, reason);
      
      // Log dispute opening
      await AuditLogService.log({
        userId,
        action: 'ESCROW_DISPUTED',
        resourceType: 'escrow',
        resourceId: id,
        newValue: { status: 'disputed', disputeId: result.disputeId, reason },
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      
      ResponseUtil.success(res, result, 'Dispute opened successfully');
    } catch (error) {
      ResponseUtil.error(res, error instanceof Error ? error.message : 'Failed to open dispute');
    }
  },

  /** POST /api/v1/escrow/:id/resolve - Resolve dispute (admin only) */
  async resolveDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const { resolution, notes, stellarTxHash } = req.body as ResolveDisputeInput;

    try {
      const oldEscrow = await EscrowApiService.getEscrowById(id);
      const escrow = await EscrowApiService.resolveDispute(id, resolution, notes, stellarTxHash);
      
      // Log dispute resolution (admin action)
      await AuditLogService.log({
        userId: req.user!.id,
        action: 'DISPUTE_RESOLVED',
        resourceType: 'escrow',
        resourceId: id,
        oldValue: { status: oldEscrow?.status },
        newValue: { status: escrow.status, resolution, notes },
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
        metadata: { adminAction: true },
      });
      
      ResponseUtil.success(res, escrow, 'Dispute resolved successfully');
    } catch (error) {
      ResponseUtil.error(res, error instanceof Error ? error.message : 'Failed to resolve dispute');
    }
  },

  /** GET /api/v1/escrow/:id/status - Check escrow status */
  async getEscrowStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const userId = req.user!.id;

    try {
      const escrow = await EscrowApiService.getEscrowById(id);

      if (!escrow) {
        ResponseUtil.notFound(res, 'Escrow not found');
        return;
      }

      // Check authorization
      if (escrow.learner_id !== userId && escrow.mentor_id !== userId && req.user!.role !== 'admin') {
        ResponseUtil.forbidden(res, 'You do not have permission to view this escrow status');
        return;
      }

      const status = await EscrowApiService.getEscrowStatus(id);
      ResponseUtil.success(res, status, 'Escrow status retrieved successfully');
    } catch (error) {
      ResponseUtil.error(res, error instanceof Error ? error.message : 'Failed to retrieve escrow status');
    }
  },

  /** POST /api/v1/escrow/:id/refund - Process refund to learner */
  async refundEscrow(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const userId = req.user!.id;
    const { stellarTxHash } = req.body || {};

    try {
      const oldEscrow = await EscrowApiService.getEscrowById(id);
      const escrow = await EscrowApiService.refundEscrow(id, userId, stellarTxHash);
      
      // Log escrow refund
      await AuditLogService.log({
        userId,
        action: 'ESCROW_REFUNDED',
        resourceType: 'escrow',
        resourceId: id,
        oldValue: { status: oldEscrow?.status },
        newValue: { status: escrow.status, stellarTxHash },
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      
      ResponseUtil.success(res, escrow, 'Refund processed successfully');
    } catch (error) {
      ResponseUtil.error(res, error instanceof Error ? error.message : 'Failed to process refund');
    }
  },

  /** GET /api/v1/escrow - List user escrows */
  async listEscrows(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { page, limit, status, role } = req.query as unknown as ListEscrowsQuery;

    try {
      const result = await EscrowApiService.listUserEscrows(userId, {
        page,
        limit,
        status,
        role,
      });

      const totalPages = Math.ceil(result.total / (limit || 20));

      ResponseUtil.success(
        res,
        result.escrows,
        'Escrows retrieved successfully',
        200,
        {
          page: page || 1,
          limit: limit || 20,
          total: result.total,
          totalPages,
          hasNext: (page || 1) < totalPages,
          hasPrev: (page || 1) > 1,
        }
      );
    } catch (error) {
      ResponseUtil.error(res, error instanceof Error ? error.message : 'Failed to retrieve escrows');
    }
  },
};
