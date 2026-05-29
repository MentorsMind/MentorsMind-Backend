import { Request, Response, NextFunction } from 'express';
import { GoalService } from '../services/goal.service';
import { logger } from '../utils/logger';

export class GoalController {
  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const goal = await GoalService.createGoal(learnerId, req.body);
      res.status(201).json({ status: 'success', data: goal });
    } catch (err) { next(err); }
  }

  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const goals = await GoalService.listGoals(learnerId);
      res.json({ status: 'success', data: goals });
    } catch (err) { next(err); }
  }

  static async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const goal = await GoalService.getGoal(req.params.id, learnerId);
      res.json({ status: 'success', data: goal });
    } catch (err) { next(err); }
  }

  static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const goal = await GoalService.updateGoal(req.params.id, learnerId, req.body);
      res.json({ status: 'success', data: goal });
    } catch (err) { next(err); }
  }

  static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      await GoalService.deleteGoal(req.params.id, learnerId);
      res.status(204).send();
    } catch (err) { next(err); }
  }

  static async updateProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const { progress, notes } = req.body;
      if (typeof progress !== 'number' || progress < 0 || progress > 100) {
        throw new Error('Invalid progress value (0-100)');
      }
      const goal = await GoalService.updateProgress(req.params.id, learnerId, progress, notes);
      res.json({ status: 'success', data: goal });
    } catch (err) { next(err); }
  }

  static async getProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const logs = await GoalService.getProgressLogs(req.params.id, learnerId);
      res.json({ status: 'success', data: logs });
    } catch (err) { next(err); }
  }

  static async linkSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const learnerId = (req as any).user.userId;
      const { booking_id } = req.body;
      if (!booking_id) throw new Error('booking_id is required');
      await GoalService.linkSession(req.params.id, learnerId, booking_id);
      res.json({ status: 'success', message: 'Session linked to goal' });
    } catch (err) { next(err); }
  }
}
