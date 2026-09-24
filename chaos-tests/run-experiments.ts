import { writeFile } from "node:fs/promises";
import { databaseFailureExperiment } from "../experiments/database-failure";
import { networkPartitionExperiment } from "../experiments/network-partition";
import { serviceOutageExperiment } from "../experiments/service-outage";
import { redisFailureExperiment } from "../experiments/redis-failure";

async function main(): Promise<void> {
  if (process.env.CHAOS_ENABLED !== "true") {
    throw new Error("Set CHAOS_ENABLED=true to run failure injection experiments");
  }

  const results = await Promise.all([
    databaseFailureExperiment().run(),
    networkPartitionExperiment().run(),
    serviceOutageExperiment().run(),
    redisFailureExperiment().run(),
  ]);
  await writeFile("chaos-results.json", `${JSON.stringify(results, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  if (results.some((result) => !result.metrics.recovered)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});