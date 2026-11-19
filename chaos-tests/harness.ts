import type { Fault, RecoveryMetrics } from "./types";

export class FaultInjector {
  private activeFault: Fault | null = null;

  inject(fault: Fault): void {
    if (this.activeFault) {
      throw new Error(`A fault is already active for ${this.activeFault.target}`);
    }
    this.activeFault = fault;
  }

  recover(): void {
    this.activeFault = null;
  }

  isActive(target: string): boolean {
    return this.activeFault?.target === target;
  }

  currentFault(): Fault | null {
    return this.activeFault;
  }
}

export interface DependencyResponse<T> {
  value: T;
  source: "primary" | "fallback";
}

export class ResilientDependency<T> {
  constructor(
    private readonly target: string,
    private readonly injector: FaultInjector,
    private readonly primary: () => Promise<T>,
    private readonly fallback: () => Promise<T>,
    private readonly retries = 1,
  ) {}

  async read(): Promise<DependencyResponse<T>> {
    let attempts = 0;
    while (attempts <= this.retries) {
      try {
        if (this.injector.isActive(this.target)) {
          throw new Error(this.injector.currentFault()?.message ?? "Injected dependency failure");
        }
        return { value: await this.primary(), source: "primary" };
      } catch (error) {
        attempts += 1;
        if (attempts > this.retries) {
          return { value: await this.fallback(), source: "fallback" };
        }
      }
    }
    throw new Error("Unreachable dependency state");
  }
}

export interface ProbeSummary {
  probes: number;
  failedProbes: number;
  fallbackProbes: number;
  recovered: boolean;
  recoveryMs: number | null;
}

export async function probeUntilRecovered<T>(
  dependency: ResilientDependency<T>,
  injector: FaultInjector,
  target: string,
): Promise<ProbeSummary> {
  let probes = 0;
  let failedProbes = 0;
  let fallbackProbes = 0;
  const recoveryStarted = Date.now();

  const duringFailure = await dependency.read();
  probes += 1;
  if (duringFailure.source === "fallback") fallbackProbes += 1;

  injector.recover();
  const afterRecovery = await dependency.read();
  probes += 1;
  if (afterRecovery.source === "fallback") failedProbes += 1;

  const recovered = !injector.isActive(target) && afterRecovery.source === "primary";
  return {
    probes,
    failedProbes,
    fallbackProbes,
    recovered,
    recoveryMs: recovered ? Date.now() - recoveryStarted : null,
  };
}

export function buildMetrics(
  name: string,
  fault: Fault,
  startedAt: string,
  summary: ProbeSummary,
): RecoveryMetrics {
  return {
    experiment: name,
    failureKind: fault.kind,
    target: fault.target,
    startedAt,
    durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
    probes: summary.probes,
    failedProbes: summary.failedProbes,
    fallbackProbes: summary.fallbackProbes,
    recovered: summary.recovered,
    availabilityPercent: summary.probes === 0
      ? 0
      : ((summary.probes - summary.failedProbes) / summary.probes) * 100,
    meanTimeToRecoveryMs: summary.recoveryMs,
  };
}