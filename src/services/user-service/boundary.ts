/**
 * user-service boundary (issue #860).
 *
 * A boundary is a claim about ownership: which tables this service writes,
 * which routes it serves, and what other services may ask of it. Declaring it
 * in code — before any process is split out — is what makes the migration
 * reviewable, because the first question about any extraction is "what does it
 * own?" and the second is "who reads that today?".
 */

import type { ServiceDefinition } from "../gateway/service-registry";

/** Tables this service owns. No other service may write them. */
export const OWNED_TABLES = [
  "users",
  "user_profiles",
  "user_settings",
  "user_sessions",
] as const;

/**
 * Tables read but not owned.
 *
 * Each of these is a coupling that must become an API call before the service
 * can have its own database. Listed explicitly so the debt is visible rather
 * than discovered during the cutover.
 */
export const READ_DEPENDENCIES = ["roles", "permissions"] as const;

/** Routes that move to this service when it is registered. */
export const OWNED_PREFIXES = ["/api/users", "/api/profiles"] as const;

/** Synchronous calls this service makes to others. Keep this list short. */
export const UPSTREAM_CALLS: string[] = [];

/** Events published for other services to consume. */
export const PUBLISHED_EVENTS = [
  "user.created",
  "user.updated",
  "user.deleted",
] as const;

export function definition(instances: string[]): ServiceDefinition {
  return {
    name: "user-service",
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
