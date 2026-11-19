/**
 * Load prediction for proactive scaling (issue #862).
 *
 * Reactive autoscaling always lags: by the time CPU is high, the requests that
 * pushed it there are already queued. This predicts the next window from three
 * signals and lets the scaler act before the load arrives.
 *
 *   1. A seasonal baseline keyed by hour-of-week. Mentoring traffic is strongly
 *      weekly — Tuesday 19:00 looks like last Tuesday 19:00, not like 03:00.
 *   2. An EWMA of recent samples, which carries today's level.
 *   3. A short-window linear trend, which carries the direction of travel.
 *
 * Confidence falls when the three disagree or when the seasonal bucket is thin,
 * and the scaler is expected to act conservatively on a low-confidence call.
 */

export interface LoadSample {
  /** Epoch milliseconds. */
  timestamp: number;
  /** Requests per second observed over the sample window. */
  requestsPerSecond: number;
  /** Mean CPU utilisation across replicas, 0–1. */
  cpuUtilisation: number;
  /** p95 latency in milliseconds. */
  p95LatencyMs: number;
}

export interface LoadPrediction {
  /** Predicted requests per second for the next window. */
  requestsPerSecond: number;
  /** 0–1. Below `MIN_ACTIONABLE_CONFIDENCE` the scaler should not act on it. */
  confidence: number;
  /** Which signals were available. */
  basis: {
    seasonal: number | null;
    ewma: number | null;
    trendPerMinute: number;
  };
  /** Number of samples in the seasonal bucket used. */
  seasonalSamples: number;
}

/** 168 buckets: one per hour of the week. */
export const SEASONAL_BUCKETS = 168;
/** Samples retained; at one per 30s that is a bit over two days. */
export const DEFAULT_HISTORY_LIMIT = 6_000;
/** Weight of the newest sample in the EWMA. */
export const EWMA_ALPHA = 0.3;
/** Samples used for the linear trend. */
export const TREND_WINDOW = 10;
/** A seasonal bucket needs this many samples before it is trusted. */
export const MIN_SEASONAL_SAMPLES = 3;
/** The scaler ignores predictions below this confidence. */
export const MIN_ACTIONABLE_CONFIDENCE = 0.4;

export function hourOfWeek(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getUTCDay() * 24 + date.getUTCHours();
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Least-squares slope of `values` against their index, in units per step.
 * Returns 0 for fewer than two points, where a slope is undefined.
 */
export function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  const meanX = (n - 1) / 2;
  const meanY = mean(values);
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - meanX) * (values[i] - meanY);
    denominator += (i - meanX) ** 2;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

export class LoadPredictorService {
  private history: LoadSample[] = [];
  private seasonal = new Map<number, number[]>();
  private ewma: number | null = null;

  constructor(
    private readonly historyLimit: number = DEFAULT_HISTORY_LIMIT,
    private readonly alpha: number = EWMA_ALPHA,
  ) {}

  record(sample: LoadSample): void {
    this.history.push(sample);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }

    const bucket = hourOfWeek(sample.timestamp);
    const values = this.seasonal.get(bucket) ?? [];
    values.push(sample.requestsPerSecond);
    // Keep the bucket bounded so a long-running process does not accumulate
    // weeks of samples per hour.
    if (values.length > 8) values.shift();
    this.seasonal.set(bucket, values);

    this.ewma =
      this.ewma === null
        ? sample.requestsPerSecond
        : this.alpha * sample.requestsPerSecond + (1 - this.alpha) * this.ewma;
  }

  get sampleCount(): number {
    return this.history.length;
  }

  latest(): LoadSample | null {
    return this.history[this.history.length - 1] ?? null;
  }

  /**
   * Predict load `horizonMinutes` ahead.
   *
   * With no history at all the prediction is zero at zero confidence, which the
   * scaler reads as "do nothing" rather than "scale to zero".
   */
  predict(horizonMinutes = 5, now = Date.now()): LoadPrediction {
    if (this.history.length === 0) {
      return {
        requestsPerSecond: 0,
        confidence: 0,
        basis: { seasonal: null, ewma: null, trendPerMinute: 0 },
        seasonalSamples: 0,
      };
    }

    const targetBucket = hourOfWeek(now + horizonMinutes * 60_000);
    const bucketSamples = this.seasonal.get(targetBucket) ?? [];
    const seasonal =
      bucketSamples.length >= MIN_SEASONAL_SAMPLES ? mean(bucketSamples) : null;

    const recent = this.history
      .slice(-TREND_WINDOW)
      .map((s) => s.requestsPerSecond);
    const stepMinutes = this.averageStepMinutes();
    const trendPerMinute =
      stepMinutes > 0 ? linearSlope(recent) / stepMinutes : 0;

    const level = this.ewma ?? recent[recent.length - 1];
    const projected = Math.max(0, level + trendPerMinute * horizonMinutes);

    // With a trusted seasonal baseline, blend it with the projection; otherwise
    // the projection is all there is.
    const predicted =
      seasonal === null ? projected : 0.5 * seasonal + 0.5 * projected;

    return {
      requestsPerSecond: predicted,
      confidence: this.confidence(seasonal, projected, bucketSamples.length),
      basis: { seasonal, ewma: this.ewma, trendPerMinute },
      seasonalSamples: bucketSamples.length,
    };
  }

  reset(): void {
    this.history = [];
    this.seasonal.clear();
    this.ewma = null;
  }

  /** Mean gap between samples, in minutes. */
  private averageStepMinutes(): number {
    const window = this.history.slice(-TREND_WINDOW);
    if (window.length < 2) return 0;
    const span = window[window.length - 1].timestamp - window[0].timestamp;
    return span / (window.length - 1) / 60_000;
  }

  /**
   * Confidence in [0, 1].
   *
   * Starts from how much history there is, is raised by a well-populated
   * seasonal bucket, and is cut when the seasonal baseline and the projection
   * disagree — that disagreement is exactly when a prediction is most likely to
   * be wrong, and acting on it costs either money or an outage.
   */
  private confidence(
    seasonal: number | null,
    projected: number,
    bucketSamples: number,
  ): number {
    const historyFactor = Math.min(1, this.history.length / TREND_WINDOW);
    if (seasonal === null) return Math.min(0.6, historyFactor * 0.6);

    const seasonalFactor = Math.min(1, bucketSamples / 8);
    const larger = Math.max(seasonal, projected, 1);
    const agreement = 1 - Math.min(1, Math.abs(seasonal - projected) / larger);

    return Math.max(
      0,
      Math.min(
        1,
        historyFactor * (0.4 + 0.3 * seasonalFactor + 0.3 * agreement),
      ),
    );
  }
}

export const loadPredictor = new LoadPredictorService();
