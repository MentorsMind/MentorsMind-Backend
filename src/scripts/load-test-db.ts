import { createOptimizedPool } from "../config/database";
import { QueryMonitor } from "../utils/query-monitor.utils";
import { logger } from "../utils/logger";

export interface LoadTestResult {
  concurrentUsers: number;
  iterations: number;
  durationMs: number;
  successCount: number;
  errorCount: number;
  errorsPerSecond: number;
}

export async function runLoadTest(
  concurrentRequests: number,
  iterations: number,
): Promise<LoadTestResult> {
  const pool = createOptimizedPool();
  logger.info(
    `Starting load test with ${concurrentRequests} concurrent queries...`,
  );

  const startTime = Date.now();
  let successCount = 0;
  let errorCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const promises = Array.from({ length: concurrentRequests }).map(
      async (_, index) => {
        let client;
        try {
          client = await pool.connect();
          const queries = [
            "SELECT NOW()",
            "SELECT 1",
            "SELECT gen_random_uuid()",
          ];
          const randomQuery =
            queries[Math.floor(Math.random() * queries.length)];
          await QueryMonitor.execute(client, randomQuery, [], {
            timeoutMs: 2000,
          });
          successCount++;
        } catch (error) {
          errorCount++;
          logger.error(`Query ${index} failed:`, error);
        } finally {
          if (client) client.release();
        }
      },
    );

    await Promise.allSettled(promises);
  }

  const durationMs = Date.now() - startTime;
  const result: LoadTestResult = {
    concurrentUsers: concurrentRequests,
    iterations,
    durationMs,
    successCount,
    errorCount,
    errorsPerSecond: durationMs > 0 ? (errorCount / durationMs) * 1000 : 0,
  };

  logger.info("Load test completed", result);
  await pool.end();
  return result;
}

async function runBenchmarkSuite(): Promise<void> {
  const levels = [100, 500, 1000];
  const results: LoadTestResult[] = [];

  for (const concurrent of levels) {
    results.push(await runLoadTest(concurrent, 3));
  }

  logger.info("Load test suite summary", { results });
}

if (require.main === module) {
  const concurrent = parseInt(process.argv[2] || "100", 10);
  const iterations = parseInt(process.argv[3] || "3", 10);

  if (process.argv.includes("--suite")) {
    runBenchmarkSuite().catch((err) =>
      logger.error("Load test suite failed", { error: err }),
    );
  } else {
    runLoadTest(concurrent, iterations).catch((err) =>
      logger.error("Load test failed", { error: err }),
    );
  }
}
