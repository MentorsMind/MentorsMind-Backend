#!/usr/bin/env ts-node
/**
 * Performance Benchmark CLI
 * Main entry point for running benchmarks
 */

import { BenchmarkRunner } from "./runner";
import { BenchmarkComparator } from "./comparator";
import { CI_CONFIG } from "./config";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "run";

  const runner = new BenchmarkRunner();
  const comparator = new BenchmarkComparator();

  try {
    switch (command) {
      case "run":
        await runBenchmarks(runner, comparator);
        break;

      case "baseline":
        await createBaseline(runner, comparator);
        break;

      case "compare":
        await compareOnly(comparator);
        break;

      case "help":
        printHelp();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error: any) {
    console.error("Benchmark failed:", error.message);
    process.exit(1);
  }
}

/**
 * Run benchmarks and compare with baseline
 */
async function runBenchmarks(
  runner: BenchmarkRunner,
  comparator: BenchmarkComparator
) {
  console.log("Running performance benchmarks...\n");

  // Setup
  await runner.setup();

  // Run benchmarks
  const suite = await runner.runAll();

  // Save results
  const resultsFile = `benchmark-${Date.now()}.json`;
  runner.saveResults(suite, resultsFile);

  // Compare with baseline if it exists
  if (CI_CONFIG.compareWithBaseline) {
    const baseline = comparator.loadBaseline();

    if (baseline) {
      const comparison = comparator.compare(suite, baseline);
      comparator.saveComparison(comparison);

      // Generate markdown report
      const markdown = comparator.generateMarkdownReport(comparison);
      const fs = require("fs");
      const path = require("path");
      fs.writeFileSync(
        path.join("benchmarks/results", "comparison.md"),
        markdown
      );

      // Exit with error if regressions detected
      if (!comparison.passed) {
        console.error(
          "\n❌ Performance regressions detected! See comparison report for details."
        );
        process.exit(1);
      }
    } else {
      console.warn(
        "\n⚠ No baseline found. Run 'npm run benchmark:baseline' to create one."
      );
    }
  }

  // Update baseline if requested
  if (CI_CONFIG.updateBaseline) {
    comparator.saveBaseline(suite);
  }

  // Cleanup
  await runner.cleanup();

  console.log("\n✓ Benchmarks completed successfully");
}

/**
 * Create or update baseline
 */
async function createBaseline(
  runner: BenchmarkRunner,
  comparator: BenchmarkComparator
) {
  console.log("Creating performance baseline...\n");

  // Setup
  await runner.setup();

  // Run benchmarks
  const suite = await runner.runAll();

  // Save as baseline
  comparator.saveBaseline(suite);

  // Also save as regular result
  runner.saveResults(suite, `baseline-${Date.now()}.json`);

  // Cleanup
  await runner.cleanup();

  console.log("\n✓ Baseline created successfully");
}

/**
 * Compare existing results with baseline
 */
async function compareOnly(comparator: BenchmarkComparator) {
  console.log("Comparing with baseline...\n");

  const baseline = comparator.loadBaseline();
  if (!baseline) {
    console.error("❌ No baseline found. Run 'npm run benchmark:baseline' first.");
    process.exit(1);
  }

  // Load latest results
  const fs = require("fs");
  const path = require("path");
  const resultsDir = "benchmarks/results";
  const files = fs
    .readdirSync(resultsDir)
    .filter((f: string) => f.startsWith("benchmark-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error("❌ No benchmark results found. Run 'npm run benchmark' first.");
    process.exit(1);
  }

  const latestFile = path.join(resultsDir, files[0]);
  const current = JSON.parse(fs.readFileSync(latestFile, "utf-8"));

  const comparison = comparator.compare(current, baseline);
  comparator.saveComparison(comparison);

  // Generate markdown report
  const markdown = comparator.generateMarkdownReport(comparison);
  fs.writeFileSync(path.join(resultsDir, "comparison.md"), markdown);

  if (!comparison.passed) {
    console.error(
      "\n❌ Performance regressions detected! See comparison report for details."
    );
    process.exit(1);
  }

  console.log("\n✓ Comparison completed successfully");
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Performance Benchmark CLI

Usage:
  npm run benchmark [command]

Commands:
  run       Run benchmarks and compare with baseline (default)
  baseline  Create or update performance baseline
  compare   Compare latest results with baseline
  help      Show this help message

Examples:
  npm run benchmark              # Run benchmarks
  npm run benchmark:baseline     # Create baseline
  npm run benchmark:compare      # Compare with baseline

Environment Variables:
  BENCHMARK_BASE_URL            Base URL for API (default: http://localhost:3000)
  UPDATE_BASELINE               Set to 'true' to update baseline after run
  `);
}

// Run if called directly
if (require.main === module) {
  main();
}

export { BenchmarkRunner, BenchmarkComparator };
