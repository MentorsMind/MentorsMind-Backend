import { DisputeService, EscrowService, NotificationService } from '../disputes.service';
import { DisputeStateMachine } from '../dispute-state-machine.service';
import { DisputeModel, DisputeRecord } from '../../models/dispute.model';

jest.mock('../../models/dispute.model', () => ({
  DisputeModel: {
    create: jest.fn(),
    findById: jest.fn(),
    updateStatus: jest.fn(),
    findUnresolvedOlderThanDays: jest.fn(),
    addEvidence: jest.fn(),
  }
}));

jest.mock('../../models/audit-log.model', () => ({
  AuditLogModel: { create: jest.fn() }
}));

describe('Dispute Resolution Workflow', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('DisputeStateMachine', () => {
    it('should allow open -> under_review transition', () => {
      expect(() => DisputeStateMachine.assertTransition('open', 'under_review')).not.toThrow();
    });

    it('should allow under_review -> resolved transition', () => {
      expect(() => DisputeStateMachine.assertTransition('under_review', 'resolved')).not.toThrow();
    });

    it('should throw on invalid resolved -> open transition', () => {
      expect(() => DisputeStateMachine.assertTransition('resolved', 'open')).toThrow('Invalid state transition');
    });
  });

  describe('DisputesService', () => {
    
    it('should escalate old disputes and notify users', async () => {
      const oldDispute: DisputeRecord = {
        id: 'disp-1', transaction_id: 'tx-123', reporter_id: 'user-1', reason: 'Test',
        status: 'open', resolution_notes: null, created_at: new Date(Date.now() - 8 * 86400000), 
        updated_at: new Date()
      };
      
      (DisputeModel.findUnresolvedOlderThanDays as jest.Mock).mockResolvedValue([oldDispute]);
      (DisputeModel.updateStatus as jest.Mock).mockResolvedValue({ ...oldDispute, status: 'under_review' });

      const notifySpy = jest.spyOn(NotificationService, 'notifyDisputeUpdate').mockResolvedValue();

      const count = await DisputeService.escalateOldDisputes();

      expect(count).toBe(1);
      expect(DisputeModel.updateStatus).toHaveBeenCalledWith('disp-1', 'under_review', expect.any(String));
      expect(notifySpy).toHaveBeenCalledWith('user-1', 'disp-1', expect.stringContaining('auto-escalated'));
    });

    it('should upload evidence and record audit log', async () => {
      (DisputeModel.addEvidence as jest.Mock).mockResolvedValue({ id: 'ev-1' });

      await DisputeService.uploadEvidence('disp-1', 'user-1', 'Got cheated.', 'http://example.com/img.png');
      expect(DisputeModel.addEvidence).toHaveBeenCalledWith({
        dispute_id: 'disp-1', submitter_id: 'user-1', text_content: 'Got cheated.', file_url: 'http://example.com/img.png'
      });
    });

    it('should resolve dispute and trigger escrow actions', async () => {
      const dispute: DisputeRecord = {
        id: 'disp-1', transaction_id: 'tx-123', reporter_id: 'user-1', reason: 'Test',
        status: 'under_review', resolution_notes: null, created_at: new Date(), updated_at: new Date()
      };

      (DisputeModel.findById as jest.Mock).mockResolvedValue(dispute);
      const escrowSpy = jest.spyOn(EscrowService, 'processResolution').mockResolvedValue();

      await DisputeService.resolveDispute('disp-1', 'admin-1', 'full_refund', 'User is right');

      expect(escrowSpy).toHaveBeenCalledWith('tx-123', 'refund');
      expect(DisputeModel.updateStatus).toHaveBeenCalledWith('disp-1', 'resolved', 'User is right');
    });
  });
});
