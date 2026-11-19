/**
 * Cache analytics and optimization recommendations (issue #864).
 *
 * Subscribes to the orchestrator's event stream and keeps per-namespace
 * counters in memory. The point is not another dashboard metric: it is to turn
 * the numbers into a specific, actionable statement — which namespace to warm,
 * which TTL is too short, which key is too specific to ever hit.
 *
 * Counters are bounded and reset-able, so this can run permanently in-process
 * without growing.
 */

import type {
  OrchestratorEvent,
  CacheTier,
} from "./cache-orchestrator.service";

export interface NamespaceStats {
  namespace: string;
  hits: number;
  misses: number;
  sets: number;
  invalidations: number;
  /** Hits served from each tier. */
  tierHits: Record<CacheTier | "loader", number>;
  /** Mean duration of a served read, in milliseconds. */
  avgReadMs: number;
  /** Mean duration of a miss that fell through to the loader. */
  avgLoadMs: number;
  hitRate: number;
}

export type RecommendationSeverity = "info" | "warning" | "critical";

export interface Recommendation {
  namespace: string;
  severity: RecommendationSeverity;
  /** Machine-readable code, stable across wording changes. */
  code:
    | "low-hit-rate"
    | "l1-bypassed"
    | "expensive-loader"
    | "invalidation-churn"
    | "unused-namespace";
  message: string;
}

interface MutableStats {
  hits: number;
  misses: number;
  sets: number;
  invalidations: number;
  tierHits: Record<CacheTier | "loader", number>;
  readMsTotal: number;
  readCount: number;
  loadMsTotal: number;
  loadCount: number;
}

/** Below this hit rate a namespace is probably mis-keyed or under-TTL'd. */
export const LOW_HIT_RATE_THRESHOLD = 0.5;
/** A loader slower than this is worth warming rather than serving cold. */
export const EXPENSIVE_LOADER_MS = 250;
/** More invalidations than sets means the cache is being thrashed. */
export const CHURN_RATIO = 1;
/** Ignore namespaces with too little traffic to draw a conclusion from. */
export const MIN_SAMPLES = 20;

function emptyStats(): MutableStats {
  return {
    hits: 0,
    misses: 0,
    sets: 0,
    invalidations: 0,
    tierHits: { l1: 0, l2: 0, l3: 0, loader: 0 },
    readMsTotal: 0,
    readCount: 0,
    loadMsTotal: 0,
    loadCount: 0,
  };
}

export class CacheAnalyticsService {
  private stats = new Map<string, MutableStats>();

  /** Attach to an orchestrator's event stream. */
  record(event: OrchestratorEvent): void {
    const entry = this.stats.get(event.namespace) ?? emptyStats();

    switch (event.type) {
      case "hit":
        entry.hits++;
        entry.readMsTotal += event.durationMs;
        entry.readCount++;
        if (event.tier) entry.tierHits[event.tier]++;
        break;
      case "miss":
        entry.misses++;
        entry.loadMsTotal += event.durationMs;
        entry.loadCount++;
        break;
      case "set":
        entry.sets++;
        break;
      case "invalidate":
        entry.invalidations++;
        break;
    }

    this.stats.set(event.namespace, entry);
  }

  snapshot(): NamespaceStats[] {
    return [...this.stats.entries()]
      .map(([namespace, s]) => {
        const total = s.hits + s.misses;
        return {
          namespace,
          hits: s.hits,
          misses: s.misses,
          sets: s.sets,
          invalidations: s.invalidations,
          tierHits: { ...s.tierHits },
          avgReadMs: s.readCount === 0 ? 0 : s.readMsTotal / s.readCount,
          avgLoadMs: s.loadCount === 0 ? 0 : s.loadMsTotal / s.loadCount,
          hitRate: total === 0 ? 0 : s.hits / total,
        };
      })
      .sort((a, b) => b.hits + b.misses - (a.hits + a.misses));
  }

  /**
   * Turn the counters into recommendations.
   *
   * Namespaces below `MIN_SAMPLES` are skipped — advice drawn from three
   * requests is noise, and acting on it makes the cache worse.
   */
  recommendations(): Recommendation[] {
    const out: Recommendation[] = [];

    for (const s of this.snapshot()) {
      const total = s.hits + s.misses;
      if (total < MIN_SAMPLES) continue;

      if (s.hitRate < LOW_HIT_RATE_THRESHOLD) {
        out.push({
          namespace: s.namespace,
          severity: s.hitRate < 0.2 ? "critical" : "warning",
          code: "low-hit-rate",
          message:
            `${s.namespace} hits ${(s.hitRate * 100).toFixed(1)}% of ${total} reads. ` +
            "Either the TTL expires before the next read, or the key carries a " +
            "parameter specific enough that it is never requested twice.",
        });
      }

      if (s.hits >= MIN_SAMPLES && s.tierHits.l1 === 0) {
        out.push({
          namespace: s.namespace,
          severity: "warning",
          code: "l1-bypassed",
          message:
            `${s.namespace} serves every hit from L2 and never from L1. ` +
            "Entries are being evicted before a second read — raise the L1 ceiling " +
            "or check that this namespace writes to the l1 tier.",
        });
      }

      if (s.avgLoadMs > EXPENSIVE_LOADER_MS && s.misses > 0) {
        out.push({
          namespace: s.namespace,
          severity:
            s.avgLoadMs > EXPENSIVE_LOADER_MS * 4 ? "critical" : "warning",
          code: "expensive-loader",
          message:
            `${s.namespace} takes ${s.avgLoadMs.toFixed(0)}ms on a miss across ` +
            `${s.misses} misses. Register a warmer so this cost is paid off the ` +
            "request path.",
        });
      }

      if (s.sets > 0 && s.invalidations / s.sets > CHURN_RATIO) {
        out.push({
          namespace: s.namespace,
          severity: "warning",
          code: "invalidation-churn",
          message:
            `${s.namespace} is invalidated ${s.invalidations} times against ` +
            `${s.sets} writes. The dependency tags are too broad — entries are ` +
            "dropped before they are read.",
        });
      }

      if (s.sets > MIN_SAMPLES && total === s.misses) {
        out.push({
          namespace: s.namespace,
          severity: "info",
          code: "unused-namespace",
          message: `${s.namespace} is written ${s.sets} times and never read back.`,
        });
      }
    }

    return out;
  }

  reset(): void {
    this.stats.clear();
  }
}

export const cacheAnalytics = new CacheAnalyticsService();
