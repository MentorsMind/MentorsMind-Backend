import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { LearnerService } from '../services/learners.service';
import { GoalService } from '../services/goal.service';

export class LearnerController {
  static async getProgress(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = req.user!.userId;
      const progress = await LearnerService.getProgressSummary(learnerId);
      res.json({ status: 'success', data: progress });
    } catch (err) { next(err); }
  }

  static async getGoalCompletionTimeline(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = req.user!.userId;
      const timeline = await LearnerService.getGoalCompletionTimeline(learnerId);
      res.json({ status: 'success', data: timeline });
    } catch (err) { next(err); }
  }

  static async getSessionTimeline(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = req.user!.userId;
      const timeline = await LearnerService.getSessionTimeline(learnerId);
      res.json({ status: 'success', data: timeline });
    } catch (err) { next(err); }
  }

  static async getAtRiskGoals(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = req.user!.userId;
      const goals = await GoalService.listAtRiskGoals(learnerId);
      res.json({ status: 'success', data: goals });
    } catch (err) { next(err); }
  }
}
