/**
 * SLI/SLO Configuration
 *
 * Defines Service Level Indicators (SLIs) and Service Level Objectives (SLOs)
 * for critical business services. SLIs are measured via Prometheus metrics,
 * and SLOs define acceptable thresholds for alerting and escalation.
 *
 * SLI Categories:
 *   - Availability: percentage of time service is responding
 *   - Latency: percentage of requests meeting response time targets
 *   - Error Rate: percentage of successful requests
 *   - Throughput: requests processed per second
 */

export interface SLI {
  name: string;
  description: string;
  unit: "percent" | "seconds" | "requests_per_second" | "ratio";
  window: "1m" | "5m" | "15m" | "30m" | "1h";
}

export interface SLO {
  sli: string;
  target: number; // percentage or absolute value
  window: "30d" | "90d";
  severity: "critical" | "major" | "minor";
  description: string;
}

// ─── SLIs ─────────────────────────────────────────────────────────────────────

export const slis = {
  // Availability SLIs
  apiAvailability: {
    name: "api_availability",
    description: "Percentage of API requests that receive a response (not timeout)",
    unit: "percent",
    window: "5m",
  } as SLI,

  databaseAvailability: {
    name: "database_availability",
    description: "Percentage of database queries that complete successfully",
    unit: "percent",
    window: "5m",
  } as SLI,

  // Latency SLIs
  apiLatencyP50: {
    name: "api_latency_p50",
    description: "50th percentile of API request latency",
    unit: "seconds",
    window: "5m",
  } as SLI,

  apiLatencyP95: {
    name: "api_latency_p95",
    description: "95th percentile of API request latency",
    unit: "seconds",
    window: "5m",
  } as SLI,

  apiLatencyP99: {
    name: "api_latency_p99",
    description: "99th percentile of API request latency",
    unit: "seconds",
    window: "5m",
  } as SLI,

  databaseLatencyP95: {
    name: "database_latency_p95",
    description: "95th percentile of database query latency",
    unit: "seconds",
    window: "5m",
  } as SLI,

  // Error Rate SLIs
  apiErrorRate: {
    name: "api_error_rate",
    description: "Percentage of API requests resulting in 5xx errors",
    unit: "percent",
    window: "5m",
  } as SLI,

  authenticationErrorRate: {
    name: "authentication_error_rate",
    description: "Percentage of authentication failures",
    unit: "percent",
    window: "5m",
  } as SLI,

  paymentErrorRate: {
    name: "payment_error_rate",
    description: "Percentage of payment processing failures",
    unit: "percent",
    window: "5m",
  } as SLI,

  stellarTransactionErrorRate: {
    name: "stellar_transaction_error_rate",
    description: "Percentage of Stellar transaction failures",
    unit: "percent",
    window: "5m",
  } as SLI,

  // Throughput SLIs
  apiThroughput: {
    name: "api_throughput",
    description: "API requests processed per second",
    unit: "requests_per_second",
    window: "1m",
  } as SLI,

  // Data Quality SLIs
  notificationDeliverySuccessRate: {
    name: "notification_delivery_success_rate",
    description: "Percentage of notifications successfully delivered",
    unit: "percent",
    window: "15m",
  } as SLI,

  webhookDeliverySuccessRate: {
    name: "webhook_delivery_success_rate",
    description: "Percentage of webhooks successfully delivered",
    unit: "percent",
    window: "15m",
  } as SLI,
};

// ─── SLOs ─────────────────────────────────────────────────────────────────────

export const slos: SLO[] = [
  // Availability SLOs
  {
    sli: slis.apiAvailability.name,
    target: 99.5,
    window: "30d",
    severity: "critical",
    description: "API must be available 99.5% of the time (30d rolling window)",
  },
  {
    sli: slis.databaseAvailability.name,
    target: 99.9,
    window: "30d",
    severity: "critical",
    description: "Database must be available 99.9% of the time",
  },

  // Latency SLOs
  {
    sli: slis.apiLatencyP50.name,
    target: 0.1, // 100ms
    window: "30d",
    severity: "major",
    description: "50% of requests should complete in ≤100ms",
  },
  {
    sli: slis.apiLatencyP95.name,
    target: 0.5, // 500ms
    window: "30d",
    severity: "major",
    description: "95% of requests should complete in ≤500ms",
  },
  {
    sli: slis.apiLatencyP99.name,
    target: 1.0, // 1s
    window: "30d",
    severity: "minor",
    description: "99% of requests should complete in ≤1s",
  },
  {
    sli: slis.databaseLatencyP95.name,
    target: 0.1, // 100ms
    window: "30d",
    severity: "major",
    description: "95% of queries should complete in ≤100ms",
  },

  // Error Rate SLOs
  {
    sli: slis.apiErrorRate.name,
    target: 0.1, // 0.1%
    window: "30d",
    severity: "critical",
    description: "Error rate must stay below 0.1%",
  },
  {
    sli: slis.authenticationErrorRate.name,
    target: 0.5, // 0.5%
    window: "30d",
    severity: "major",
    description: "Authentication error rate must stay below 0.5%",
  },
  {
    sli: slis.paymentErrorRate.name,
    target: 0.01, // 0.01%
    window: "30d",
    severity: "critical",
    description: "Payment error rate must be near zero (< 0.01%)",
  },
  {
    sli: slis.stellarTransactionErrorRate.name,
    target: 0.5, // 0.5%
    window: "30d",
    severity: "major",
    description: "Stellar transaction error rate must stay below 0.5%",
  },

  // Throughput SLOs
  {
    sli: slis.apiThroughput.name,
    target: 100, // 100 req/s minimum
    window: "30d",
    severity: "minor",
    description: "System should sustain at least 100 req/s",
  },

  // Data Quality SLOs
  {
    sli: slis.notificationDeliverySuccessRate.name,
    target: 95.0, // 95%
    window: "30d",
    severity: "major",
    description: "Notifications should be delivered successfully 95% of the time",
  },
  {
    sli: slis.webhookDeliverySuccessRate.name,
    target: 99.0, // 99%
    window: "30d",
    severity: "major",
    description: "Webhooks should be delivered successfully 99% of the time",
  },
];

/**
 * Error Budget calculations
 * Shows how much downtime/error budget is available for maintenance/deployment
 */
export function calculateErrorBudget(slo: SLO, timeWindowSeconds: number): {
  totalSeconds: number;
  allowedViolationSeconds: number;
  allowedViolationPercent: number;
} {
  return {
    totalSeconds: timeWindowSeconds,
    allowedViolationSeconds: timeWindowSeconds * (100 - slo.target) / 100,
    allowedViolationPercent: 100 - slo.target,
  };
}

/**
 * Convert SLI target to alert threshold
 * If SLO target is 99.5% availability, alert at 98% (giving 1.5% buffer)
 */
export function calculateAlertThreshold(slo: SLO, buffer: number = 1.0): number {
  return slo.target - buffer;
}

// ─── SLI Metrics Mapping ───────────────────────────────────────────────────────

export const sliMetricsMapping = {
  api_availability: {
    query: `(1 - (sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])))) * 100`,
    description: "Derived from HTTP request metrics",
  },
  database_availability: {
    query: `(1 - (sum(rate(db_query_duration_seconds_count{status="error"}[5m])) / sum(rate(db_query_duration_seconds_count[5m])))) * 100`,
    description: "Derived from database query metrics",
  },
  api_latency_p50: {
    query: `histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`,
    description: "50th percentile of HTTP request duration",
  },
  api_latency_p95: {
    query: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`,
    description: "95th percentile of HTTP request duration",
  },
  api_latency_p99: {
    query: `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`,
    description: "99th percentile of HTTP request duration",
  },
  database_latency_p95: {
    query: `histogram_quantile(0.95, sum(rate(db_query_duration_seconds_bucket[5m])) by (le))`,
    description: "95th percentile of database query duration",
  },
  api_error_rate: {
    query: `(sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))) * 100`,
    description: "Percentage of 5xx errors",
  },
  authentication_error_rate: {
    query: `(sum(rate(http_requests_total{path=~"/auth/.*", status_code=~"401|403"}[5m])) / sum(rate(http_requests_total{path=~"/auth/.*"}[5m]))) * 100`,
    description: "Auth failure rate",
  },
  payment_error_rate: {
    query: `(sum(rate(http_requests_total{path=~"/payments.*", status_code=~"5.."}[5m])) / sum(rate(http_requests_total{path=~"/payments.*"}[5m]))) * 100`,
    description: "Payment endpoint error rate",
  },
  stellar_transaction_error_rate: {
    query: `(sum(rate(stellar_api_calls_total{status="error"}[5m])) / sum(rate(stellar_api_calls_total[5m]))) * 100`,
    description: "Stellar API failure rate",
  },
  api_throughput: {
    query: `sum(rate(http_requests_total[1m]))`,
    description: "Requests per second",
  },
  notification_delivery_success_rate: {
    query: `(sum(rate(notification_delivery_attempts_total{status="sent"}[15m])) / sum(rate(notification_delivery_attempts_total[15m]))) * 100`,
    description: "Notification delivery success rate",
  },
  webhook_delivery_success_rate: {
    query: `(sum(rate(webhook_delivery_attempts_total{status="success"}[15m])) / sum(rate(webhook_delivery_attempts_total[15m]))) * 100`,
    description: "Webhook delivery success rate",
  },
};

export default {
  slis,
  slos,
  calculateErrorBudget,
  calculateAlertThreshold,
  sliMetricsMapping,
};
