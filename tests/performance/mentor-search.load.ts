/**
 * Load test for mentor search endpoint
 * Tests: GET /api/v1/mentors?skills=...&minRate=...
 *
 * Scenario:
 * - 50 concurrent requests over 60 seconds
 * - Varied query parameters (skills, rates, availability)
 * - Measures p95 response time and error rate
 * - Results written to tests/performance/results/mentor-search.json
 *
 * Run: npm run test:load
 */

import { PerformanceProfilerService } from "../../src/services/performance-profiler.service";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export interface MentorSearchLoadResult {
  scenario: string;
  concurrency: number;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  responseTimes: {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  };
  passed: boolean;
  timestamp: string;
}

/**
 * Generate varied mentor search query parameters
 */
function generateSearchParams(): Record<string, string> {
  const skills = ["JavaScript", "React", "Python", "Data Science", "AWS", "DevOps"];
  const rates = [25, 50, 75, 100, 150, 200];
  const selectedSkills = skills.slice(0, Math.ceil(Math.random() * 3)).join(",");
  const minRate = rates[Math.floor(Math.random() * rates.length)];
  const availability = ["available_now", "this_week", "flexible"][
    Math.floor(Math.random() * 3)
  ];

  return {
    skills: selectedSkills,
    minRate: minRate.toString(),
    availability,
    page: Math.floor(Math.random() * 5 + 1).toString(),
    limit: "20",
  };
}

/**
 * Execute a single mentor search request
 */
async function performMentorSearch(baseUrl: string): Promise<number> {
  const params = generateSearchParams();
  const queryString = new URLSearchParams(params).toString();
  const url = `${baseUrl}/api/v1/mentors?${queryString}`;

  const startTime = Date.now();
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    // Consume response body
    await response.json();
    return Date.now() - startTime;
  } catch (error) {
    throw new Error(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run load test scenario for mentor search
 */
export async function runMentorSearchLoadTest(baseUrl: string): Promise<MentorSearchLoadResult> {
  const concurrency = 50;
  const durationSeconds = 60;
  const scenario = "mentor-search-public-endpoint";

  const profiler = new PerformanceProfilerService();
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;
  const responseTimes: number[] = [];

  const startTime = Date.now();
  const endTime = startTime + durationSeconds * 1000;

  console.log(
    `Starting load test: ${concurrency} concurrent requests for ${durationSeconds}s...`,
  );

  // Run workers concurrently
  const workers = Array.from({ length: concurrency }, (_, index) =>
    (async () => {
      while (Date.now() < endTime) {
        try {
          const responseTime = await performMentorSearch(baseUrl);
          responseTimes.push(responseTime);
          successfulRequests += 1;
          totalRequests += 1;

          // Log progress every 10 requests
          if (totalRequests % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(
              `[${elapsed}s] ${totalRequests} requests, ${failedRequests} errors`,
            );
          }
        } catch (error) {
          failedRequests += 1;
          totalRequests += 1;
          console.error(`Request failed (${error instanceof Error ? error.message : String(error)})`);
        }
      }
    })(),
  );

  await Promise.all(workers);

  // Calculate statistics
  responseTimes.sort((a, b) => a - b);
  const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;

  const result: MentorSearchLoadResult = {
    scenario,
    concurrency,
    duration: durationSeconds,
    totalRequests,
    successfulRequests,
    failedRequests,
    errorRate,
    responseTimes: {
      min: Math.min(...responseTimes),
      max: Math.max(...responseTimes),
      mean: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
      p50: responseTimes[Math.floor(responseTimes.length * 0.5)],
      p95: responseTimes[Math.floor(responseTimes.length * 0.95)],
      p99: responseTimes[Math.floor(responseTimes.length * 0.99)],
    },
    passed: responseTimes[Math.floor(responseTimes.length * 0.95)] < 500 && errorRate < 1,
    timestamp: new Date().toISOString(),
  };

  return result;
}

/**
 * Main load test execution
 */
async function main(): Promise<void> {
  const baseUrl = process.env.API_BASE_URL || "http://localhost:5000";

  console.log(`\n📊 Mentor Search Load Test`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Target: GET /api/v1/mentors`);
  console.log(`────────────────────────────\n`);

  try {
    const result = await runMentorSearchLoadTest(baseUrl);

    // Display results
    console.log(`\n✅ Test completed`);
    console.log(`Total requests: ${result.totalRequests}`);
    console.log(`Successful: ${result.successfulRequests}`);
    console.log(`Failed: ${result.failedRequests}`);
    console.log(`Error rate: ${result.errorRate.toFixed(2)}%`);
    console.log(`\nResponse times (ms):`);
    console.log(`  Min:  ${result.responseTimes.min.toFixed(2)}`);
    console.log(`  Mean: ${result.responseTimes.mean.toFixed(2)}`);
    console.log(`  P50:  ${result.responseTimes.p50.toFixed(2)}`);
    console.log(`  P95:  ${result.responseTimes.p95.toFixed(2)} (threshold: 500ms)`);
    console.log(`  P99:  ${result.responseTimes.p99.toFixed(2)}`);
    console.log(`  Max:  ${result.responseTimes.max.toFixed(2)}`);

    // Write results to file
    const resultsDir = join(__dirname, "results");
    mkdirSync(resultsDir, { recursive: true });
    const resultsFile = join(resultsDir, "mentor-search.json");

    writeFileSync(resultsFile, JSON.stringify(result, null, 2), "utf-8");
    console.log(`\n📁 Results saved to: ${resultsFile}`);

    // Check thresholds
    if (result.passed) {
      console.log("\n✅ PASSED: p95 < 500ms AND error rate < 1%");
      process.exitCode = 0;
    } else {
      console.log("\n❌ FAILED:");
      if (result.responseTimes.p95 >= 500) {
        console.log(`   P95 response time: ${result.responseTimes.p95.toFixed(2)}ms (threshold: 500ms)`);
      }
      if (result.errorRate >= 1) {
        console.log(`   Error rate: ${result.errorRate.toFixed(2)}% (threshold: 1%)`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

main();
