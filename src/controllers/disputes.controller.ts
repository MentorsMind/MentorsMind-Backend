import { Request, Response } from 'express';
import { DisputeService } from '../services/disputes.service';
import { DisputeModel } from '../models/dispute.model';

export class DisputesController {
  
  static async openDispute(req: Request, res: Response): Promise<void> {
    try {
      const { transaction_id, reason } = req.body;
      const reporter_id = (req as any).user?.id || 'temp_user_id'; // Placeholder for auth

      if (!transaction_id || !reason) {
        res.status(400).json({ error: 'Transaction ID and reason are required' });
        return;
      }

      const dispute = await DisputeService.openDispute(transaction_id, reporter_id, reason);
      res.status(201).json({ data: dispute });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getDispute(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const dispute = await DisputeModel.findById(id);
      
      if (!dispute) {
        res.status(404).json({ error: 'Dispute not found' });
        return;
      }
      
      const evidence = await DisputeModel.getEvidence(id);
      res.status(200).json({ data: { ...dispute, evidence } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async uploadEvidence(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { text_content, file_url } = req.body;
      const limitId = (req as any).user?.id || 'temp_user_id';

      const evidence = await DisputeService.uploadEvidence(id, limitId, text_content, file_url);
      res.status(201).json({ data: evidence });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async resolveDispute(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { resolution_type, notes } = req.body;
      const adminId = (req as any).user?.id || 'temp_admin_id';

      if (!['full_refund', 'partial_refund', 'release'].includes(resolution_type)) {
        res.status(400).json({ error: 'Invalid resolution type' });
        return;
      }

      const dispute = await DisputeService.resolveDispute(id, adminId, resolution_type, notes);
      res.status(200).json({ data: dispute });
    } catch (error: any) {
      if (error.message.includes('Invalid state transition') || error.message.includes('not found')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }

  static async listDisputes(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const isAdmin = (req as any).user?.role === 'admin';
      
      let disputes;
      if (isAdmin) {
        disputes = await DisputeModel.findAll();
      } else {
        disputes = await DisputeModel.findByUserId(userId || 'temp_user_id');
      }

      res.status(200).json({ data: disputes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
