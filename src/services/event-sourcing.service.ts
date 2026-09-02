/**
 * Event sourcing and CQRS (issue #861).
 *
 * `event-store.service.ts` already persists domain events. This is the layer
 * above it: the command side that turns an intent into events, and the query
 * side that keeps read models current.
 *
 *   command → aggregate decides → events appended (optimistic concurrency)
 *           → projections updated → events published to Kafka
 *
 * Appending before publishing is deliberate. If the publish fails, the events
 * are still durable and can be republished; publishing first would risk
 * broadcasting a state change that was never committed.
 *
 * The journal is an interface so the command side can be unit-tested without a
 * database, and so `EventStoreService` stays the single writer in production.
 */

import { Logger } from "../utils/logger";
import type {
  KafkaProducerService,
  OutboundMessage,
} from "./kafka-producer.service";

const logger = new Logger("EventSourcing");

export interface StoredEvent<T = Record<string, unknown>> {
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  /** 1-based, contiguous per aggregate. */
  version: number;
  data: T;
  occurredAt: string;
  correlationId?: string;
}

export type NewEvent<T = Record<string, unknown>> = Pick<
  StoredEvent<T>,
  "eventType" | "data"
>;

/** Persistence for an aggregate's event stream. */
export interface EventJournal {
  /** Events for an aggregate, ascending by version. */
  read(aggregateId: string): Promise<StoredEvent[]>;
  /**
   * Append events. Must reject when the stream has moved past
   * `expectedVersion`, so two concurrent commands cannot both win.
   */
  append(
    aggregateId: string,
    aggregateType: string,
    expectedVersion: number,
    events: NewEvent[],
    correlationId: string,
  ): Promise<StoredEvent[]>;
}

export class ConcurrencyError extends Error {
  constructor(
    readonly aggregateId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `aggregate ${aggregateId} is at version ${actualVersion}, command expected ${expectedVersion}`,
    );
    this.name = "ConcurrencyError";
  }
}

/** Folds an event stream into current state and decides on commands. */
export interface Aggregate<S, C> {
  type: string;
  /** State for an aggregate with no events yet. */
  initial: () => S;
  /** Fold one event into state. Must be pure. */
  apply: (state: S, event: StoredEvent) => S;
  /**
   * Decide which events a command produces. Returning an empty array is a
   * valid no-op — a command that changes nothing must not bump the version.
   */
  decide: (state: S, command: C) => NewEvent[];
}

/** Read-model updater. Runs after events are durable. */
export interface Projection {
  name: string;
  /** Event types this reacts to. Empty means all. */
  eventTypes: string[];
  handle: (event: StoredEvent) => Promise<void> | void;
}

export interface CommandResult<S> {
  aggregateId: string;
  events: StoredEvent[];
  state: S;
  version: number;
}

export interface EventSourcingOptions {
  journal: EventJournal;
  producer?: KafkaProducerService;
  /** Topic events are published to. Omit to skip publishing. */
  topic?: string;
}

/** In-memory journal. Backs unit tests and local development. */
export class InMemoryEventJournal implements EventJournal {
  private streams = new Map<string, StoredEvent[]>();

  async read(aggregateId: string): Promise<StoredEvent[]> {
    return [...(this.streams.get(aggregateId) ?? [])];
  }

  async append(
    aggregateId: string,
    aggregateType: string,
    expectedVersion: number,
    events: NewEvent[],
    correlationId: string,
  ): Promise<StoredEvent[]> {
    const stream = this.streams.get(aggregateId) ?? [];
    const actualVersion = stream.length;

    if (actualVersion !== expectedVersion) {
      throw new ConcurrencyError(aggregateId, expectedVersion, actualVersion);
    }

    const appended = events.map((event, index) => ({
      aggregateId,
      aggregateType,
      eventType: event.eventType,
      version: expectedVersion + index + 1,
      data: event.data,
      occurredAt: new Date().toISOString(),
      correlationId,
    }));

    this.streams.set(aggregateId, [...stream, ...appended]);
    return appended;
  }

  clear(): void {
    this.streams.clear();
  }
}

export class EventSourcingService {
  private projections: Projection[] = [];

  constructor(private readonly options: EventSourcingOptions) {}

  registerProjection(projection: Projection): void {
    this.projections.push(projection);
  }

  projectionNames(): string[] {
    return this.projections.map((projection) => projection.name);
  }

  /** Rebuild an aggregate's current state from its events. */
  async rehydrate<S, C>(
    aggregate: Aggregate<S, C>,
    aggregateId: string,
  ): Promise<{ state: S; version: number }> {
    const events = await this.options.journal.read(aggregateId);
    const state = events.reduce(
      (acc, event) => aggregate.apply(acc, event),
      aggregate.initial(),
    );
    return { state, version: events.length };
  }

  /**
   * Execute a command against an aggregate.
   *
   * Rehydrates, decides, appends under the version it read, then projects and
   * publishes. A `ConcurrencyError` propagates so the caller can retry the whole
   * command against fresh state — retrying the append alone would apply a
   * decision made from state that no longer holds.
   */
  async execute<S, C>(
    aggregate: Aggregate<S, C>,
    aggregateId: string,
    command: C,
    correlationId = `cmd-${Date.now()}`,
  ): Promise<CommandResult<S>> {
    const { state, version } = await this.rehydrate(aggregate, aggregateId);
    const decided = aggregate.decide(state, command);

    if (decided.length === 0) {
      return { aggregateId, events: [], state, version };
    }

    const appended = await this.options.journal.append(
      aggregateId,
      aggregate.type,
      version,
      decided,
      correlationId,
    );

    const nextState = appended.reduce(
      (acc, event) => aggregate.apply(acc, event),
      state,
    );

    await this.project(appended);
    await this.publish(appended, correlationId);

    return {
      aggregateId,
      events: appended,
      state: nextState,
      version: version + appended.length,
    };
  }

  /**
   * Run every matching projection.
   *
   * A projection that throws is logged and skipped: read models are rebuildable
   * from the journal, so a broken one must not fail a command whose events are
   * already durable.
   */
  private async project(events: StoredEvent[]): Promise<void> {
    for (const event of events) {
      for (const projection of this.projections) {
        if (
          projection.eventTypes.length &&
          !projection.eventTypes.includes(event.eventType)
        ) {
          continue;
        }
        try {
          await projection.handle(event);
        } catch (err) {
          logger.error(
            `Projection ${projection.name} failed on ${event.eventType} ` +
              `v${event.version} of ${event.aggregateId}: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  /** Publish durable events. Failures are logged; the events remain replayable. */
  private async publish(
    events: StoredEvent[],
    correlationId: string,
  ): Promise<void> {
    const { producer, topic } = this.options;
    if (!producer || !topic) return;

    const messages: OutboundMessage[] = events.map((event) => ({
      topic,
      key: event.aggregateId,
      eventType: event.eventType,
      payload: event.data,
      correlationId,
    }));

    try {
      await producer.publishBatch(messages);
    } catch (err) {
      logger.error(
        `Publishing ${events.length} event(s) for ${events[0]?.aggregateId} failed; ` +
          `they are durable and can be replayed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Replay an aggregate's events through the projections.
   *
   * This is how a read model is rebuilt after a schema change or after the
   * projection failure above.
   */
  async replay(aggregateId: string): Promise<number> {
    const events = await this.options.journal.read(aggregateId);
    await this.project(events);
    return events.length;
  }
}
