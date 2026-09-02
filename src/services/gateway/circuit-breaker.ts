/**
 * Per-service circuit breaker for gateway calls (issue #860).
 *
 * `webhook-circuit-breaker.service` covers outbound webhooks and is keyed by
 * endpoint with its own persistence. This is the in-process equivalent for
 * service-to-service calls: the failure domain is a downstream service, and the
 * decision must be made on the request path with no I/O of its own.
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface BreakerOptions {
  /** Consecutive failures before opening. */
  failureThreshold: number;
  /** Successes in half-open before closing. */
  successThreshold: number;
  /** How long to stay open before probing. */
  openMs: number;
}

const DEFAULTS: BreakerOptions = {
  failureThreshold: 5,
  successThreshold: 2,
  openMs: 30_000,
};

interface BreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt: number;
}

const breakers = new Map<string, BreakerState>();

function stateFor(key: string): BreakerState {
  let state = breakers.get(key);
  if (!state) {
    state = { state: "closed", failures: 0, successes: 0, openedAt: 0 };
    breakers.set(key, state);
  }
  return state;
}

/**
 * Whether a call may proceed.
 *
 * Transitions open → half_open lazily on the next attempt rather than on a
 * timer, so an idle service does not need a background task to recover.
 */
export function canAttempt(key: string, options: Partial<BreakerOptions> = {}): boolean {
  const opts = { ...DEFAULTS, ...options };
  const state = stateFor(key);

  if (state.state === "closed") return true;

  if (state.state === "open") {
    if (Date.now() - state.openedAt >= opts.openMs) {
      state.state = "half_open";
      state.successes = 0;
      return true;
    }
    return false;
  }

  // half_open: allow probes through.
  return true;
}

export function recordSuccess(key: string, options: Partial<BreakerOptions> = {}): void {
  const opts = { ...DEFAULTS, ...options };
  const state = stateFor(key);

  if (state.state === "half_open") {
    state.successes += 1;
    if (state.successes >= opts.successThreshold) {
      state.state = "closed";
      state.failures = 0;
      state.successes = 0;
    }
    return;
  }

  state.failures = 0;
}

export function recordFailure(key: string, options: Partial<BreakerOptions> = {}): void {
  const opts = { ...DEFAULTS, ...options };
  const state = stateFor(key);

  // A failed probe re-opens immediately; a half-open circuit is not evidence
  // the downstream recovered, only that we were willing to find out.
  if (state.state === "half_open") {
    state.state = "open";
    state.openedAt = Date.now();
    state.failures = opts.failureThreshold;
    return;
  }

  state.failures += 1;
  if (state.failures >= opts.failureThreshold) {
    state.state = "open";
    state.openedAt = Date.now();
  }
}

export function circuitState(key: string): CircuitState {
  return stateFor(key).state;
}

export function resetCircuit(key?: string): void {
  if (key) breakers.delete(key);
  else breakers.clear();
}

export function snapshot(): Array<{ key: string; state: CircuitState; failures: number }> {
  return [...breakers.entries()].map(([key, s]) => ({
    key,
    state: s.state,
    failures: s.failures,
  }));
}
