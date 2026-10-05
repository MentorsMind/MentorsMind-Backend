import { Logger } from "../utils/logger.utils";

export interface TimezoneInfo {
  timezone: string;
  offset: number;
  abbreviation: string;
  isDST: boolean;
}

export interface ConvertedTime {
  original: Date;
  converted: Date;
  sourceTimezone: string;
  targetTimezone: string;
}

export class TimezoneIntelligenceService {
  private timezoneCache: Map<string, TimezoneInfo> = new Map();

  async detectTimezone(userId: string): Promise<string> {
    logger.debug({ userId }, "Detecting user timezone");
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  async convertTime(
    time: Date,
    from: string,
    to: string,
  ): Promise<ConvertedTime> {
    const sourceDate = new Date(
      time.toLocaleString("en-US", { timeZone: from }),
    );
    const targetDate = new Date(time.toLocaleString("en-US", { timeZone: to }));

    return {
      original: sourceDate,
      converted: targetDate,
      sourceTimezone: from,
      targetTimezone: to,
    };
  }

  async findCommonTimeZone(timezones: string[]): Promise<string> {
    // Find the most central timezone
    const offsets = timezones.map((tz) => this.getOffset(tz));
    const avgOffset = offsets.reduce((a, b) => a + b, 0) / offsets.length;

    const closest = timezones.reduce((prev, curr) => {
      const prevDiff = Math.abs(this.getOffset(prev) - avgOffset);
      const currDiff = Math.abs(this.getOffset(curr) - avgOffset);
      return currDiff < prevDiff ? curr : prev;
    });

    return closest;
  }

  async getSuggestedMeetingTimes(
    participantTimezones: string[],
    duration: number,
  ): Promise<Array<{ time: Date; score: number }>> {
    const suggestions: Array<{ time: Date; score: number }> = [];
    const now = new Date();

    for (let i = 0; i < 7; i++) {
      const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);

      for (let hour = 8; hour <= 18; hour++) {
        date.setHours(hour, 0, 0, 0);
        const score = this.scoreTimeAcrossTimezones(date, participantTimezones);

        if (score > 0.5) {
          suggestions.push({ time: new Date(date), score });
        }
      }
    }

    return suggestions.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  async handleDSTTransition(timezone: string, date: Date): Promise<boolean> {
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);

    const janOffset = this.getOffsetForDate(timezone, jan);
    const julOffset = this.getOffsetForDate(timezone, jul);

    return janOffset !== julOffset;
  }

  private getOffset(timezone: string): number {
    const date = new Date();
    const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(
      date.toLocaleString("en-US", { timeZone: timezone }),
    );

    return (tzDate.getTime() - utcDate.getTime()) / (60 * 60 * 1000);
  }

  private getOffsetForDate(timezone: string, date: Date): number {
    const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(
      date.toLocaleString("en-US", { timeZone: timezone }),
    );

    return (tzDate.getTime() - utcDate.getTime()) / (60 * 60 * 1000);
  }

  private scoreTimeAcrossTimezones(time: Date, timezones: string[]): number {
    let totalScore = 0;

    for (const tz of timezones) {
      const localTime = new Date(
        time.toLocaleString("en-US", { timeZone: tz }),
      );
      const hour = localTime.getHours();

      // Score based on business hours (9 AM - 5 PM)
      if (hour >= 9 && hour <= 17) {
        totalScore += 1;
      } else if (hour >= 8 && hour <= 18) {
        totalScore += 0.5;
      }
    }

    return totalScore / timezones.length;
  }
}

export const timezoneIntelligenceService = new TimezoneIntelligenceService();
