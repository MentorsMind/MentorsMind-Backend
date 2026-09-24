import { databaseFailureExperiment } from "../experiments/database-failure";
import { networkPartitionExperiment } from "../experiments/network-partition";
import { serviceOutageExperiment } from "../experiments/service-outage";
import { redisFailureExperiment } from "../experiments/redis-failure";
import type { ChaosExperiment } from "./types";

const experiments: ChaosExperiment[] = [
  databaseFailureExperiment(),
  networkPartitionExperiment(),
  serviceOutageExperiment(),
  redisFailureExperiment(),
];

describe("resilience experiments", () => {
  it.each(experiments.map((experiment) => [experiment.name, experiment] as const))(
    "%s contains failure and recovers the dependency",
    async (_name, experiment) => {
      const result = await experiment.run();

      expect(result.metrics.recovered).toBe(true);
      expect(result.metrics.fallbackProbes).toBe(1);
      expect(result.metrics.failedProbes).toBe(0);
      expect(result.metrics.availabilityPercent).toBe(100);
      expect(result.metrics.meanTimeToRecoveryMs).not.toBeNull();
      expect(result.observations).toHaveLength(2);
    },
  );
});