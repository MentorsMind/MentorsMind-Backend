import { FaultInjector, ResilientDependency, buildMetrics, probeUntilRecovered } from "../chaos-tests/harness";
import type { ChaosExperiment, ExperimentResult } from "../chaos-tests/types";

export function serviceOutageExperiment(): ChaosExperiment {
  return {
    name: "payment-service-outage",
    failureKind: "service",
    target: "payment-gateway",
    async run(): Promise<ExperimentResult> {
      const startedAt = new Date().toISOString();
      const injector = new FaultInjector();
      const payments = new ResilientDependency("payment-gateway", injector, async () => "payment-confirmed", async () => "payment-queued");
      const fault = { kind: "service" as const, target: "payment-gateway", message: "upstream unavailable" };
      injector.inject(fault);
      const summary = await probeUntilRecovered(payments, injector, fault.target);
      return {
        name: this.name,
        metrics: buildMetrics(this.name, fault, startedAt, summary),
        observations: ["Payments are queued instead of lost during an upstream outage", "Payment confirmation recovers after the service returns"],
      };
    },
  };
}