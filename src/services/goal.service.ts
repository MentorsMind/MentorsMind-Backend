import {
  GoalModel,
  Goal,
  GoalProgressLog,
  AtRiskGoal,
  GoalReminderCandidate,
  GoalReminderType,
  GoalMentorSuggestion,
} from '../models/goal.model';
import { createError } from '../middleware/errorHandler';
import { ErrorCode } from '../errors/error-codes';

import { LearnerService } from './learners.service';

export interface BookingSuggestion extends GoalMentorSuggestion {
  booking_url: string;
}

export class GoalService {
  static async createGoal(learnerId: string, data: Partial<Goal>): Promise<Goal> {
    const goal = await GoalModel.create({ ...data, learner_id: learnerId });
    await LearnerService.invalidateCache(learnerId);
    return goal;
  }

  static async listGoals(learnerId: string): Promise<Goal[]> {
    return await GoalModel.findByLearnerId(learnerId);
  }

  static async getGoal(id: string, learnerId: string): Promise<Goal> {
    const goal = await GoalModel.findById(id);
    if (!goal || goal.learner_id !== learnerId) {
      throw createError('Goal not found', 404);
    }
    return goal;
  }

  static async updateGoal(id: string, learnerId: string, data: Partial<Goal>): Promise<Goal> {
    const goal = await this.getGoal(id, learnerId);
    
    const updateData = { ...data };

    if (
      updateData.target_date !== undefined &&
      updateData.target_date !== goal.target_date
    ) {
      updateData.reminder_sent_7d = false;
      updateData.reminder_sent_3d = false;
      updateData.reminder_sent_1d = false;
      updateData.overdue_notified = false;
    }
    
    // Auto-complete logic
    if (updateData.progress !== undefined) {
      if (updateData.progress >= 100) {
        updateData.status = 'completed';
        updateData.progress = 100;
      } else if (updateData.progress < 100 && goal.status === 'completed') {
        updateData.status = 'active';
      }
    }

    const updated = await GoalModel.update(id, updateData);
    if (!updated) throw createError('Failed to update goal', 500);

    await LearnerService.invalidateCache(learnerId);
    return updated;
  }

  static async updateProgress(id: string, learnerId: string, progress: number, notes?: string): Promise<Goal> {
    if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 100) {
      throw createError(ErrorCode.BAD_REQUEST, 400, {
        field: 'progress',
        reason: 'Progress must be between 0 and 100',
      });
    }

    const goal = await this.getGoal(id, learnerId);
    
    // Log progress history (this also updates the goal.progress in DB)
    await GoalModel.logProgress(id, progress, notes);

    // Update status if needed (auto-complete logic)
    const updateData: Partial<Goal> = { progress };
    if (progress >= 100) {
      updateData.status = 'completed';
      updateData.progress = 100;
    } else if (goal.status === 'completed' && progress < 100) {
      updateData.status = 'active';
    }

    return await this.updateGoal(id, learnerId, updateData);
  }

  static async getProgressLogs(id: string, learnerId: string): Promise<GoalProgressLog[]> {
    await this.getGoal(id, learnerId);
    return await GoalModel.getProgressLogs(id);
  }

  static async deleteGoal(id: string, learnerId: string): Promise<void> {
    await this.getGoal(id, learnerId);
    await GoalModel.delete(id);
  }

  static async linkSession(id: string, learnerId: string, bookingId: string): Promise<void> {
    await this.getGoal(id, learnerId);
    // Note: In a real system, we'd also verify booking exists and belongs to learner
    await GoalModel.linkBooking(id, bookingId);
  }

  static async listAtRiskGoals(learnerId: string): Promise<AtRiskGoal[]> {
    return GoalModel.findAtRiskGoals(learnerId);
  }

  static async getGoalsDueForReminder(
    reminderType: GoalReminderType,
  ): Promise<GoalReminderCandidate[]> {
    return GoalModel.findGoalsForReminder(reminderType);
  }

  static async markReminderSent(
    goalId: string,
    reminderType: GoalReminderType,
  ): Promise<void> {
    await GoalModel.markReminderSent(goalId, reminderType);
  }

  static async getBookingSuggestion(
    goal: Pick<Goal, 'title' | 'description'>,
  ): Promise<BookingSuggestion | null> {
    const keywords = this.extractGoalKeywords(goal);
    const suggestion = await GoalModel.findBestMentorSuggestion(keywords);

    if (!suggestion) {
      return null;
    }

    return {
      ...suggestion,
      booking_url: `/api/v1/bookings`,
    };
  }

  static extractGoalKeywords(
    goal: Pick<Goal, 'title' | 'description'>,
  ): string[] {
    const stopWords = new Set([
      'about',
      'after',
      'before',
      'build',
      'complete',
      'finish',
      'goal',
      'have',
      'into',
      'learn',
      'learning',
      'make',
      'more',
      'over',
      'plan',
      'that',
      'this',
      'through',
      'want',
      'with',
      'your',
    ]);

    const raw = `${goal.title} ${goal.description || ''}`.toLowerCase();
    const tokens = raw
      .split(/[^a-z0-9+#.]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopWords.has(token));

    const fullTitle = goal.title.trim().toLowerCase();
    const ordered = fullTitle.length >= 3 ? [fullTitle, ...tokens] : tokens;

    return Array.from(new Set(ordered)).slice(0, 12);
  }
}
