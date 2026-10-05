/**
 * Per-endpoint webhook circuit breaker (issue #783).
 *
 * A single misbehaving subscriber endpoint should never be able to starve
 * delivery to healthy endpoints. This tracks failures per destination URL in
 * Redis using a sliding 5-minute window: after 5 failures in 5 minutes the
 * circuit opens and new deliveries to that URL are deferred for 5 minutes
 * instead of being attempted (and blocking a worker slot on a slow/dead
 * endpoint). After the open period elapses, exactly one "probe" delivery is
 * allowed through (half-open) — if it succeeds the circuit closes, if it
 * fails the circuit re-opens for another 5-minute window.
 */
import crypto from 'crypto';
import { redis } from '../config/redis';
import { Logger } from "../utils/logger.utils";
import { webhookCircuitBreakerState } from '../config/metrics';

const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_SECONDS = 300;
const HALF_OPEN_GRACE_SECONDS = 300;

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitCheckResult {
  state: CircuitState;
  /** Whether the caller may proceed with a real delivery attempt right now. */
  allowed: boolean;
  /** Whether this attempt is the single half-open probe. */
  isProbe: boolean;
}

export interface CircuitStatus {
  state: CircuitState;
  failures: number;
  lastFailureAt: string | null;
}

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').substring(0, 16);
}

function keysFor(hash: string) {
  return {
    failures: `webhook:circuit:${hash}:failures`,
    open: `webhook:circuit:${hash}:open`,
    halfOpen: `webhook:circuit:${hash}:halfopen`,
    probe: `webhook:circuit:${hash}:probe`,
  };
}

function gaugeValue(state: CircuitState): number {
  return state === 'open' ? 1 : state === 'half_open' ? 2 : 0;
}

export const WebhookCircuitBreaker = {
  hashUrl,

  /**
   * Checks whether a delivery attempt to `url` is currently allowed and,
   * if the circuit is half-open, atomically claims the single probe slot.
   */
  async check(url: string): Promise<CircuitCheckResult> {
    const hash = hashUrl(url);
    const k = keysFor(hash);

    const openTtl = await redis.ttl(k.open);
    if (openTtl > 0) {
      webhookCircuitBreakerState.labels(hash).set(gaugeValue('open'));
      return { state: 'open', allowed: false, isProbe: false };
    }

    const halfOpenTtl = await redis.ttl(k.halfOpen);
    if (halfOpenTtl > 0) {
      webhookCircuitBreakerState.labels(hash).set(gaugeValue('half_open'));
      const claimed = await redis.set(k.probe, '1', 'EX', halfOpenTtl, 'NX');
      return { state: 'half_open', allowed: claimed === 'OK', isProbe: claimed === 'OK' };
    }

    webhookCircuitBreakerState.labels(hash).set(gaugeValue('closed'));
    return { state: 'closed', allowed: true, isProbe: false };
  },

  /** Feeds the outcome of an allowed delivery attempt back into the circuit. */
  async reportOutcome(url: string, success: boolean): Promise<void> {
    const hash = hashUrl(url);
    const k = keysFor(hash);
    const wasProbing = (await redis.get(k.probe)) === '1';

    if (success) {
      if (wasProbing) {
        await redis.del(k.open, k.halfOpen, k.probe, k.failures);
        webhookCircuitBreakerState.labels(hash).set(gaugeValue('closed'));
        logger.info('Webhook circuit breaker closed after successful half-open probe', { urlHash: hash });
      }
      return;
    }

    if (wasProbing) {
      await redis.del(k.probe);
      await redis.set(k.open, '1', 'EX', OPEN_DURATION_SECONDS);
      await redis.set(k.halfOpen, '1', 'EX', OPEN_DURATION_SECONDS + HALF_OPEN_GRACE_SECONDS);
      webhookCircuitBreakerState.labels(hash).set(gaugeValue('open'));
      logger.warn('Webhook circuit breaker half-open probe failed, reopening', { urlHash: hash });
      return;
    }

    const now = Date.now();
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    await redis.zadd(k.failures, now, member);
    await redis.zremrangebyscore(k.failures, 0, now - FAILURE_WINDOW_MS);
    await redis.expire(k.failures, Math.ceil(FAILURE_WINDOW_MS / 1000));
    const failureCount = await redis.zcard(k.failures);

    if (failureCount >= FAILURE_THRESHOLD) {
      await redis.set(k.open, '1', 'EX', OPEN_DURATION_SECONDS);
      await redis.set(k.halfOpen, '1', 'EX', OPEN_DURATION_SECONDS + HALF_OPEN_GRACE_SECONDS);
      webhookCircuitBreakerState.labels(hash).set(gaugeValue('open'));
      logger.warn('Webhook circuit breaker opened after repeated failures', { urlHash: hash, failureCount });
    } else {
      webhookCircuitBreakerState.labels(hash).set(gaugeValue('closed'));
    }
  },

  /** Current circuit state for display in the webhook details API response. */
  async getStatus(url: string): Promise<CircuitStatus> {
    const hash = hashUrl(url);
    const k = keysFor(hash);
    const [openTtl, halfOpenTtl, entries] = await Promise.all([
      redis.ttl(k.open),
      redis.ttl(k.halfOpen),
      redis.zrange(k.failures, 0, -1, 'WITHSCORES'),
    ]);

    const state: CircuitState = openTtl > 0 ? 'open' : halfOpenTtl > 0 ? 'half_open' : 'closed';
    const scores = entries.filter((_: string, i: number) => i % 2 === 1).map(Number);
    const lastFailureAt = scores.length > 0 ? new Date(Math.max(...scores)).toISOString() : null;

    return { state, failures: scores.length, lastFailureAt };
  },
};
