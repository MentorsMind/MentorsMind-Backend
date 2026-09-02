/**
 * Per-service circuit breaker
 *
 * Guards upstream services from a thundering herd of doomed requests. After
 * `failureThreshold` consecutive failures the circuit opens and requests are
 * rejected immediately for `resetTimeoutMs`, after which a single trial request
 * is allowed (half-open). A success closes the circuit; a failure re-opens it.
 */

import type { CircuitState } from "./types";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private tripCount = 0;

  constructor(private readonly opts: CircuitBreakerOptions) {}

  /** Whether a request may proceed right now. Mutates state on transition. */
  canRequest(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.opts.resetTimeoutMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }

    // half-open: allow the single trial request through
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === "half-open") {
      this.open();
      return;
    }
    if (this.failures >= this.opts.failureThreshold) {
      this.open();
    }
  }

  getState(): CircuitState {
    // Surface the lazy open -> half-open transition to observers.
    if (
      this.state === "open" &&
      Date.now() - this.openedAt >= this.opts.resetTimeoutMs
    ) {
      return "half-open";
    }
    return this.state;
  }

  getTripCount(): number {
    return this.tripCount;
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedAt = 0;
  }

  private open(): void {
    if (this.state !== "open") this.tripCount += 1;
    this.state = "open";
    this.openedAt = Date.now();
  }
}
