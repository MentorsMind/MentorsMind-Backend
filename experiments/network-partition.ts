import { FaultInjector, ResilientDependency, buildMetrics, probeUntilRecovered } from "../chaos-tests/harness";
import type { ChaosExperiment, ExperimentResult } from "../chaos-tests/types";

export function networkPartitionExperiment(): ChaosExperiment {
  return {
    name: "external-network-partition",
    failureKind: "network",
    target: "elasticsearch",
    async run(): Promise<ExperimentResult> {
      const startedAt = new Date().toISOString();
      const injector = new FaultInjector();
      const search = new ResilientDependency("elasticsearch", injector, async () => ["remote-result"], async () => ["local-result"]);
      const fault = { kind: "network" as const, target: "elasticsearch", message: "network partition" };
      injector.inject(fault);
      const summary = await probeUntilRecovered(search, injector, fault.target);
      return {
        name: this.name,
        metrics: buildMetrics(this.name, fault, startedAt, summary),
        observations: ["Search falls back to local results during a partition", "Remote search recovers after connectivity returns"],
      };
    },
  };
}