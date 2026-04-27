import pool from "../config/database";
import { CacheService } from "./cache.service";

export interface ProgressSummary {
  total_sessions: number;
  total_hours: number;
  completed_goals: number;
  current_streak: number;
  longest_streak: number;
  goal_completion_timeline: TimelineEntry[];
  session_timeline: TimelineEntry[];
}

export interface TimelineEntry {
  month: string;
  count: number;
}

export class LearnerService {
  private static CACHE_TTL = 300; // 5 minutes

  static async getProgressSummary(learnerId: string): Promise<ProgressSummary> {
    const cacheKey = `learner:progress:${learnerId}`;

    return await CacheService.wrap(cacheKey, this.CACHE_TTL, async () => {
      // 1. Basic stats from bookings
      const statsResult = await pool.query(
        `SELECT 
          COUNT(*) as total_sessions,
          COALESCE(SUM(duration_minutes) / 60.0, 0) as total_hours
         FROM bookings 
         WHERE mentee_id = $1 AND status = 'completed'`,
        [learnerId],
      );

      // 2. Completed goals
      const goalsResult = await pool.query(
        `SELECT COUNT(*) as completed_goals FROM learner_goals 
         WHERE learner_id = $1 AND status = 'completed'`,
        [learnerId],
      );

      // 3. Streak calculation
      const sessionsResult = await pool.query(
        `SELECT DISTINCT DATE(scheduled_at AT TIME ZONE 'UTC') as session_date 
         FROM bookings 
         WHERE mentee_id = $1 AND status = 'completed'
         ORDER BY session_date DESC`,
        [learnerId],
      );

      const dates = sessionsResult.rows.map((r) => new Date(r.session_date));
      const { current, longest } = this.calculateStreaks(dates);

      const [goalTimeline, sessionTimeline] = await Promise.all([
        this.getGoalCompletionTimeline(learnerId),
        this.getSessionTimeline(learnerId),
      ]);

      return {
        total_sessions: parseInt(statsResult.rows[0].total_sessions || "0", 10),
        total_hours: parseFloat(statsResult.rows[0].total_hours || "0"),
        completed_goals: parseInt(
          goalsResult.rows[0].completed_goals || "0",
          10,
        ),
        current_streak: current,
        longest_streak: longest,
        goal_completion_timeline: goalTimeline,
        session_timeline: sessionTimeline,
      };
    });
  }

  static async getGoalCompletionTimeline(
    learnerId: string,
  ): Promise<TimelineEntry[]> {
    const result = await pool.query(
      `SELECT 
        TO_CHAR(updated_at, 'YYYY-MM') as month,
        COUNT(*) as count
       FROM learner_goals
       WHERE learner_id = $1 AND status = 'completed'
         AND updated_at >= NOW() - INTERVAL '12 months'
       GROUP BY month
       ORDER BY month ASC`,
      [learnerId],
    );
    return result.rows;
  }

  static async getSessionTimeline(learnerId: string): Promise<TimelineEntry[]> {
    const result = await pool.query(
      `SELECT 
        TO_CHAR(scheduled_at, 'YYYY-MM') as month,
        COUNT(*) as count
       FROM bookings
       WHERE mentee_id = $1 AND status = 'completed'
         AND scheduled_at >= NOW() - INTERVAL '12 months'
       GROUP BY month
       ORDER BY month ASC`,
      [learnerId],
    );
    return result.rows;
  }

  static async invalidateCache(learnerId: string): Promise<void> {
    await CacheService.del(`learner:progress:${learnerId}`);
  }

  private static calculateStreaks(dates: Date[]): {
    current: number;
    longest: number;
  } {
    if (dates.length === 0) return { current: 0, longest: 0 };

    let current = 0;
    let longest = 0;
    let tempStreak = 1;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Check if the latest session was today or yesterday to start current streak
    const latestSession = new Date(dates[0]);
    latestSession.setHours(0, 0, 0, 0);

    if (
      latestSession.getTime() === today.getTime() ||
      latestSession.getTime() === yesterday.getTime()
    ) {
      current = 1;
      for (let i = 0; i < dates.length - 1; i++) {
        const d1 = new Date(dates[i]);
        d1.setHours(0, 0, 0, 0);
        const d2 = new Date(dates[i + 1]);
        d2.setHours(0, 0, 0, 0);

        const diff = (d1.getTime() - d2.getTime()) / (1000 * 3600 * 24);
        if (diff === 1) {
          current++;
        } else {
          break;
        }
      }
    }

    // Calculate longest streak
    tempStreak = 1;
    longest = 1;
    for (let i = 0; i < dates.length - 1; i++) {
      const d1 = new Date(dates[i]);
      d1.setHours(0, 0, 0, 0);
      const d2 = new Date(dates[i + 1]);
      d2.setHours(0, 0, 0, 0);

      const diff = (d1.getTime() - d2.getTime()) / (1000 * 3600 * 24);
      if (diff === 1) {
        tempStreak++;
      } else {
        longest = Math.max(longest, tempStreak);
        tempStreak = 1;
      }
    }
    longest = Math.max(longest, tempStreak);

    return { current, longest };
  }
}
