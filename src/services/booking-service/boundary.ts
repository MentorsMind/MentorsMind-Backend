/**
 * booking-service boundary (issue #860).
 *
 * Bookings are the busiest write path and the natural second extraction: they
 * are read-heavy for mentees, write-heavy around session times, and their load
 * profile does not resemble the rest of the monolith.
 */

import type { ServiceDefinition } from "../gateway/service-registry";

export const OWNED_TABLES = [
  "bookings",
  "availability_slots",
  "session_notes",
  "booking_cancellations",
] as const;

/**
 * `users` is read on nearly every booking query for display purposes. That is
 * the single largest obstacle to giving this service its own database, and the
 * intended fix is a denormalised mentor/mentee projection kept current from
 * `user.updated`, not a cross-database join.
 */
export const READ_DEPENDENCIES = ["users", "user_profiles"] as const;

export const OWNED_PREFIXES = ["/api/bookings", "/api/availability"] as const;

/** Payment authorisation is synchronous at booking time. */
export const UPSTREAM_CALLS = ["payment-service"] as const;

export const PUBLISHED_EVENTS = [
  "booking.created",
  "booking.confirmed",
  "booking.cancelled",
  "booking.completed",
] as const;

export function definition(instances: string[]): ServiceDefinition {
  return {
    name: "booking-service",
    prefixes: [...OWNED_PREFIXES],
    healthPath: "/health",
    unhealthyThreshold: 3,
    instances: instances.map((url) => ({
      url: url.replace(/\/$/, ""),
      healthy: true,
      consecutiveFailures: 0,
      lastCheckedAt: 0,
    })),
  };
}

export default definition;
