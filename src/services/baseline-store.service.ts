/**
 * Baseline Store — Redis-backed rolling per-user event-count baselines.
 *
 * Backs MlSecurityService.scoreDeviation() with a real historical baseline
 * instead of requiring every caller to gather samples from scratch on the
 * hot path. One Redis sorted set per user holds a 30-day rolling window of
 * daily event counts:
 *
 *   key:    baseline:daily-count:<userId>
 *   score:  UTC day number (days since epoch) — used to trim the window
 *   member: `${dayNumber}:${count}` — unique per day, so a re-write for the
 *           same day replaces rather than duplicates (ZADD overwrites by
 *           score+member pair only if member is identical; we therefore
 *           remove the old entry for that day before adding the new one)
 *
 * Reads (`getSamples`) are a single ZRANGEBYSCORE — O(log N + M) — so they
 * are cheap enough for the hot path (zero-trust middleware / login-event
 * analysis). Writes happen only from the nightly refresh job
 * (src/jobs/baselineRefresh.job.ts), never from a request path.
 *
 * Part of issue #1001 "Replace Heuristic ML Security Scoring with Baseline
 * Learning".
 */

import { redis } from "../config/redis";
import { logger } from "../utils/logger";

const BASELINE_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

function baselineKey(userId: string): string {
  return `baseline:daily-count:${userId}`;
}

export const BaselineStore = {
  /**
   * Upsert the event count for a single UTC day for a user, then trim the
   * sorted set down to the rolling 30-day window. Idempotent — calling this
   * again for the same `date` overwrites the previous count for that day.
   */
  async recordDailyCount(userId: string, date: Date, count: number): Promise<void> {
    const key = baselineKey(userId);
    const day = dayNumber(date);
    const cutoff = day - BASELINE_WINDOW_DAYS;

    try {
      // Remove any existing entry for this day (member is `${day}:<oldCount>`,
      // which we don't know ahead of time) before writing the new one.
      const existing = await redis.zrangebyscore(key, day, day);
      const pipeline = redis.pipeline();
      for (const member of existing) {
        pipeline.zrem(key, member);
      }
      pipeline.zadd(key, day, `${day}:${count}`);
      pipeline.zremrangebyscore(key, "-inf", cutoff);
      pipeline.expire(key, BASELINE_WINDOW_DAYS * 24 * 60 * 60);
      await pipeline.exec();
    } catch (error) {
      logger.error("BaselineStore: failed to record daily count", {
        userId,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  },

  /**
   * Load the rolling 30-day baseline samples (one number per recorded day)
   * for a user. Returns an empty array if the user has no baseline yet
   * (e.g. never refreshed, or refresh job hasn't run) — callers should treat
   * that the same as "not enough data" (mirrors scoreDeviation's own
   * <2-sample handling).
   */
  async getSamples(userId: string): Promise<number[]> {
    const key = baselineKey(userId);
    const cutoff = dayNumber(new Date()) - BASELINE_WINDOW_DAYS;

    try {
      const members = await redis.zrangebyscore(key, cutoff, "+inf");
      return members.map((member) => {
        const count = member.split(":")[1];
        return Number.parseInt(count, 10);
      }).filter((n) => Number.isFinite(n));
    } catch (error) {
      logger.error("BaselineStore: failed to load samples", {
        userId,
        error: error instanceof Error ? error.message : "unknown error",
      });
      return [];
    }
  },
};
