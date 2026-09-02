/**
 * Subscription federation (issue #866).
 *
 * Subscriptions do not federate the way queries do. A query fans out and
 * merges once; a subscription holds a long-lived connection per subgraph and
 * must merge an ongoing stream, which means the gateway owns fan-out,
 * back-pressure and — most importantly — cleanup.
 *
 * Leaked upstream connections are the characteristic failure here: the client
 * disconnects, nothing tells the subgraphs, and the sockets accumulate until
 * the process runs out of handles.
 */

import { logger } from "../../utils/logger";

export interface UpstreamSubscription {
  subgraph: string;
  /** Called to tear the upstream connection down. */
  close: () => void | Promise<void>;
}

export interface FederatedSubscription {
  id: string;
  field: string;
  upstreams: UpstreamSubscription[];
  createdAt: number;
}

const active = new Map<string, FederatedSubscription>();

export function trackSubscription(sub: FederatedSubscription): void {
  active.set(sub.id, sub);
}

/**
 * Tear down every upstream for a client subscription.
 *
 * Each close is isolated: one subgraph throwing during teardown must not leave
 * the remaining upstreams open, which is exactly how a partial cleanup turns
 * into a slow leak.
 */
export async function closeSubscription(id: string): Promise<void> {
  const sub = active.get(id);
  if (!sub) return;
  active.delete(id);

  await Promise.all(
    sub.upstreams.map(async (upstream) => {
      try {
        await upstream.close();
      } catch (error) {
        logger.warn(
          {
            subscriptionId: id,
            subgraph: upstream.subgraph,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to close upstream subscription",
        );
      }
    }),
  );
}

/** Close every tracked subscription, e.g. during shutdown. */
export async function closeAllSubscriptions(): Promise<void> {
  await Promise.all([...active.keys()].map((id) => closeSubscription(id)));
}

/**
 * Close subscriptions older than `maxAgeMs`.
 *
 * A safety net for clients that vanish without a close frame; without it those
 * upstreams are held until process exit.
 */
export async function reapStaleSubscriptions(maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const stale = [...active.values()].filter((s) => s.createdAt < cutoff);
  await Promise.all(stale.map((s) => closeSubscription(s.id)));
  if (stale.length > 0) {
    logger.info({ reaped: stale.length }, "Reaped stale federated subscriptions");
  }
  return stale.length;
}

export function activeSubscriptionCount(): number {
  return active.size;
}

export function activeSubscriptions(): FederatedSubscription[] {
  return [...active.values()];
}
