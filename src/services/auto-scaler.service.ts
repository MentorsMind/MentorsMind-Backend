/**
 * Predictive autoscaler (issue #862).
 *
 * Turns a load prediction into a replica count, subject to the constraints that
 * keep autoscaling from being worse than no autoscaling:
 *
 *   - **SLA first.** If p95 latency is already over budget, scale up on the
 *     observation and ignore the prediction. A forecast never justifies leaving
 *     a breach unaddressed.
 *   - **Asymmetric cooldowns.** Scaling up is cheap and urgent; scaling down is
 *     the one that causes incidents, so it waits longer and needs the load to
 *     have stayed low.
 *   - **Low confidence means hold.** A prediction the predictor does not trust
 *     is not a reason to change anything.
 *   - **Cost.** Headroom is a percentage, not a fixed pad, and scale-down is
 *     capped per step so capacity is never removed in one jump.
 *
 * Execution is delegated to a `ScalingExecutor`, so the same policy drives
 * Kubernetes, a cloud ASG, or a dry run.
 */

import { Logger } from "../utils/logger";
import {
  MIN_ACTIONABLE_CONFIDENCE,
  type LoadPrediction,
  type LoadSample,
} from "./load-predictor.service";

const logger = new Logger("AutoScaler");

export interface ScalingPolicy {
  minReplicas: number;
  maxReplicas: number;
  /** Requests per second a single replica handles at target utilisation. */
  targetRpsPerReplica: number;
  /** Spare capacity kept above demand, as a fraction. 0.2 = 20% headroom. */
  headroom: number;
  /** p95 latency budget in milliseconds. A breach forces a scale-up. */
  latencySloMs: number;
  /** Seconds before another scale-up is allowed. */
  scaleUpCooldownSeconds: number;
  /** Seconds before a scale-down is allowed. Deliberately longer. */
  scaleDownCooldownSeconds: number;
  /** Most replicas that may be removed in one step. */
  maxScaleDownStep: number;
}

export type ScalingAction = "scale-up" | "scale-down" | "hold";

export interface ScalingDecision {
  action: ScalingAction;
  currentReplicas: number;
  desiredReplicas: number;
  /** Human-readable justification, surfaced in logs and the scaling dashboard. */
  reason: string;
  prediction: LoadPrediction;
  /** Replica-seconds saved or spent versus holding, for cost reporting. */
  replicaDelta: number;
}

export interface ScalingExecutor {
  currentReplicas(): Promise<number>;
  scaleTo(replicas: number): Promise<void>;
}

export const DEFAULT_POLICY: ScalingPolicy = {
  minReplicas: 2,
  maxReplicas: 20,
  targetRpsPerReplica: 50,
  headroom: 0.2,
  latencySloMs: 500,
  scaleUpCooldownSeconds: 60,
  scaleDownCooldownSeconds: 300,
  maxScaleDownStep: 1,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Replicas needed to serve `rps` with headroom, respecting the policy bounds. */
export function replicasFor(rps: number, policy: ScalingPolicy): number {
  const withHeadroom = rps * (1 + policy.headroom);
  const needed = Math.ceil(withHeadroom / policy.targetRpsPerReplica);
  return clamp(needed, policy.minReplicas, policy.maxReplicas);
}

export class AutoScalerService {
  private lastScaleUpAt = 0;
  private lastScaleDownAt = 0;

  constructor(
    private readonly policy: ScalingPolicy = DEFAULT_POLICY,
    private readonly executor?: ScalingExecutor,
  ) {}

  /**
   * Decide what to do, without doing it.
   *
   * Pure given its inputs and the recorded cooldown timestamps, which is what
   * makes the policy testable without a cluster.
   */
  decide(
    currentReplicas: number,
    prediction: LoadPrediction,
    observed: LoadSample | null,
    now = Date.now(),
  ): ScalingDecision {
    const hold = (reason: string): ScalingDecision => ({
      action: "hold",
      currentReplicas,
      desiredReplicas: currentReplicas,
      reason,
      prediction,
      replicaDelta: 0,
    });

    // An SLO breach outranks the forecast: the users are already waiting.
    if (observed && observed.p95LatencyMs > this.policy.latencySloMs) {
      const desired = clamp(
        Math.max(
          currentReplicas + 1,
          replicasFor(observed.requestsPerSecond, this.policy),
        ),
        this.policy.minReplicas,
        this.policy.maxReplicas,
      );
      if (desired > currentReplicas) {
        return {
          action: "scale-up",
          currentReplicas,
          desiredReplicas: desired,
          reason:
            `p95 ${observed.p95LatencyMs}ms exceeds the ${this.policy.latencySloMs}ms SLO; ` +
            "scaling on the observation rather than the forecast",
          prediction,
          replicaDelta: desired - currentReplicas,
        };
      }
      return hold(
        `p95 over SLO but already at maxReplicas (${this.policy.maxReplicas})`,
      );
    }

    if (prediction.confidence < MIN_ACTIONABLE_CONFIDENCE) {
      return hold(
        `prediction confidence ${prediction.confidence.toFixed(2)} is below ` +
          `${MIN_ACTIONABLE_CONFIDENCE}; holding at ${currentReplicas}`,
      );
    }

    const desired = replicasFor(prediction.requestsPerSecond, this.policy);

    if (desired > currentReplicas) {
      const since = (now - this.lastScaleUpAt) / 1000;
      if (since < this.policy.scaleUpCooldownSeconds) {
        return hold(
          `scale-up cooling down (${Math.round(since)}s of ${this.policy.scaleUpCooldownSeconds}s)`,
        );
      }
      return {
        action: "scale-up",
        currentReplicas,
        desiredReplicas: desired,
        reason:
          `predicted ${prediction.requestsPerSecond.toFixed(1)} rps needs ${desired} replicas ` +
          `at ${this.policy.targetRpsPerReplica} rps each plus ${Math.round(this.policy.headroom * 100)}% headroom`,
        prediction,
        replicaDelta: desired - currentReplicas,
      };
    }

    if (desired < currentReplicas) {
      const since = (now - this.lastScaleDownAt) / 1000;
      if (since < this.policy.scaleDownCooldownSeconds) {
        return hold(
          `scale-down cooling down (${Math.round(since)}s of ${this.policy.scaleDownCooldownSeconds}s)`,
        );
      }
      // Step down gradually: removing several replicas at once turns a
      // mispredicted dip into a latency spike.
      const stepped = Math.max(
        desired,
        currentReplicas - this.policy.maxScaleDownStep,
      );
      return {
        action: "scale-down",
        currentReplicas,
        desiredReplicas: stepped,
        reason:
          `predicted ${prediction.requestsPerSecond.toFixed(1)} rps needs ${desired} replicas; ` +
          `stepping down by at most ${this.policy.maxScaleDownStep}`,
        prediction,
        replicaDelta: stepped - currentReplicas,
      };
    }

    return hold(
      `at the right size for ${prediction.requestsPerSecond.toFixed(1)} predicted rps`,
    );
  }

  /** Decide and apply. Returns the decision, whether or not it changed anything. */
  async apply(
    prediction: LoadPrediction,
    observed: LoadSample | null,
    now = Date.now(),
  ): Promise<ScalingDecision> {
    if (!this.executor) {
      throw new Error("AutoScalerService.apply requires an executor");
    }

    const current = await this.executor.currentReplicas();
    const decision = this.decide(current, prediction, observed, now);

    if (decision.action === "hold") return decision;

    await this.executor.scaleTo(decision.desiredReplicas);
    if (decision.action === "scale-up") this.lastScaleUpAt = now;
    else this.lastScaleDownAt = now;

    logger.info(
      `${decision.action} ${decision.currentReplicas} → ${decision.desiredReplicas}: ${decision.reason}`,
    );
    return decision;
  }

  /** Reset cooldowns. Used by tests and after a manual scaling override. */
  resetCooldowns(): void {
    this.lastScaleUpAt = 0;
    this.lastScaleDownAt = 0;
  }
}

export const autoScaler = new AutoScalerService();
