// @ts-nocheck
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { LearnerService } from '../services/learners.service';

export const getLearnerProgress = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const learnerId = req.user!.userId;
    const progress = await LearnerService.getProgress(learnerId);
    return res.status(200).json({ success: true, data: progress });
  } catch {
    return res.status(500).json({ success: false, message: 'Error fetching progress' });
  }
};

export const updateGoals = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const learnerId = req.user!.userId;
    const goal = await LearnerService.updateGoals(learnerId, req.body);
    return res.status(201).json({ success: true, data: goal });
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid goal data' });
  }
};

export const getStats = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await LearnerService.getStats(req.user!.userId);
    return res.status(200).json({ success: true, data: stats });
  } catch {
    return res.status(500).json({ success: false, message: 'Error fetching stats' });
  }
};
