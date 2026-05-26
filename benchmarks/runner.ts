/**
 * Performance Benchmark Runner
 * Executes benchmarks and collects performance metrics
 */

import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import {
  BENCHMARK_CONFIG,
  GLOBAL_CONFIG,
  EndpointBenchmark,
} from "./config";

export interface BenchmarkResult {
  endpoint: string;
  name: string;
  method: string;
  path: string;
  timestamp: string;
  metrics: {
    count: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    p95: number;
    p99: number;
    stdDev: number;
  };
  thresholds: {
    p50: number;
    p95: number;
    p99: number;
  };
  passed: boolean;
  failures: number;
  errors: string[];
}

export interface BenchmarkSuite {
  timestamp: string;
  duration: number;
  results: BenchmarkResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    totalRequests: number;
    totalFailures: number;
  };
}

export class BenchmarkRunner {
  private baseUrl: string;
  private authToken?: string;
  private userId?: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || GLOBAL_CONFIG.baseUrl;
  }

  /**
   * Setup authentication for protected endpoints
   */
  async setup(): Promise<void> {
    try {
      // Register a test user
      const registerRes = await axios.post(`${this.baseUrl}/api/auth/register`, {
        email: `benchmark-${Date.now()}@test.com`,
        password: "BenchmarkPassword123!",
        firstName: "Benchmark",
        lastName: "User",
        role: "mentee",
      });

      this.authToken = registerRes.data.data.accessToken;
      this.userId = registerRes.data.data.userId;

      console.log("✓ Benchmark user authenticated");
    } catch (error: any) {
      console.error("Failed to setup benchmark user:", error.message);
      throw error;
    }
  }

  /**
   * Cleanup benchmark resources
   */
  async cleanup(): Promise<void> {
    // Cleanup is handled by database reset in test environment
    console.log("✓ Benchmark cleanup complete");
  }

  /**
   * Execute a single benchmark
   */
  async runBenchmark(
    config: EndpointBenchmark
  ): Promise<BenchmarkResult> {
    console.log(`\nRunning benchmark: ${config.name}`);

    const warmupCount = config.warmupRequests || GLOBAL_CONFIG.warmupRequests;
    const benchmarkCount =
      config.benchmarkRequests || GLOBAL_CONFIG.benchmarkRequests;

    // Warmup phase
    console.log(`  Warming up (${warmupCount} requests)...`);
    for (let i = 0; i < warmupCount; i++) {
      try {
        await this.makeRequest(config);
      } catch (error) {
        // Ignore warmup errors
      }
    }

    // Benchmark phase
    console.log(`  Benchmarking (${benchmarkCount} requests)...`);
    const durations: number[] = [];
    const errors: string[] = [];
    let failures = 0;

    for (let i = 0; i < benchmarkCount; i++) {
      try {
        const duration = await this.makeRequest(config);
        durations.push(duration);
      } catch (error: any) {
        failures++;
        if (errors.length < 5) {
          // Store first 5 errors
          errors.push(error.message);
        }
      }
    }

    // Calculate statistics
    const metrics = this.calculateMetrics(durations);
    const passed = this.checkThresholds(metrics, config.thresholds);

    const result: BenchmarkResult = {
      endpoint: config.name.toLowerCase().replace(/\s+/g, "."),
      name: config.name,
      method: config.method,
      path: config.path,
      timestamp: new Date().toISOString(),
      metrics,
      thresholds: config.thresholds,
      passed,
      failures,
      errors,
    };

    this.printResult(result);
    return result;
  }

  /**
   * Make a single HTTP request and measure duration
   */
  private async makeRequest(config: EndpointBenchmark): Promise<number> {
    const requestConfig: AxiosRequestConfig = {
      method: config.method as any,
      url: `${this.baseUrl}${config.path}`,
      timeout: GLOBAL_CONFIG.timeout,
      headers: {},
    };

    // Add authentication if available
    if (this.authToken) {
      requestConfig.headers!["Authorization"] = `Bearer ${this.authToken}`;
    }

    // Add request body for POST/PUT requests
    if (config.method === "POST" || config.method === "PUT") {
      requestConfig.data = this.getRequestBody(config);
    }

    // Replace path parameters
    if (config.path.includes(":id") && this.userId) {
      requestConfig.url = requestConfig.url!.replace(":id", this.userId);
    }

    const startTime = performance.now();
    await axios(requestConfig);
    const endTime = performance.now();

    return endTime - startTime;
  }

  /**
   * Get request body for POST/PUT requests
   */
  private getRequestBody(config: EndpointBenchmark): any {
    const bodies: Record<string, any> = {
      "/api/auth/register": {
        email: `test-${Date.now()}@example.com`,
        password: "TestPassword123!",
        firstName: "Test",
        lastName: "User",
        role: "mentee",
      },
      "/api/auth/login": {
        email: `benchmark-${Date.now()}@test.com`,
        password: "BenchmarkPassword123!",
      },
      "/api/payments/initiate": {
        bookingId: "00000000-0000-0000-0000-000000000001",
        amount: "100.0000000",
        currency: "XLM",
      },
      "/api/bookings": {
        mentorId: "00000000-0000-0000-0000-000000000002",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        durationMinutes: 60,
        topic: "Benchmark Session",
      },
    };

    return bodies[config.path] || {};
  }

  /**
   * Calculate performance metrics from durations
   */
  private calculateMetrics(durations: number[]): BenchmarkResult["metrics"] {
    if (durations.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        p95: 0,
        p99: 0,
        stdDev: 0,
      };
    }

    const sorted = durations.slice().sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / count;

    // Calculate standard deviation
    const variance =
      sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
    const stdDev = Math.sqrt(variance);

    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      mean,
      median: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      stdDev,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (lower === upper) {
      return sorted[lower];
    }

    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Check if metrics meet thresholds
   */
  private checkThresholds(
    metrics: BenchmarkResult["metrics"],
    thresholds: EndpointBenchmark["thresholds"]
  ): boolean {
    return (
      metrics.median <= thresholds.p50 &&
      metrics.p95 <= thresholds.p95 &&
      metrics.p99 <= thresholds.p99
    );
  }

  /**
   * Print benchmark result
   */
  private printResult(result: BenchmarkResult): void {
    const status = result.passed ? "✓ PASS" : "✗ FAIL";
    const statusColor = result.passed ? "\x1b[32m" : "\x1b[31m";
    const resetColor = "\x1b[0m";

    console.log(`  ${statusColor}${status}${resetColor}`);
    console.log(`  Requests: ${result.metrics.count}`);
    console.log(`  Failures: ${result.failures}`);
    console.log(`  Median: ${result.metrics.median.toFixed(2)}ms (threshold: ${result.thresholds.p50}ms)`);
    console.log(`  P95: ${result.metrics.p95.toFixed(2)}ms (threshold: ${result.thresholds.p95}ms)`);
    console.log(`  P99: ${result.metrics.p99.toFixed(2)}ms (threshold: ${result.thresholds.p99}ms)`);

    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.join(", ")}`);
    }
  }

  /**
   * Run all benchmarks
   */
  async runAll(): Promise<BenchmarkSuite> {
    const startTime = performance.now();
    const results: BenchmarkResult[] = [];

    console.log("Starting performance benchmarks...\n");

    for (const [key, config] of Object.entries(BENCHMARK_CONFIG)) {
      try {
        const result = await this.runBenchmark(config);
        results.push(result);
      } catch (error: any) {
        console.error(`Failed to run benchmark ${key}:`, error.message);
      }
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    const summary = {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      totalRequests: results.reduce((sum, r) => sum + r.metrics.count, 0),
      totalFailures: results.reduce((sum, r) => sum + r.failures, 0),
    };

    const suite: BenchmarkSuite = {
      timestamp: new Date().toISOString(),
      duration,
      results,
      summary,
    };

    this.printSummary(suite);
    return suite;
  }

  /**
   * Print benchmark suite summary
   */
  private printSummary(suite: BenchmarkSuite): void {
    console.log("\n" + "=".repeat(60));
    console.log("BENCHMARK SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total Benchmarks: ${suite.summary.total}`);
    console.log(`Passed: ${suite.summary.passed}`);
    console.log(`Failed: ${suite.summary.failed}`);
    console.log(`Total Requests: ${suite.summary.totalRequests}`);
    console.log(`Total Failures: ${suite.summary.totalFailures}`);
    console.log(`Duration: ${(suite.duration / 1000).toFixed(2)}s`);
    console.log("=".repeat(60));
  }

  /**
   * Save results to file
   */
  saveResults(suite: BenchmarkSuite, filename?: string): void {
    const outputDir = GLOBAL_CONFIG.outputDir;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filepath = path.join(
      outputDir,
      filename || `benchmark-${Date.now()}.json`
    );

    fs.writeFileSync(filepath, JSON.stringify(suite, null, 2));
    console.log(`\n✓ Results saved to ${filepath}`);
  }
}
