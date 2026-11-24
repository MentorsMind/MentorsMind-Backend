import { DisputeService } from '../disputes.service';
import pool from '../../config/database';
import { DisputeModel } from '../../models/dispute.model';
import { AuditLogModel } from '../../models/audit-log.model';
import { SorobanEscrowService } from '../sorobanEscrow.service';
import { NotificationService } from '../notification.service';
import { DatabaseService } from '../database.service';
import { DisputeStateMachine } from '../dispute-state-machine.service';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  }
}));
jest.mock('../../models/dispute.model');
jest.mock('../../models/audit-log.model');
jest.mock('../sorobanEscrow.service');
jest.mock('../notification.service');
jest.mock('../database.service');
jest.mock('../dispute-state-machine.service');

describe('DisputeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (DatabaseService.withTransaction as jest.Mock).mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (typeof sql === 'string' && sql.includes('SELECT')) {
            return { rows: [] };
          }
          return { rows: [{ id: 'dispute-1', status: 'open' }] };
        }),
      };
      return cb(client);
    });
  });

  describe('openDispute', () => {
    it('opens a dispute successfully', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ mentor_id: 'mentor-1', mentee_id: 'mentee-1' }]
      });
      (DisputeModel.create as jest.Mock).mockResolvedValue({ id: 'dispute-1' });

      const result = await DisputeService.openDispute('session-1', 'mentee-1', 'quality', 'test reason');
      expect(result.id).toBe('dispute-1');
      expect(NotificationService.sendNotification).toHaveBeenCalledTimes(2);
      expect(AuditLogModel.create).toHaveBeenCalled();
    });

    it('throws 409 conflict if an open dispute already exists for the session', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ mentor_id: 'mentor-1', mentee_id: 'mentee-1', escrow_id: 'escrow-1' }]
      });
      (DisputeModel.findOpenBySessionId as jest.Mock).mockResolvedValue({
        id: 'existing-dispute-1',
        session_id: 'session-1',
        status: 'open',
      });

      await expect(
        DisputeService.openDispute('session-1', 'mentee-1', 'quality', 'duplicate dispute reason')
      ).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCode.DISPUTE_ALREADY_EXISTS,
      });
    });

    it('throws if booking not found', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(DisputeService.openDispute('session-1', 'mentee-1', 'quality', 'test reason'))
        .rejects.toThrow('Session not found');
    });
  });

  describe('uploadEvidence', () => {
    it('uploads evidence successfully', async () => {
      (DisputeModel.addEvidence as jest.Mock).mockResolvedValue({ id: 'evidence-1' });
      const result = await DisputeService.uploadEvidence('dispute-1', 'user-1', 'text');
      expect(result.id).toBe('evidence-1');
      expect(AuditLogModel.create).toHaveBeenCalled();
    });
  });

  describe('escalateOldDisputes', () => {
    it('escalates old disputes', async () => {
      (DisputeModel.findUnresolvedOlderThanDays as jest.Mock).mockResolvedValue([
        { id: 'dispute-1', status: 'opened', session_id: 'session-1', filed_by_id: 'user-1' }
      ]);
      (DisputeStateMachine.canTransition as jest.Mock).mockReturnValue(true);
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ mentor_id: 'mentor-1', mentee_id: 'user-1' }]
      });

      const count = await DisputeService.escalateOldDisputes();
      expect(count).toBe(1);
      expect(DisputeModel.updateStatus).toHaveBeenCalledWith('dispute-1', 'investigating', expect.any(String));
      expect(NotificationService.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('skips disputes already in investigating status', async () => {
      (DisputeModel.findUnresolvedOlderThanDays as jest.Mock).mockResolvedValue([
        { id: 'dispute-already-investigating', status: 'investigating', session_id: 'session-1', filed_by_id: 'user-1' }
      ]);
      (DisputeStateMachine.canTransition as jest.Mock).mockReturnValue(true);

      const count = await DisputeService.escalateOldDisputes();
      expect(count).toBe(0);
      expect(DisputeModel.updateStatus).not.toHaveBeenCalled();
    });

    it('handles individual dispute failure gracefully without failing entire batch', async () => {
      (DisputeModel.findUnresolvedOlderThanDays as jest.Mock).mockResolvedValue([
        { id: 'dispute-fail', status: 'open', session_id: 'session-1', filed_by_id: 'user-1' },
        { id: 'dispute-success', status: 'open', session_id: 'session-2', filed_by_id: 'user-2' },
      ]);
      (DisputeStateMachine.canTransition as jest.Mock).mockReturnValue(true);
      (DisputeModel.updateStatus as jest.Mock)
        .mockRejectedValueOnce(new Error('DB failure'))
        .mockResolvedValueOnce({ id: 'dispute-success', status: 'investigating' });
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ mentor_id: 'mentor-2', mentee_id: 'user-2' }]
      });

      const count = await DisputeService.escalateOldDisputes();
      expect(count).toBe(1);
      expect(DisputeModel.updateStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('mediateDispute', () => {
    it('moves dispute to mediation', async () => {
      (DisputeModel.findById as jest.Mock).mockResolvedValue({ id: 'dispute-1', status: 'investigating' });
      (DisputeModel.updateStatus as jest.Mock).mockResolvedValue({ id: 'dispute-1', status: 'mediation' });
      (DisputeStateMachine.assertTransition as jest.Mock).mockImplementation(() => {});

      const result = await DisputeService.mediateDispute('dispute-1', 'admin-1', 'notes');
      expect(result.status).toBe('mediation');
      expect(AuditLogModel.create).toHaveBeenCalled();
    });
  });

  describe('resolveDispute', () => {
    it('resolves dispute and triggers escrow', async () => {
      (DisputeModel.findById as jest.Mock).mockResolvedValue({ id: 'dispute-1', status: 'investigating', session_id: 'session-1', filed_by_id: 'mentee-1' });
      (DisputeStateMachine.assertTransition as jest.Mock).mockImplementation(() => {});
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ escrow_id: 'escrow-1', mentor_id: 'mentor-1', mentee_id: 'mentee-1' }]
      });
      (DatabaseService.withTransaction as jest.Mock).mockImplementation(async (cb) => {
        const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'dispute-1', status: 'resolved' }] }) };
        return cb(client);
      });

      const result = await DisputeService.resolveDispute('dispute-1', 'admin-1', 50, 'resolved notes');
      
      expect(result.status).toBe('resolved');
      expect(SorobanEscrowService.resolveDispute).toHaveBeenCalled();
      expect(AuditLogModel.create).toHaveBeenCalled();
      expect(NotificationService.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('throws if no escrow ID is found', async () => {
      (DisputeModel.findById as jest.Mock).mockResolvedValue({ id: 'dispute-1', session_id: 'session-1' });
      (pool.query as jest.Mock).mockResolvedValue({ rows: [{ escrow_id: null }] });

      await expect(DisputeService.resolveDispute('dispute-1', 'admin-1', 50, 'notes'))
        .rejects.toThrow('No escrow_id found');
    });
  });
});
