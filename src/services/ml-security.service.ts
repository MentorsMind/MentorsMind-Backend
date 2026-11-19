/**
 * "ML" Security Service — statistical/heuristic anomaly scoring engine.
 *
 * IMPORTANT / HONESTY NOTE: despite the filename (kept for parity with the
 * GitHub issue's naming), this is NOT a trained machine-learning model.
 * It is a small set of pure statistical utilities:
 *
 *   - scoreDeviation(): a z-score-style deviation of a current value from a
 *     rolling baseline (mean/stddev of recent historical samples), normalized
 *     onto a 0-100-ish scale.
 *   - computeVelocityScore(): compares the rate of events in a recent time
 *     window against a configured threshold and returns a 0-100 score.
 *
 * Both functions are pure and stateless — no DB/IO access — so they are
 * cheap to unit test and safe to call from request-hot paths or workers.
 * Nobody should read "ml-security" as a claim of deep learning; it is a
 * heuristic/statistical anomaly-detection utility.
 *
 * scoreDeviationForUser() is the one non-pure export here: it wraps
 * scoreDeviation() with the Redis-backed rolling baseline from
 * baseline-store.service.ts, so callers on the hot path (e.g.
 * threat-detection.service.ts) no longer need to assemble their own
 * historicalSamples on every call. Pass `override` to bypass the store
 * entirely (e.g. in tests, or when a caller already has samples in hand).
 */

import { BaselineStore } from "./baseline-store.service";

/** Clamp a number into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function mean(samples: number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, v) => sum + v, 0) / samples.length;
}

function stddev(samples: number[], sampleMean: number): number {
  if (samples.length === 0) return 0;
  const variance =
    samples.reduce((sum, v) => sum + (v - sampleMean) ** 2, 0) /
    samples.length;
  return Math.sqrt(variance);
}

/** A deviation score at/above this is treated as "maximally anomalous" (100). */
const MAX_Z_SCORE = 5;

export const MlSecurityService = {
  /**
   * Statistical (z-score-style) deviation of `current` from the baseline
   * formed by `historicalSamples`.
   *
   * score = |current - mean(historicalSamples)| / (stddev(historicalSamples) || 1)
   *
   * The raw z-score is then linearly rescaled onto a 0-100 scale, where a
   * z-score of `MAX_Z_SCORE` (5 standard deviations) or higher saturates at
   * 100. With fewer than 2 historical samples there is no meaningful
   * baseline, so the score is 0 (not enough data to call it anomalous).
   */
  scoreDeviation(current: number, historicalSamples: number[]): number {
    const samples = historicalSamples.filter((v) => Number.isFinite(v));
    if (samples.length < 2) return 0;

    const baselineMean = mean(samples);
    const baselineStddev = stddev(samples, baselineMean);
    const zScore = Math.abs(current - baselineMean) / (baselineStddev || 1);

    return clamp((zScore / MAX_Z_SCORE) * 100, 0, 100);
  },

  /**
   * Velocity anomaly score: how far the observed rate of events within
   * `windowMs` (measured from the latest timestamp backwards) exceeds
   * `threshold` events-per-window.
   *
   * score = 0 when eventCount <= threshold
   * score scales linearly up to 100 at 3x the threshold (or more)
   */
  computeVelocityScore(
    eventTimestamps: Date[],
    windowMs: number,
    threshold: number,
  ): number {
    if (eventTimestamps.length === 0 || threshold <= 0) return 0;

    const times = eventTimestamps
      .map((d) => d.getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => b - a);

    if (times.length === 0) return 0;

    const latest = times[0];
    const windowStart = latest - windowMs;
    const countInWindow = times.filter((t) => t >= windowStart).length;

    if (countInWindow <= threshold) return 0;

    // Saturate at 100 once the count reaches 3x the threshold.
    const saturationCount = threshold * 3;
    const ratio =
      (countInWindow - threshold) / (saturationCount - threshold || 1);

    return clamp(ratio * 100, 0, 100);
  },

  /**
   * Same scoring as scoreDeviation(), but sources historicalSamples from the
   * Redis-backed rolling baseline (BaselineStore) when `override` is not
   * supplied, instead of requiring the caller to gather them per-request.
   *
   * Pass `override` to skip the Redis lookup and score against explicit
   * samples (mirrors the old scoreDeviation() call signature).
   */
  async scoreDeviationForUser(
    userId: string,
    current: number,
    override?: number[],
  ): Promise<number> {
    const samples = override ?? (await BaselineStore.getSamples(userId));
    return MlSecurityService.scoreDeviation(current, samples);
  },
};
