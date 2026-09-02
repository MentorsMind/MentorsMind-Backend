/**
 * Cache warming and preloading (issue #864).
 *
 * A warmer names a set of cache keys and how to load them. Warmers run on
 * startup and on an interval, so the expensive reads the analytics service
 * flags as `expensive-loader` are paid off the request path.
 *
 * Warming is bounded on purpose: unbounded parallel loads against the database
 * at boot is a thundering herd of our own making, so entries are loaded with a
 * concurrency limit and one warmer's failure never stops the others.
 */

import { Logger } from "../utils/logger";
import {
  cacheOrchestrator,
  CacheOrchestrator,
} from "./cache-orchestrator.service";

const logger = new Logger("CacheWarming");

export interface WarmEntry<T = unknown> {
  key: string;
  load: () => Promise<T>;
  ttl?: number;
  dependencies?: string[];
}

export interface Warmer {
  name: string;
  /** Resolve the entries to load. Called on every run, so it can be dynamic. */
  entries: () => Promise<WarmEntry[]> | WarmEntry[];
  /** How often to re-run, in seconds. Omit to warm on startup only. */
  intervalSeconds?: number;
  /** Skip this warmer without unregistering it. */
  enabled?: boolean;
}

export interface WarmResult {
  warmer: string;
  loaded: number;
  failed: number;
  durationMs: number;
  errors: string[];
}

export const DEFAULT_CONCURRENCY = 5;
/** Cap on errors kept per run, so one broken warmer cannot balloon the result. */
export const MAX_REPORTED_ERRORS = 10;

export class CacheWarmingService {
  private warmers = new Map<string, Warmer>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly orchestrator: CacheOrchestrator = cacheOrchestrator,
    private readonly concurrency: number = DEFAULT_CONCURRENCY,
  ) {}

  register(warmer: Warmer): void {
    this.warmers.set(warmer.name, warmer);
  }

  unregister(name: string): void {
    this.warmers.delete(name);
    const timer = this.timers.get(name);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(name);
    }
  }

  list(): string[] {
    return [...this.warmers.keys()];
  }

  /** Run one warmer now. Never throws: failures are counted and reported. */
  async run(name: string): Promise<WarmResult> {
    const started = Date.now();
    const warmer = this.warmers.get(name);

    if (!warmer) {
      return {
        warmer: name,
        loaded: 0,
        failed: 0,
        durationMs: 0,
        errors: [`no warmer registered as "${name}"`],
      };
    }

    if (warmer.enabled === false) {
      return { warmer: name, loaded: 0, failed: 0, durationMs: 0, errors: [] };
    }

    let entries: WarmEntry[];
    try {
      entries = await warmer.entries();
    } catch (err) {
      return {
        warmer: name,
        loaded: 0,
        failed: 0,
        durationMs: Date.now() - started,
        errors: [`entries() failed: ${(err as Error).message}`],
      };
    }

    const errors: string[] = [];
    let loaded = 0;
    let failed = 0;

    for (const batch of chunk(entries, this.concurrency)) {
      const settled = await Promise.allSettled(
        batch.map(async (entry) => {
          const value = await entry.load();
          await this.orchestrator.set(entry.key, value, {
            ttl: entry.ttl,
            dependencies: entry.dependencies,
          });
        }),
      );

      for (const [index, result] of settled.entries()) {
        if (result.status === "fulfilled") {
          loaded++;
        } else {
          failed++;
          if (errors.length < MAX_REPORTED_ERRORS) {
            const key = batch[index]?.key ?? "unknown";
            errors.push(`${key}: ${(result.reason as Error).message}`);
          }
        }
      }
    }

    const result = {
      warmer: name,
      loaded,
      failed,
      durationMs: Date.now() - started,
      errors,
    };
    logger.info(
      `Warmed ${name}: ${loaded} loaded, ${failed} failed in ${result.durationMs}ms`,
    );
    return result;
  }

  /** Run every registered warmer once. */
  async runAll(): Promise<WarmResult[]> {
    const results: WarmResult[] = [];
    for (const name of this.warmers.keys()) {
      results.push(await this.run(name));
    }
    return results;
  }

  /**
   * Warm everything, then schedule the warmers that declared an interval.
   *
   * Call once during startup. Scheduled runs are unref'd so a warmer's timer
   * never holds the process open during a shutdown.
   */
  async start(): Promise<WarmResult[]> {
    const initial = await this.runAll();

    for (const warmer of this.warmers.values()) {
      if (!warmer.intervalSeconds || warmer.enabled === false) continue;
      const timer = setInterval(() => {
        void this.run(warmer.name).catch((err: Error) =>
          logger.warn(
            `Scheduled warm of ${warmer.name} failed: ${err.message}`,
          ),
        );
      }, warmer.intervalSeconds * 1000);
      timer.unref?.();
      this.timers.set(warmer.name, timer);
    }

    return initial;
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new RangeError("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export const cacheWarming = new CacheWarmingService();
