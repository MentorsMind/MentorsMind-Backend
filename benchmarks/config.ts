/**
 * Performance Benchmark Configuration
 * Defines baseline metrics and thresholds for critical endpoints
 */

export interface BenchmarkThreshold {
  p50: number; // 50th percentile (median) in ms
  p95: number; // 95th percentile in ms
  p99: number; // 99th percentile in ms
  maxRegressionPercent: number; // Maximum allowed regression percentage
}

export interface EndpointBenchmark {
  name: string;
  method: string;
  path: string;
  thresholds: BenchmarkThreshold;
  warmupRequests?: number;
  benchmarkRequests?: number;
}

/**
 * Baseline performance targets for critical endpoints
 * These are established based on initial benchmarking and business requirements
 */
export const BENCHMARK_CONFIG: Record<string, EndpointBenchmark> = {
  // Auth Endpoints
  "auth.register": {
    name: "User Registration",
    method: "POST",
    path: "/api/auth/register",
    thresholds: {
      p50: 150, // 150ms median
      p95: 300, // 300ms p95
      p99: 500, // 500ms p99
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },
  "auth.login": {
    name: "User Login",
    method: "POST",
    path: "/api/auth/login",
    thresholds: {
      p50: 100,
      p95: 200,
      p99: 350,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },
  "auth.refresh": {
    name: "Token Refresh",
    method: "POST",
    path: "/api/auth/refresh",
    thresholds: {
      p50: 50,
      p95: 100,
      p99: 150,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },
  "auth.me": {
    name: "Get Current User",
    method: "GET",
    path: "/api/auth/me",
    thresholds: {
      p50: 30,
      p95: 75,
      p99: 120,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },

  // Search Endpoints
  "search.mentors": {
    name: "Search Mentors",
    method: "GET",
    path: "/api/v1/search/mentors?query=javascript&page=1&limit=20",
    thresholds: {
      p50: 100,
      p95: 250,
      p99: 400,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },
  "search.mentors.filter": {
    name: "Search Mentors with Filters",
    method: "GET",
    path: "/api/v1/search/mentors?query=python&skills=backend&experience=senior&page=1&limit=20",
    thresholds: {
      p50: 150,
      p95: 350,
      p99: 550,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },
  "mentors.list": {
    name: "List Mentors",
    method: "GET",
    path: "/api/mentors?page=1&limit=20",
    thresholds: {
      p50: 80,
      p95: 200,
      p99: 350,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },

  // Payment Endpoints
  "payments.initiate": {
    name: "Initiate Payment",
    method: "POST",
    path: "/api/payments/initiate",
    thresholds: {
      p50: 200,
      p95: 400,
      p99: 600,
      maxRegressionPercent: 10,
    },
    warmupRequests: 5,
    benchmarkRequests: 50,
  },
  "payments.status": {
    name: "Get Payment Status",
    method: "GET",
    path: "/api/payments/:id/status",
    thresholds: {
      p50: 50,
      p95: 120,
      p99: 200,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },
  "payments.list": {
    name: "List User Payments",
    method: "GET",
    path: "/api/payments?page=1&limit=20",
    thresholds: {
      p50: 80,
      p95: 180,
      p99: 300,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },
  "payments.quote": {
    name: "Get Payment Quote",
    method: "GET",
    path: "/api/payments/quote?amount=100&currency=XLM",
    thresholds: {
      p50: 100,
      p95: 250,
      p99: 400,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },

  // Booking Endpoints
  "bookings.create": {
    name: "Create Booking",
    method: "POST",
    path: "/api/bookings",
    thresholds: {
      p50: 150,
      p95: 350,
      p99: 550,
      maxRegressionPercent: 10,
    },
    warmupRequests: 5,
    benchmarkRequests: 50,
  },
  "bookings.list": {
    name: "List User Bookings",
    method: "GET",
    path: "/api/bookings?page=1&limit=20",
    thresholds: {
      p50: 70,
      p95: 160,
      p99: 280,
      maxRegressionPercent: 10,
    },
    warmupRequests: 10,
    benchmarkRequests: 100,
  },
};

/**
 * Global benchmark configuration
 */
export const GLOBAL_CONFIG = {
  baseUrl: process.env.BENCHMARK_BASE_URL || "http://localhost:3000",
  warmupRequests: 10,
  benchmarkRequests: 100,
  concurrency: 1, // Sequential requests for accurate timing
  timeout: 30000, // 30 seconds
  retries: 3,
  outputDir: "benchmarks/results",
  baselineDir: "benchmarks/baseline",
};

/**
 * CI/CD Configuration
 */
export const CI_CONFIG = {
  failOnRegression: true,
  maxRegressionPercent: 10, // Fail if p95 increases by more than 10%
  warnOnRegression: true,
  warnThresholdPercent: 5, // Warn if p95 increases by more than 5%
  compareWithBaseline: true,
  updateBaseline: process.env.UPDATE_BASELINE === "true",
};
