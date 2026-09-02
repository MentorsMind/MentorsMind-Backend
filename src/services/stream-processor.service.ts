/**
 * Stream processing for real-time analytics (issue #861).
 *
 * A small topology over the consumer's event stream: filter, map, and tumbling
 * windowed aggregation, feeding sinks that update live dashboards.
 *
 * Windows close on event time, not wall-clock time, so a delayed batch produces
 * the same numbers as a timely one — which is the whole point of doing this on
 * a log rather than on request timing. Events later than `allowedLatenessMs`
 * past a closed window are counted as late and dropped rather than silently
 * corrupting a window that was already emitted.
 */

import { Logger } from "../utils/logger";
import type { EventEnvelope } from "./kafka-producer.service";

const logger = new Logger("StreamProcessor");

export type Predicate = (event: EventEnvelope) => boolean;
export type Mapper<T> = (event: EventEnvelope) => T;

export interface WindowedResult<T = unknown> {
  /** Inclusive start of the window, epoch milliseconds. */
  windowStart: number;
  /** Exclusive end. */
  windowEnd: number;
  key: string;
  count: number;
  value: T;
}

export type Aggregator<S, T> = {
  /** Initial state for a new window+key. */
  init: () => S;
  /** Fold one event into the state. */
  step: (state: S, event: EventEnvelope) => S;
  /** Finalise the state into the emitted value. */
  done: (state: S) => T;
};

export interface WindowSpec<S = unknown, T = unknown> {
  name: string;
  /** Window width in milliseconds. */
  sizeMs: number;
  /** Grouping key. Defaults to the envelope key. */
  keyBy?: (event: EventEnvelope) => string;
  /** How late an event may arrive and still be counted. */
  allowedLatenessMs?: number;
  aggregator: Aggregator<S, T>;
  /** Called once per window+key when the window closes. */
  sink: (result: WindowedResult<T>) => Promise<void> | void;
}

export interface ProcessorStats {
  consumed: number;
  filtered: number;
  late: number;
  windowsEmitted: number;
}

export const DEFAULT_ALLOWED_LATENESS_MS = 30_000;

/** Start of the tumbling window an event time falls into. */
export function windowStartFor(timestampMs: number, sizeMs: number): number {
  return Math.floor(timestampMs / sizeMs) * sizeMs;
}

interface OpenWindow<S> {
  key: string;
  windowStart: number;
  state: S;
  count: number;
}

export class StreamProcessorService {
  private filters: Predicate[] = [];
  private windows: Array<WindowSpec<any, any>> = [];
  private open = new Map<string, OpenWindow<any>>();
  /** Latest event time seen, which drives window closing. */
  private watermark = 0;
  private stats: ProcessorStats = {
    consumed: 0,
    filtered: 0,
    late: 0,
    windowsEmitted: 0,
  };

  /** Drop events that fail the predicate before any window sees them. */
  filter(predicate: Predicate): this {
    this.filters.push(predicate);
    return this;
  }

  /** Register a tumbling window aggregation. */
  window<S, T>(spec: WindowSpec<S, T>): this {
    this.windows.push(spec);
    return this;
  }

  getStats(): ProcessorStats {
    return { ...this.stats };
  }

  /**
   * Feed one event through the topology.
   *
   * Advancing the watermark may close windows, so a sink can fire as a side
   * effect of ingesting an unrelated event — that is how a tumbling window
   * emits without a timer.
   */
  async process(event: EventEnvelope): Promise<void> {
    this.stats.consumed++;

    if (!this.filters.every((predicate) => predicate(event))) {
      this.stats.filtered++;
      return;
    }

    const eventTime = Date.parse(event.occurredAt);
    if (Number.isNaN(eventTime)) {
      this.stats.late++;
      return;
    }

    if (eventTime > this.watermark) this.watermark = eventTime;

    for (const spec of this.windows) {
      const lateness = spec.allowedLatenessMs ?? DEFAULT_ALLOWED_LATENESS_MS;
      const start = windowStartFor(eventTime, spec.sizeMs);

      // The window this event belongs to is already closed and emitted.
      if (start + spec.sizeMs + lateness <= this.watermark) {
        this.stats.late++;
        continue;
      }

      const key = (spec.keyBy ?? ((e: EventEnvelope) => e.key))(event);
      const id = `${spec.name}|${key}|${start}`;
      const existing = this.open.get(id);
      const window: OpenWindow<unknown> = existing ?? {
        key,
        windowStart: start,
        state: spec.aggregator.init(),
        count: 0,
      };

      window.state = spec.aggregator.step(window.state, event);
      window.count++;
      this.open.set(id, window);
    }

    await this.closeExpired();
  }

  /** Emit every window whose end plus lateness is behind the watermark. */
  private async closeExpired(): Promise<void> {
    for (const [id, window] of [...this.open]) {
      const specName = id.split("|")[0];
      const spec = this.windows.find(
        (candidate) => candidate.name === specName,
      );
      if (!spec) {
        this.open.delete(id);
        continue;
      }

      const lateness = spec.allowedLatenessMs ?? DEFAULT_ALLOWED_LATENESS_MS;
      if (window.windowStart + spec.sizeMs + lateness > this.watermark)
        continue;

      this.open.delete(id);
      const result: WindowedResult = {
        windowStart: window.windowStart,
        windowEnd: window.windowStart + spec.sizeMs,
        key: window.key,
        count: window.count,
        value: spec.aggregator.done(window.state),
      };

      try {
        await spec.sink(result);
        this.stats.windowsEmitted++;
      } catch (err) {
        // A failing dashboard write must not stall the stream.
        logger.warn(`Sink for ${spec.name} failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Emit every open window regardless of the watermark.
   *
   * Call on shutdown, so the last partial window reaches the dashboard instead
   * of being lost.
   */
  async flush(): Promise<void> {
    this.watermark = Number.MAX_SAFE_INTEGER;
    await this.closeExpired();
  }

  reset(): void {
    this.open.clear();
    this.watermark = 0;
    this.stats = { consumed: 0, filtered: 0, late: 0, windowsEmitted: 0 };
  }
}

// ─── Aggregators ─────────────────────────────────────────────────────────────

export const countAggregator: Aggregator<number, number> = {
  init: () => 0,
  step: (state) => state + 1,
  done: (state) => state,
};

/** Sum a numeric field off the payload, ignoring events where it is absent. */
export function sumAggregator(field: string): Aggregator<number, number> {
  return {
    init: () => 0,
    step: (state, event) => {
      const value = (event.payload as Record<string, unknown> | null)?.[field];
      return typeof value === "number" && Number.isFinite(value)
        ? state + value
        : state;
    },
    done: (state) => state,
  };
}

/** Distinct count over a payload field. */
export function distinctAggregator(
  field: string,
): Aggregator<Set<string>, number> {
  return {
    init: () => new Set<string>(),
    step: (state, event) => {
      const value = (event.payload as Record<string, unknown> | null)?.[field];
      if (value !== undefined && value !== null) state.add(String(value));
      return state;
    },
    done: (state) => state.size,
  };
}
