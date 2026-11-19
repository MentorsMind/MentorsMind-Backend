/**
 * payment-service boundary (issue #860).
 *
 * Extracted first in most migrations, for a reason that is not about load: it
 * has the strictest correctness requirements and the clearest audit boundary,
 * so isolating it shrinks the surface that can corrupt money.
 *
 * Its writes must stay idempotent under retry — the gateway retries, and a
 * duplicated charge is not recoverable by apologising.
 */

import type { ServiceDefinition } from "../gateway/service-registry";

export const OWNED_TABLES = [
  "payments",
  "payment_intents",
  "payouts",
  "refunds",
  "ledger_entries",
] as const;

/** Booking context is needed to price and attribute a payment. */
export const READ_DEPENDENCIES = ["bookings"] as const;

export const OWNED_PREFIXES = ["/api/payments", "/api/payouts"] as const;

export const UPSTREAM_CALLS: string[] = [];

export const PUBLISHED_EVENTS = [
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment.refunded",
] as const;

/**
 * Every write endpoint must accept an idempotency key.
 *
 * Declared on the boundary rather than left to each handler, because the
 * gateway's fallback and retry behaviour makes duplicate delivery a normal
 * event, not an exceptional one.
 */
export const REQUIRES_IDEMPOTENCY_KEY = true;

export function definition(instances: string[]): ServiceDefinition {
  return {
    name: "payment-service",
    prefixes: [...OWNED_PREFIXES],
    healthPath: "/health",
    unhealthyThreshold: 2,
    instances: instances.map((url) => ({
      url: url.replace(/\/$/, ""),
      healthy: true,
      consecutiveFailures: 0,
      lastCheckedAt: 0,
    })),
  };
}

export default definition;
