/**
 * Performance Benchmark Comparator
 * Compares current benchmark results with baseline to detect regressions
 */

import * as fs from "fs";
import * as path from "path";
import { BenchmarkSuite, BenchmarkResult } from "./runner";
import { CI_CONFIG, GLOBAL_CONFIG } from "./config";

export interface ComparisonResult {
  endpoint: string;
  name: string;
  baseline: {
    p50: number;
    p95: number;
    p99: number;
  };
  current: {
    p50: number;
    p95: number;
    p99: number;
  };
  changes: {
    p50: {
      absolute: number;
      percent: number;
    };
    p95: {
      absolute: number;
      percent: number;
    };
    p99: {
      absolute: number;
      percent: number;
    };
  };
  status: "improved" | "stable" | "warning" | "regression";
  message: string;
}

export interface ComparisonSummary {
  timestamp: string;
  baselineFile: string;
  currentFile: string;
  comparisons: ComparisonResult[];
  summary: {
    total: number;
    improved: number;
    stable: number;
    warnings: number;
    regressions: number;
  };
  passed: boolean;
}

export class BenchmarkComparator {
  /**
   * Load baseline results
   */
  loadBaseline(filename?: string): BenchmarkSuite | null {
    const baselineDir = GLOBAL_CONFIG.baselineDir;
    const filepath = filename
      ? path.join(baselineDir, filename)
      : path.join(baselineDir, "baseline.json");

    if (!fs.existsSync(filepath)) {
      console.warn(`⚠ No baseline found at ${filepath}`);
      return null;
    }

    try {
      const content = fs.readFileSync(filepath, "utf-8");
      return JSON.parse(content);
    } catch (error: any) {
      console.error(`Failed to load baseline: ${error.message}`);
      return null;
    }
  }

  /**
   * Save current results as baseline
   */
  saveBaseline(suite: BenchmarkSuite, filename?: string): void {
    const baselineDir = GLOBAL_CONFIG.baselineDir;
    if (!fs.existsSync(baselineDir)) {
      fs.mkdirSync(baselineDir, { recursive: true });
    }

    const filepath = filename
      ? path.join(baselineDir, filename)
      : path.join(baselineDir, "baseline.json");

    fs.writeFileSync(filepath, JSON.stringify(suite, null, 2));
    console.log(`✓ Baseline saved to ${filepath}`);
  }

  /**
   * Compare current results with baseline
   */
  compare(
    current: BenchmarkSuite,
    baseline: BenchmarkSuite
  ): ComparisonSummary {
    const comparisons: ComparisonResult[] = [];

    // Create a map of baseline results by endpoint
    const baselineMap = new Map<string, BenchmarkResult>();
    baseline.results.forEach((result) => {
      baselineMap.set(result.endpoint, result);
    });

    // Compare each current result with baseline
    for (const currentResult of current.results) {
      const baselineResult = baselineMap.get(currentResult.endpoint);

      if (!baselineResult) {
        console.warn(
          `⚠ No baseline found for endpoint: ${currentResult.endpoint}`
        );
        continue;
      }

      const comparison = this.compareResults(currentResult, baselineResult);
      comparisons.push(comparison);
    }

    const summary = {
      total: comparisons.length,
      improved: comparisons.filter((c) => c.status === "improved").length,
      stable: comparisons.filter((c) => c.status === "stable").length,
      warnings: comparisons.filter((c) => c.status === "warning").length,
      regressions: comparisons.filter((c) => c.status === "regression").length,
    };

    const passed =
      !CI_CONFIG.failOnRegression || summary.regressions === 0;

    const comparisonSummary: ComparisonSummary = {
      timestamp: new Date().toISOString(),
      baselineFile: "baseline.json",
      currentFile: `benchmark-${Date.now()}.json`,
      comparisons,
      summary,
      passed,
    };

    this.printComparison(comparisonSummary);
    return comparisonSummary;
  }

  /**
   * Compare two benchmark results
   */
  private compareResults(
    current: BenchmarkResult,
    baseline: BenchmarkResult
  ): ComparisonResult {
    const changes = {
      p50: this.calculateChange(
        baseline.metrics.median,
        current.metrics.median
      ),
      p95: this.calculateChange(baseline.metrics.p95, current.metrics.p95),
      p99: this.calculateChange(baseline.metrics.p99, current.metrics.p99),
    };

    // Determine status based on p95 change (most important metric)
    let status: ComparisonResult["status"];
    let message: string;

    const p95Change = changes.p95.percent;
    const maxRegression = CI_CONFIG.maxRegressionPercent;
    const warnThreshold = CI_CONFIG.warnThresholdPercent;

    if (p95Change < -warnThreshold) {
      status = "improved";
      message = `Performance improved by ${Math.abs(p95Change).toFixed(1)}%`;
    } else if (p95Change > maxRegression) {
      status = "regression";
      message = `Performance regressed by ${p95Change.toFixed(1)}% (threshold: ${maxRegression}%)`;
    } else if (p95Change > warnThreshold) {
      status = "warning";
      message = `Performance degraded by ${p95Change.toFixed(1)}% (warning threshold: ${warnThreshold}%)`;
    } else {
      status = "stable";
      message = `Performance is stable (${p95Change >= 0 ? "+" : ""}${p95Change.toFixed(1)}%)`;
    }

    return {
      endpoint: current.endpoint,
      name: current.name,
      baseline: {
        p50: baseline.metrics.median,
        p95: baseline.metrics.p95,
        p99: baseline.metrics.p99,
      },
      current: {
        p50: current.metrics.median,
        p95: current.metrics.p95,
        p99: current.metrics.p99,
      },
      changes,
      status,
      message,
    };
  }

  /**
   * Calculate absolute and percentage change
   */
  private calculateChange(
    baseline: number,
    current: number
  ): { absolute: number; percent: number } {
    const absolute = current - baseline;
    const percent = baseline > 0 ? (absolute / baseline) * 100 : 0;

    return { absolute, percent };
  }

  /**
   * Print comparison results
   */
  private printComparison(summary: ComparisonSummary): void {
    console.log("\n" + "=".repeat(60));
    console.log("PERFORMANCE COMPARISON");
    console.log("=".repeat(60));

    for (const comparison of summary.comparisons) {
      const statusSymbol = {
        improved: "↑",
        stable: "→",
        warning: "⚠",
        regression: "↓",
      }[comparison.status];

      const statusColor = {
        improved: "\x1b[32m", // Green
        stable: "\x1b[37m", // White
        warning: "\x1b[33m", // Yellow
        regression: "\x1b[31m", // Red
      }[comparison.status];

      const resetColor = "\x1b[0m";

      console.log(
        `\n${statusColor}${statusSymbol} ${comparison.name}${resetColor}`
      );
      console.log(`  ${comparison.message}`);
      console.log(
        `  P50: ${comparison.baseline.p50.toFixed(2)}ms → ${comparison.current.p50.toFixed(2)}ms (${comparison.changes.p50.percent >= 0 ? "+" : ""}${comparison.changes.p50.percent.toFixed(1)}%)`
      );
      console.log(
        `  P95: ${comparison.baseline.p95.toFixed(2)}ms → ${comparison.current.p95.toFixed(2)}ms (${comparison.changes.p95.percent >= 0 ? "+" : ""}${comparison.changes.p95.percent.toFixed(1)}%)`
      );
      console.log(
        `  P99: ${comparison.baseline.p99.toFixed(2)}ms → ${comparison.current.p99.toFixed(2)}ms (${comparison.changes.p99.percent >= 0 ? "+" : ""}${comparison.changes.p99.percent.toFixed(1)}%)`
      );
    }

    console.log("\n" + "=".repeat(60));
    console.log("COMPARISON SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total Endpoints: ${summary.summary.total}`);
    console.log(`Improved: ${summary.summary.improved}`);
    console.log(`Stable: ${summary.summary.stable}`);
    console.log(`Warnings: ${summary.summary.warnings}`);
    console.log(`Regressions: ${summary.summary.regressions}`);
    console.log(
      `Status: ${summary.passed ? "\x1b[32m✓ PASSED\x1b[0m" : "\x1b[31m✗ FAILED\x1b[0m"}`
    );
    console.log("=".repeat(60));
  }

  /**
   * Save comparison results
   */
  saveComparison(summary: ComparisonSummary, filename?: string): void {
    const outputDir = GLOBAL_CONFIG.outputDir;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filepath = path.join(
      outputDir,
      filename || `comparison-${Date.now()}.json`
    );

    fs.writeFileSync(filepath, JSON.stringify(summary, null, 2));
    console.log(`\n✓ Comparison saved to ${filepath}`);
  }

  /**
   * Generate markdown report
   */
  generateMarkdownReport(summary: ComparisonSummary): string {
    let markdown = "# Performance Benchmark Comparison\n\n";
    markdown += `**Date**: ${new Date(summary.timestamp).toLocaleString()}\n\n`;
    markdown += `**Status**: ${summary.passed ? "✅ PASSED" : "❌ FAILED"}\n\n`;

    markdown += "## Summary\n\n";
    markdown += "| Metric | Count |\n";
    markdown += "|--------|-------|\n";
    markdown += `| Total Endpoints | ${summary.summary.total} |\n`;
    markdown += `| Improved | ${summary.summary.improved} |\n`;
    markdown += `| Stable | ${summary.summary.stable} |\n`;
    markdown += `| Warnings | ${summary.summary.warnings} |\n`;
    markdown += `| Regressions | ${summary.summary.regressions} |\n\n`;

    markdown += "## Detailed Results\n\n";
    markdown += "| Endpoint | Status | P50 | P95 | P99 | Message |\n";
    markdown += "|----------|--------|-----|-----|-----|----------|\n";

    for (const comparison of summary.comparisons) {
      const statusEmoji = {
        improved: "🟢",
        stable: "⚪",
        warning: "🟡",
        regression: "🔴",
      }[comparison.status];

      const p50Change = comparison.changes.p50.percent;
      const p95Change = comparison.changes.p95.percent;
      const p99Change = comparison.changes.p99.percent;

      markdown += `| ${comparison.name} | ${statusEmoji} ${comparison.status} | `;
      markdown += `${comparison.current.p50.toFixed(0)}ms (${p50Change >= 0 ? "+" : ""}${p50Change.toFixed(1)}%) | `;
      markdown += `${comparison.current.p95.toFixed(0)}ms (${p95Change >= 0 ? "+" : ""}${p95Change.toFixed(1)}%) | `;
      markdown += `${comparison.current.p99.toFixed(0)}ms (${p99Change >= 0 ? "+" : ""}${p99Change.toFixed(1)}%) | `;
      markdown += `${comparison.message} |\n`;
    }

    return markdown;
  }
}
