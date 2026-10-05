import { logger } from "../utils/logger.utils";
import { TimeSlot } from "./smart-calendar.service";

export interface SchedulingPreferences {
  userId: string;
  preferredDays: string[];
  preferredHours: number[];
  avoidBackToBack: boolean;
  bufferMinutes: number;
}

export interface OptimalSlot extends TimeSlot {
  participants: string[];
  confidenceScore: number;
  reason: string;
}

export class AISchedulerService {
  private preferences: Map<string, SchedulingPreferences> = new Map();
  private schedulingHistory: Map<string, Date[]> = new Map();

  async findOptimalTimeSlots(
    participants: string[],
    duration: number,
    availableSlots: TimeSlot[][],
    constraints?: any,
  ): Promise<OptimalSlot[]> {
    logger.info({ participants, duration }, "Finding optimal time slots");

    const commonSlots = this.findCommonAvailability(availableSlots);
    const scoredSlots = await this.scoreSlots(
      commonSlots,
      participants,
      constraints,
    );

    return scoredSlots
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, 5);
  }

  async learnPreferences(
    userId: string,
    scheduledTime: Date,
    accepted: boolean,
  ): Promise<void> {
    if (accepted) {
      const history = this.schedulingHistory.get(userId) || [];
      history.push(scheduledTime);
      this.schedulingHistory.set(userId, history);

      await this.updatePreferences(userId, scheduledTime);
    }
  }

  async resolveConflict(
    existingEvent: any,
    newEvent: any,
  ): Promise<{ action: string; reason: string }> {
    logger.info("Resolving scheduling conflict");

    const priority = this.calculatePriority(newEvent);
    if (priority > this.calculatePriority(existingEvent)) {
      return {
        action: "reschedule_existing",
        reason: "New event has higher priority",
      };
    }

    return {
      action: "suggest_alternative",
      reason: "Existing event takes precedence",
    };
  }

  private findCommonAvailability(availableSlots: TimeSlot[][]): TimeSlot[] {
    if (availableSlots.length === 0) return [];

    const common: TimeSlot[] = [];
    const reference = availableSlots[0];

    for (const slot of reference) {
      const isCommon = availableSlots.every((userSlots) =>
        userSlots.some(
          (s) =>
            s.start.getTime() === slot.start.getTime() &&
            s.end.getTime() === slot.end.getTime(),
        ),
      );

      if (isCommon) {
        common.push(slot);
      }
    }

    return common;
  }

  private async scoreSlots(
    slots: TimeSlot[],
    participants: string[],
    constraints?: any,
  ): Promise<OptimalSlot[]> {
    const scored: OptimalSlot[] = [];

    for (const slot of slots) {
      let score = slot.score;
      let reason = "Available time slot";

      // Adjust score based on time of day
      const hour = slot.start.getHours();
      if (hour >= 9 && hour <= 17) {
        score += 0.3;
        reason = "Within business hours";
      }

      // Check participant preferences
      for (const participantId of participants) {
        const pref = this.preferences.get(participantId);
        if (pref) {
          if (pref.preferredHours.includes(hour)) {
            score += 0.2;
          }
        }
      }

      scored.push({
        ...slot,
        participants,
        confidenceScore: Math.min(score, 1),
        reason,
      });
    }

    return scored;
  }

  private async updatePreferences(
    userId: string,
    scheduledTime: Date,
  ): Promise<void> {
    const hour = scheduledTime.getHours();
    const day = scheduledTime.toLocaleDateString("en-US", { weekday: "long" });

    const current = this.preferences.get(userId) || {
      userId,
      preferredDays: [],
      preferredHours: [],
      avoidBackToBack: false,
      bufferMinutes: 0,
    };

    if (!current.preferredHours.includes(hour)) {
      current.preferredHours.push(hour);
    }
    if (!current.preferredDays.includes(day)) {
      current.preferredDays.push(day);
    }

    this.preferences.set(userId, current);
  }

  private calculatePriority(event: any): number {
    return event.priority || 0.5;
  }
}

export const aiSchedulerService = new AISchedulerService();

