import {
  AutoScalerService,
  DEFAULT_POLICY,
  replicasFor,
  type ScalingExecutor,
  type ScalingPolicy,
} from "../auto-scaler.service";
import {
  LoadPredictorService,
  MIN_ACTIONABLE_CONFIDENCE,
  hourOfWeek,
  linearSlope,
  type LoadPrediction,
  type LoadSample,
} from "../load-predictor.service";
import { ScalingOptimizerWorker } from "../../workers/scaling-optimizer.worker";

const MINUTE = 60_000;

function sample(overrides: Partial<LoadSample> = {}): LoadSample {
  return {
    timestamp: Date.UTC(2026, 0, 6, 12, 0, 0),
    requestsPerSecond: 100,
    cpuUtilisation: 0.5,
    p95LatencyMs: 200,
    ...overrides,
  };
}

function prediction(overrides: Partial<LoadPrediction> = {}): LoadPrediction {
  return {
    requestsPerSecond: 100,
    confidence: 0.9,
    basis: { seasonal: null, ewma: 100, trendPerMinute: 0 },
    seasonalSamples: 0,
    ...overrides,
  };
}

function policy(overrides: Partial<ScalingPolicy> = {}): ScalingPolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

describe("predictor maths", () => {
  it("buckets a timestamp by hour of week", () => {
    expect(hourOfWeek(Date.UTC(2026, 0, 4, 0, 0, 0))).toBe(0); // Sunday 00:00 UTC
    expect(hourOfWeek(Date.UTC(2026, 0, 5, 13, 30, 0))).toBe(24 + 13);
  });

  it("reports a flat series as no trend and a rising one as positive", () => {
    expect(linearSlope([5, 5, 5, 5])).toBe(0);
    expect(linearSlope([1, 2, 3, 4])).toBeCloseTo(1);
    expect(linearSlope([4, 3, 2, 1])).toBeCloseTo(-1);
    expect(linearSlope([7])).toBe(0);
  });
});

describe("LoadPredictorService", () => {
  it("predicts nothing with no confidence when it has no history", () => {
    const result = new LoadPredictorService().predict();
    expect(result).toMatchObject({ requestsPerSecond: 0, confidence: 0 });
  });

  it("projects a rising trend forward", () => {
    const predictor = new LoadPredictorService();
    const base = Date.UTC(2026, 0, 6, 12, 0, 0);
    for (let i = 0; i < 10; i++) {
      predictor.record(
        sample({
          timestamp: base + i * MINUTE,
          requestsPerSecond: 100 + i * 10,
        }),
      );
    }

    const result = predictor.predict(5, base + 9 * MINUTE);

    expect(result.basis.trendPerMinute).toBeGreaterThan(0);
    expect(result.requestsPerSecond).toBeGreaterThan(result.basis.ewma ?? 0);
  });

  it("uses the seasonal baseline once the bucket has enough samples", () => {
    const predictor = new LoadPredictorService();
    // Three prior weeks of the same hour-of-week bucket at a much higher rate.
    for (let week = 1; week <= 3; week++) {
      predictor.record(
        sample({
          timestamp: Date.UTC(2026, 0, 6 - 7 * week, 12, 5, 0),
          requestsPerSecond: 500,
        }),
      );
    }
    // The current sample sits in the 11:00 bucket, so the 12:00 bucket the
    // horizon lands in holds only the three historical weeks.
    predictor.record(
      sample({
        timestamp: Date.UTC(2026, 0, 6, 11, 55, 0),
        requestsPerSecond: 100,
      }),
    );

    const result = predictor.predict(5, Date.UTC(2026, 0, 6, 11, 56, 0));

    expect(result.basis.seasonal).toBeCloseTo(500);
    expect(result.requestsPerSecond).toBeGreaterThan(100);
    expect(result.seasonalSamples).toBe(3);
  });

  it("is less confident when the seasonal baseline and the projection disagree", () => {
    const agreeing = new LoadPredictorService();
    const disagreeing = new LoadPredictorService();
    const at = Date.UTC(2026, 0, 6, 12, 0, 0);

    for (let i = 0; i < 10; i++) {
      agreeing.record(
        sample({ timestamp: at - (10 - i) * MINUTE, requestsPerSecond: 100 }),
      );
      disagreeing.record(
        sample({ timestamp: at - (10 - i) * MINUTE, requestsPerSecond: 100 }),
      );
    }
    for (let week = 1; week <= 3; week++) {
      agreeing.record(
        sample({
          timestamp: at - week * 7 * 24 * 60 * MINUTE + 5 * MINUTE,
          requestsPerSecond: 100,
        }),
      );
      disagreeing.record(
        sample({
          timestamp: at - week * 7 * 24 * 60 * MINUTE + 5 * MINUTE,
          requestsPerSecond: 900,
        }),
      );
    }

    expect(disagreeing.predict(5, at).confidence).toBeLessThan(
      agreeing.predict(5, at).confidence,
    );
  });

  it("caps retained history", () => {
    const predictor = new LoadPredictorService(5);
    for (let i = 0; i < 20; i++)
      predictor.record(sample({ timestamp: Date.now() + i }));
    expect(predictor.sampleCount).toBe(5);
  });
});

describe("replicasFor", () => {
  it("adds headroom and rounds up", () => {
    // 100 rps * 1.2 headroom / 50 per replica = 2.4 → 3
    expect(replicasFor(100, policy())).toBe(3);
  });

  it("never goes below the floor or above the ceiling", () => {
    expect(replicasFor(0, policy())).toBe(2);
    expect(replicasFor(100_000, policy())).toBe(20);
  });
});

describe("AutoScalerService.decide", () => {
  it("scales up on an SLO breach regardless of the forecast", () => {
    const scaler = new AutoScalerService(policy());

    const decision = scaler.decide(
      3,
      prediction({ requestsPerSecond: 10, confidence: 0.9 }),
      sample({ p95LatencyMs: 900, requestsPerSecond: 100 }),
    );

    expect(decision.action).toBe("scale-up");
    expect(decision.desiredReplicas).toBeGreaterThan(3);
    expect(decision.reason).toMatch(/exceeds the 500ms SLO/);
  });

  it("holds when the prediction is not trusted", () => {
    const scaler = new AutoScalerService(policy());

    const decision = scaler.decide(
      2,
      prediction({
        requestsPerSecond: 5_000,
        confidence: MIN_ACTIONABLE_CONFIDENCE - 0.01,
      }),
      sample(),
    );

    expect(decision.action).toBe("hold");
    expect(decision.desiredReplicas).toBe(2);
    expect(decision.reason).toMatch(/confidence/);
  });

  it("scales up ahead of predicted load", () => {
    const scaler = new AutoScalerService(policy());

    const decision = scaler.decide(
      2,
      prediction({ requestsPerSecond: 400 }),
      sample(),
    );

    expect(decision.action).toBe("scale-up");
    expect(decision.desiredReplicas).toBe(10); // 400 * 1.2 / 50
  });

  it("never removes more than one replica per step", () => {
    const scaler = new AutoScalerService(policy({ minReplicas: 1 }));

    const decision = scaler.decide(
      10,
      prediction({ requestsPerSecond: 10 }),
      sample(),
    );

    expect(decision.action).toBe("scale-down");
    expect(decision.desiredReplicas).toBe(9);
  });

  it("holds when already correctly sized", () => {
    const scaler = new AutoScalerService(policy());
    expect(
      scaler.decide(3, prediction({ requestsPerSecond: 100 }), sample()).action,
    ).toBe("hold");
  });
});

describe("AutoScalerService.apply", () => {
  function executor(
    start: number,
  ): ScalingExecutor & { replicas: number; calls: number[] } {
    return {
      replicas: start,
      calls: [] as number[],
      async currentReplicas() {
        return this.replicas;
      },
      async scaleTo(n: number) {
        this.calls.push(n);
        this.replicas = n;
      },
    };
  }

  it("applies a scale-up and then respects the cooldown", async () => {
    const exec = executor(2);
    const scaler = new AutoScalerService(policy(), exec);
    const now = Date.now();

    const first = await scaler.apply(
      prediction({ requestsPerSecond: 400 }),
      sample(),
      now,
    );
    expect(first.action).toBe("scale-up");
    expect(exec.replicas).toBe(10);

    const second = await scaler.apply(
      prediction({ requestsPerSecond: 900 }),
      sample(),
      now + 10_000,
    );
    expect(second.action).toBe("hold");
    expect(second.reason).toMatch(/cooling down/);
    expect(exec.calls).toHaveLength(1);
  });

  it("allows a further scale-up once the cooldown has passed", async () => {
    const exec = executor(2);
    const scaler = new AutoScalerService(policy(), exec);
    const now = Date.now();

    await scaler.apply(prediction({ requestsPerSecond: 200 }), sample(), now);
    const later = await scaler.apply(
      prediction({ requestsPerSecond: 900 }),
      sample(),
      now + 61_000,
    );

    expect(later.action).toBe("scale-up");
    expect(exec.calls).toHaveLength(2);
  });

  it("holds a scale-down inside the longer cooldown", async () => {
    const exec = executor(10);
    const scaler = new AutoScalerService(policy({ minReplicas: 1 }), exec);
    const now = Date.now();

    await scaler.apply(prediction({ requestsPerSecond: 10 }), sample(), now);
    const second = await scaler.apply(
      prediction({ requestsPerSecond: 10 }),
      sample(),
      now + 120_000,
    );

    expect(second.action).toBe("hold");
    expect(exec.replicas).toBe(9);
  });

  it("refuses to apply without an executor", async () => {
    const scaler = new AutoScalerService(policy());
    await expect(scaler.apply(prediction(), sample())).rejects.toThrow(
      /requires an executor/,
    );
  });
});

describe("ScalingOptimizerWorker", () => {
  function build(overrides: { sample?: () => Promise<LoadSample> } = {}) {
    const exec = {
      replicas: 2,
      async currentReplicas() {
        return this.replicas;
      },
      async scaleTo(n: number) {
        this.replicas = n;
      },
    };
    const worker = new ScalingOptimizerWorker({
      metrics: {
        sample:
          overrides.sample ?? (async () => sample({ requestsPerSecond: 400 })),
      },
      scaler: new AutoScalerService(policy(), exec),
      predictor: new LoadPredictorService(),
    });
    return { worker, exec };
  }

  it("samples, predicts and scales in one tick", async () => {
    const { worker, exec } = build();

    const decision = await worker.tick();

    expect(decision).not.toBeNull();
    expect(worker.history()).toHaveLength(1);
    expect(exec.replicas).toBeGreaterThanOrEqual(2);
  });

  it("survives a failing metrics source", async () => {
    const { worker, exec } = build({
      sample: async () => {
        throw new Error("prometheus unreachable");
      },
    });

    expect(await worker.tick()).toBeNull();
    expect(worker.failureStreak).toBe(1);
    expect(exec.replicas).toBe(2);
  });

  it("summarises decisions for cost reporting", async () => {
    const { worker } = build();
    await worker.tick();
    await worker.tick();

    const report = worker.costReport();
    expect(report.scaleUps + report.scaleDowns + report.holds).toBe(2);
  });

  it("start and stop are idempotent", () => {
    const { worker } = build();
    worker.start();
    worker.start();
    expect(worker.running).toBe(true);
    worker.stop();
    worker.stop();
    expect(worker.running).toBe(false);
  });
});
