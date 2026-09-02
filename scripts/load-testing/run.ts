import { readFile, writeFile } from "node:fs/promises";
import { PerformanceProfilerService } from "../../src/services/performance-profiler.service";
import { runScenario, scenarios } from "../../tests/performance/scenarios";
import type { LoadPattern } from "../../tests/performance/scenarios";

const scenarioName = (process.env.PERF_SCENARIO ?? "smoke") as LoadPattern;
const baseUrl = process.env.PERF_BASE_URL ?? "http://localhost:5001";
const baselinePath = process.env.PERF_BASELINE ?? "tests/performance/baseline.json";
const outputPath = process.env.PERF_OUTPUT ?? "performance-report.json";
const markdownPath = process.env.PERF_MARKDOWN_OUTPUT ?? "performance-report.md";
const scenario = scenarios[scenarioName];

if (!scenario) throw new Error(`Unknown PERF_SCENARIO: ${scenarioName}`);

const profiler = new PerformanceProfilerService();
await runScenario({ baseUrl, scenario, profiler });
const report = profiler.getReport();
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
const reportRows = report.metrics.map((metric) =>
  `| ${metric.name} | ${metric.count} | ${metric.errorRate.toFixed(3)} | ${metric.p95Ms.toFixed(2)} | ${metric.p99Ms.toFixed(2)} | ${metric.throughputPerSecond.toFixed(2)} |`,
).join("\n");
await writeFile(markdownPath, `# Performance Report\n\nGenerated: ${report.generatedAt}\n\n| Operation | Requests | Error rate | p95 (ms) | p99 (ms) | Throughput (req/s) |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${reportRows}\n`);

let regressions = [];
try {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  regressions = PerformanceProfilerService.findRegressions(baseline, report);
} catch {
  console.warn(`No baseline found at ${baselinePath}; regression gate skipped.`);
}

console.log(JSON.stringify({ scenario: scenarioName, report, regressions }, null, 2));
if (regressions.length > 0) {
  console.error(`Performance regression detected: ${regressions.length} threshold(s) exceeded.`);
  process.exitCode = 1;
}