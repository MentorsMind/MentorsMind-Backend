/**
 * Scaling optimizer worker (issue #862).
 *
 * Samples load, feeds the predictor, asks the scaler what to do, and records the
 * outcome. Runs on an interval rather than a queue: scaling is a control loop,
 * and a backlog of stale scaling decisions is worse than none.
 *
 * The loop never throws. A metrics source that is briefly unavailable should
 * leave the cluster where it is, not crash the worker that keeps it sized.
 */

import { Logger } from "../utils/logger";
import {
  AutoScalerService,
  autoScaler,
  type ScalingDecision,
} from "../services/auto-scaler.service";
import {
  LoadPredictorService,
  loadPredictor,
  type LoadSample,
} from "../services/load-predictor.service";

const logger = new Logger("ScalingOptimizer");

export interface MetricsSource {
  /** Current load across the fleet. */
  sample(): Promise<LoadSample>;
}

export interface ScalingOptimizerOptions {
  metrics: MetricsSource;
  scaler?: AutoScalerService;
  predictor?: LoadPredictorService;
  /** Seconds between control-loop ticks. */
  intervalSeconds?: number;
  /** Minutes ahead to predict. Should exceed the time a replica takes to be ready. */
  horizonMinutes?: number;
  /** Decisions retained for the scaling dashboard. */
  historyLimit?: number;
}

export const DEFAULT_INTERVAL_SECONDS = 30;
export const DEFAULT_HORIZON_MINUTES = 5;
export const DEFAULT_DECISION_HISTORY = 200;

export class ScalingOptimizerWorker {
  private timer: NodeJS.Timeout | null = null;
  private decisions: ScalingDecision[] = [];
  private consecutiveFailures = 0;

  private readonly metrics: MetricsSource;
  private readonly scaler: AutoScalerService;
  private readonly predictor: LoadPredictorService;
  private readonly intervalSeconds: number;
  private readonly horizonMinutes: number;
  private readonly historyLimit: number;

  constructor(options: ScalingOptimizerOptions) {
    this.metrics = options.metrics;
    this.scaler = options.scaler ?? autoScaler;
    this.predictor = options.predictor ?? loadPredictor;
    this.intervalSeconds = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
    this.horizonMinutes = options.horizonMinutes ?? DEFAULT_HORIZON_MINUTES;
    this.historyLimit = options.historyLimit ?? DEFAULT_DECISION_HISTORY;
  }

  /** One iteration of the control loop. Returns null when the tick failed. */
  async tick(now = Date.now()): Promise<ScalingDecision | null> {
    try {
      const sample = await this.metrics.sample();
      this.predictor.record(sample);

      const prediction = this.predictor.predict(this.horizonMinutes, now);
      const decision = await this.scaler.apply(prediction, sample, now);

      this.decisions.push(decision);
      if (this.decisions.length > this.historyLimit) this.decisions.shift();
      this.consecutiveFailures = 0;

      return decision;
    } catch (err) {
      this.consecutiveFailures++;
      logger.error(
        `Scaling tick failed (${this.consecutiveFailures} in a row): ${(err as Error).message}`,
      );
      return null;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalSeconds * 1000);
    this.timer.unref?.();
    logger.info(
      `Scaling optimizer started, ticking every ${this.intervalSeconds}s`,
    );
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info("Scaling optimizer stopped");
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get failureStreak(): number {
    return this.consecutiveFailures;
  }

  history(): ScalingDecision[] {
    return [...this.decisions];
  }

  /**
   * Replica-seconds spent relative to holding the starting size, and the number
   * of decisions taken. Feeds the cost panel of the scaling dashboard.
   */
  costReport(): {
    scaleUps: number;
    scaleDowns: number;
    holds: number;
    replicaDelta: number;
  } {
    return this.decisions.reduce(
      (acc, decision) => ({
        scaleUps: acc.scaleUps + (decision.action === "scale-up" ? 1 : 0),
        scaleDowns: acc.scaleDowns + (decision.action === "scale-down" ? 1 : 0),
        holds: acc.holds + (decision.action === "hold" ? 1 : 0),
        replicaDelta: acc.replicaDelta + decision.replicaDelta,
      }),
      { scaleUps: 0, scaleDowns: 0, holds: 0, replicaDelta: 0 },
    );
  }
}
