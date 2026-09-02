import { PerformanceProfilerService } from "../../src/services/performance-profiler.service";

export type LoadPattern = "smoke" | "ramp" | "sustained" | "spike";

export interface LoadScenario {
  name: LoadPattern;
  concurrency: number;
  durationSeconds: number;
  rampSeconds?: number;
}

export interface LoadOptions {
  baseUrl: string;
  scenario: LoadScenario;
  profiler: PerformanceProfilerService;
}

export const scenarios: Record<LoadPattern, LoadScenario> = {
  smoke: { name: "smoke", concurrency: 2, durationSeconds: 10 },
  ramp: { name: "ramp", concurrency: 20, durationSeconds: 60, rampSeconds: 30 },
  sustained: { name: "sustained", concurrency: 50, durationSeconds: 120 },
  spike: { name: "spike", concurrency: 100, durationSeconds: 30 },
};

export async function runScenario({ baseUrl, scenario, profiler }: LoadOptions): Promise<void> {
  const endAt = Date.now() + scenario.durationSeconds * 1000;
  const startedAt = Date.now();
  await Promise.all(Array.from({ length: scenario.concurrency }, (_, index) =>
    runWorker(`${scenario.name}-${index}`, baseUrl, endAt, startedAt, scenario, profiler),
  ));
}

async function runWorker(
  name: string,
  baseUrl: string,
  endAt: number,
  startedAt: number,
  scenario: LoadScenario,
  profiler: PerformanceProfilerService,
): Promise<void> {
  while (Date.now() < endAt) {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const rampSeconds = scenario.rampSeconds ?? 0;
    const rampFactor = rampSeconds > 0 ? Math.min(elapsedSeconds / rampSeconds, 1) : 1;
    const activeWorkers = Math.max(1, Math.ceil(scenario.concurrency * rampFactor));
    if (Number(name.split("-").pop()) >= activeWorkers) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }

    await profiler.measure("GET /health/live", async () => {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health/live`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }).catch(() => undefined);
  }
}