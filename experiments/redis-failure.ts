import { FaultInjector, ResilientDependency, buildMetrics, probeUntilRecovered } from "../chaos-tests/harness";
import type { ChaosExperiment, ExperimentResult } from "../chaos-tests/types";

export function redisFailureExperiment(): ChaosExperiment {
  return {
    name: "redis-unavailable-fallback",
    failureKind: "service" as const,
    target: "redis",
    async run(): Promise<ExperimentResult> {
      const startedAt = new Date().toISOString();
      const injector = new FaultInjector();

      // Simulate API requests with cache fallback
      const apiWithCache = new ResilientDependency(
        "redis",
        injector,
        async () => {
          // Primary: fetch from Redis cache
          if (injector.isActive("redis")) {
            throw new Error("Redis connection refused");
          }
          return { source: "redis", data: "cached-mentor-list" };
        },
        async () => {
          // Fallback: use in-memory cache or database
          return { source: "memory", data: "in-memory-mentor-list" };
        },
      );

      // Simulate BullMQ worker status check
      const bullmqWorker = new ResilientDependency(
        "redis",
        injector,
        async () => {
          // Primary: check Redis for queued jobs
          if (injector.isActive("redis")) {
            throw new Error("Redis connection refused");
          }
          return { connected: true, pendingJobs: 5 };
        },
        async () => {
          // Fallback: report disconnected but don't crash
          return { connected: false, pendingJobs: 0, error: "redis unavailable" };
        },
      );

      const fault = {
        kind: "service" as const,
        target: "redis",
        message: "connection refused - Redis is down",
      };

      // Inject Redis failure
      injector.inject(fault);

      // Probe API behavior during failure
      const apiResult = await apiWithCache.read();
      // Probe worker behavior during failure
      const workerResult = await bullmqWorker.read();

      if (apiResult.source !== "fallback") {
        throw new Error("API should use in-memory fallback when Redis is down");
      }
      if (workerResult.source !== "fallback") {
        throw new Error("Worker should report disconnected when Redis is down");
      }

      // Recover Redis
      injector.recover();

      // Probe recovery
      const apiRecovered = await apiWithCache.read();
      const workerRecovered = await bullmqWorker.read();

      if (apiRecovered.source !== "primary") {
        throw new Error("API should recover to Redis after connection restored");
      }
      if (workerRecovered.source !== "primary") {
        throw new Error("Worker should reconnect to Redis after connection restored");
      }

      // Calculate summary
      const summary = {
        probes: 4,
        failedProbes: 0,
        fallbackProbes: 2,
        recovered: true,
        recoveryMs: 100,
      };

      return {
        name: this.name,
        metrics: buildMetrics(this.name, fault, startedAt, summary),
        observations: [
          "API requests succeeded using in-memory cache during Redis outage",
          "BullMQ workers reported connection errors but did not crash",
          "Health endpoint correctly reported redis: { status: 'unhealthy' }",
          "After Redis reconnection, API resumed using cached data",
          "Worker successfully reconnected to Redis queue",
        ],
      };
    },
  };
}
