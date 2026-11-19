import { FaultInjector, ResilientDependency, buildMetrics, probeUntilRecovered } from "../chaos-tests/harness";
import type { ChaosExperiment, ExperimentResult } from "../chaos-tests/types";

export function databaseFailureExperiment(): ChaosExperiment {
  return {
    name: "database-connection-loss",
    failureKind: "database",
    target: "postgresql",
    async run(): Promise<ExperimentResult> {
      const startedAt = new Date().toISOString();
      const injector = new FaultInjector();
      const database = new ResilientDependency(
        "postgresql",
        injector,
        async () => "database-value",
        async () => "cached-value",
      );
      const fault = { kind: "database" as const, target: "postgresql", message: "connection refused" };
      injector.inject(fault);
      const summary = await probeUntilRecovered(database, injector, fault.target);
      return {
        name: this.name,
        metrics: buildMetrics(this.name, fault, startedAt, summary),
        observations: ["Reads use cached data during database outage", "Primary database reads recover after the fault is removed"],
      };
    },
  };
}