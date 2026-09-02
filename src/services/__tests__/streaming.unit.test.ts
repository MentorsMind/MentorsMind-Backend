import {
  KafkaProducerService,
  buildEnvelope,
  groupByTopic,
  type DriverRecord,
  type EventEnvelope,
  type KafkaProducerDriver,
  type OutboundMessage,
} from "../kafka-producer.service";
import {
  KafkaConsumerService,
  deadLetterTopicFor,
  parseEnvelope,
  type ConsumedMessage,
} from "../kafka-consumer.service";
import {
  StreamProcessorService,
  countAggregator,
  distinctAggregator,
  sumAggregator,
  windowStartFor,
  type WindowedResult,
} from "../stream-processor.service";
import {
  ConcurrencyError,
  EventSourcingService,
  InMemoryEventJournal,
  type Aggregate,
  type StoredEvent,
} from "../event-sourcing.service";

const noSleep = async () => {};

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: "evt-1",
    eventType: "session.booked",
    version: 1,
    key: "mentor-1",
    occurredAt: new Date(1_700_000_000_000).toISOString(),
    correlationId: "corr-1",
    payload: {},
    ...overrides,
  };
}

function consumed(overrides: Partial<ConsumedMessage> = {}): ConsumedMessage {
  return {
    topic: "sessions",
    partition: 0,
    offset: "1",
    key: "mentor-1",
    value: JSON.stringify(envelope()),
    headers: {},
    ...overrides,
  };
}

// ─── Producer ────────────────────────────────────────────────────────────────

class RecordingDriver implements KafkaProducerDriver {
  sent: DriverRecord[] = [];
  connects = 0;
  failuresRemaining = 0;

  async connect(): Promise<void> {
    this.connects++;
  }
  async send(record: DriverRecord): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new Error("broker unavailable");
    }
    this.sent.push(record);
  }
  async disconnect(): Promise<void> {}
}

describe("buildEnvelope", () => {
  it("stamps an id, timestamp and default version", () => {
    const e = buildEnvelope({
      topic: "t",
      key: "k",
      eventType: "x",
      payload: { a: 1 },
    });
    expect(e.eventId).toHaveLength(36);
    expect(e.version).toBe(1);
    expect(e.payload).toEqual({ a: 1 });
  });

  it("gives each message a distinct id", () => {
    const message: OutboundMessage = {
      topic: "t",
      key: "k",
      eventType: "x",
      payload: {},
    };
    expect(buildEnvelope(message).eventId).not.toBe(
      buildEnvelope(message).eventId,
    );
  });
});

describe("groupByTopic", () => {
  it("collapses messages into one record per topic with headers", () => {
    const records = groupByTopic([
      { topic: "a", envelope: envelope({ key: "k1" }) },
      { topic: "a", envelope: envelope({ key: "k2" }) },
      { topic: "b", envelope: envelope({ key: "k3" }) },
    ]);

    expect(records).toHaveLength(2);
    expect(records[0].messages).toHaveLength(2);
    expect(records[0].messages[0].headers["event-type"]).toBe("session.booked");
    expect(records[0].messages[0].headers["event-version"]).toBe("1");
  });
});

describe("KafkaProducerService", () => {
  it("connects once and sends the batch", async () => {
    const driver = new RecordingDriver();
    const producer = new KafkaProducerService({ driver, sleep: noSleep });

    await producer.publish({
      topic: "sessions",
      key: "m1",
      eventType: "x",
      payload: {},
    });
    await producer.publish({
      topic: "sessions",
      key: "m2",
      eventType: "x",
      payload: {},
    });

    expect(driver.connects).toBe(1);
    expect(driver.sent).toHaveLength(2);
  });

  it("retries and then succeeds", async () => {
    const driver = new RecordingDriver();
    driver.failuresRemaining = 2;
    const producer = new KafkaProducerService({ driver, sleep: noSleep });

    await producer.publish({
      topic: "sessions",
      key: "m1",
      eventType: "x",
      payload: {},
    });

    expect(driver.sent).toHaveLength(1);
  });

  it("dead-letters and rethrows once attempts are exhausted", async () => {
    const driver = new RecordingDriver();
    driver.failuresRemaining = 99;
    const dead: OutboundMessage[] = [];
    const producer = new KafkaProducerService({
      driver,
      sleep: noSleep,
      maxAttempts: 2,
      onDeadLetter: (message) => {
        dead.push(message);
      },
    });

    await expect(
      producer.publish({
        topic: "sessions",
        key: "m1",
        eventType: "x",
        payload: {},
      }),
    ).rejects.toThrow("broker unavailable");
    expect(dead).toHaveLength(1);
  });

  it("is a no-op for an empty batch", async () => {
    const driver = new RecordingDriver();
    const producer = new KafkaProducerService({ driver, sleep: noSleep });

    expect(await producer.publishBatch([])).toEqual([]);
    expect(driver.connects).toBe(0);
  });
});

// ─── Consumer ────────────────────────────────────────────────────────────────

describe("parseEnvelope", () => {
  it("rejects invalid JSON, a null value and an envelope without an eventId", () => {
    expect(parseEnvelope(consumed({ value: "not json" }))).toBeNull();
    expect(parseEnvelope(consumed({ value: null }))).toBeNull();
    expect(parseEnvelope(consumed({ value: '{"eventType":"x"}' }))).toBeNull();
  });

  it("accepts a well-formed envelope", () => {
    expect(parseEnvelope(consumed())?.eventType).toBe("session.booked");
  });
});

describe("deadLetterTopicFor", () => {
  it("suffixes the source topic", () => {
    expect(deadLetterTopicFor("sessions")).toBe("sessions.dlq");
  });
});

describe("KafkaConsumerService", () => {
  it("dispatches to every handler for the topic", async () => {
    const consumer = new KafkaConsumerService({ groupId: "g", sleep: noSleep });
    const seen: string[] = [];
    consumer.on("sessions", () => {
      seen.push("a");
    });
    consumer.on("sessions", () => {
      seen.push("b");
    });

    await consumer.handle(consumed());

    expect(seen).toEqual(["a", "b"]);
    expect(consumer.getStats().processed).toBe(1);
  });

  it("ignores a topic with no handlers", async () => {
    const consumer = new KafkaConsumerService({ groupId: "g", sleep: noSleep });
    await consumer.handle(consumed({ topic: "other" }));
    expect(consumer.getStats()).toMatchObject({ processed: 0, failed: 0 });
  });

  it("retries a failing handler then dead-letters without throwing", async () => {
    const dead: Array<{ attempts: number; reason: string }> = [];
    const consumer = new KafkaConsumerService({
      groupId: "g",
      sleep: noSleep,
      maxAttempts: 3,
      deadLetter: {
        async send(_message, error, attempts) {
          dead.push({ attempts, reason: error.message });
        },
      },
    });
    consumer.on("sessions", () => {
      throw new Error("projection down");
    });

    await expect(consumer.handle(consumed())).resolves.toBeUndefined();

    expect(consumer.getStats().failed).toBe(3);
    expect(dead).toEqual([{ attempts: 3, reason: "projection down" }]);
  });

  it("succeeds on a retry without dead-lettering", async () => {
    let attempts = 0;
    const consumer = new KafkaConsumerService({ groupId: "g", sleep: noSleep });
    consumer.on("sessions", () => {
      if (++attempts < 2) throw new Error("transient");
    });

    await consumer.handle(consumed());

    expect(consumer.getStats()).toMatchObject({
      processed: 1,
      deadLettered: 0,
    });
  });

  it("dead-letters an unparseable message instead of retrying it", async () => {
    let sent = 0;
    const consumer = new KafkaConsumerService({
      groupId: "g",
      sleep: noSleep,
      deadLetter: {
        async send() {
          sent++;
        },
      },
    });
    const handler = jest.fn();
    consumer.on("sessions", handler);

    await consumer.handle(consumed({ value: "garbage" }));

    expect(handler).not.toHaveBeenCalled();
    expect(sent).toBe(1);
    expect(consumer.getStats().skippedUnparseable).toBe(1);
  });
});

// ─── Stream processor ────────────────────────────────────────────────────────

describe("windowStartFor", () => {
  it("floors an event time to its window", () => {
    expect(windowStartFor(1_005, 1_000)).toBe(1_000);
    expect(windowStartFor(2_000, 1_000)).toBe(2_000);
  });
});

describe("StreamProcessorService", () => {
  function at(
    ms: number,
    overrides: Partial<EventEnvelope> = {},
  ): EventEnvelope {
    return envelope({ occurredAt: new Date(ms).toISOString(), ...overrides });
  }

  it("emits a window once the watermark passes it", async () => {
    const emitted: WindowedResult[] = [];
    const processor = new StreamProcessorService().window({
      name: "bookings",
      sizeMs: 1_000,
      allowedLatenessMs: 0,
      aggregator: countAggregator,
      sink: (result) => {
        emitted.push(result);
      },
    });

    await processor.process(at(0));
    await processor.process(at(500));
    expect(emitted).toHaveLength(0); // window still open

    await processor.process(at(1_500));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      windowStart: 0,
      windowEnd: 1_000,
      count: 2,
      value: 2,
    });
  });

  it("keeps separate windows per key", async () => {
    const emitted: WindowedResult[] = [];
    const processor = new StreamProcessorService().window({
      name: "bookings",
      sizeMs: 1_000,
      allowedLatenessMs: 0,
      keyBy: (event) => event.key,
      aggregator: countAggregator,
      sink: (result) => {
        emitted.push(result);
      },
    });

    await processor.process(at(0, { key: "mentor-a" }));
    await processor.process(at(0, { key: "mentor-b" }));
    await processor.process(at(0, { key: "mentor-a" }));
    await processor.flush();

    const byKey = Object.fromEntries(emitted.map((r) => [r.key, r.count]));
    expect(byKey).toEqual({ "mentor-a": 2, "mentor-b": 1 });
  });

  it("drops an event that arrives after its window closed", async () => {
    const emitted: WindowedResult[] = [];
    const processor = new StreamProcessorService().window({
      name: "bookings",
      sizeMs: 1_000,
      allowedLatenessMs: 0,
      aggregator: countAggregator,
      sink: (result) => {
        emitted.push(result);
      },
    });

    await processor.process(at(0));
    await processor.process(at(5_000)); // closes window 0
    await processor.process(at(100)); // far too late

    expect(processor.getStats().late).toBe(1);
    expect(emitted[0].count).toBe(1);
  });

  it("drops filtered events before they reach a window", async () => {
    const processor = new StreamProcessorService()
      .filter((event) => event.eventType === "session.booked")
      .window({
        name: "bookings",
        sizeMs: 1_000,
        aggregator: countAggregator,
        sink: () => {},
      });

    await processor.process(at(0, { eventType: "session.cancelled" }));

    expect(processor.getStats()).toMatchObject({ consumed: 1, filtered: 1 });
  });

  it("flushes open windows on shutdown", async () => {
    const emitted: WindowedResult[] = [];
    const processor = new StreamProcessorService().window({
      name: "bookings",
      sizeMs: 60_000,
      aggregator: countAggregator,
      sink: (result) => {
        emitted.push(result);
      },
    });

    await processor.process(at(0));
    expect(emitted).toHaveLength(0);

    await processor.flush();
    expect(emitted).toHaveLength(1);
  });

  it("does not let a failing sink stall the stream", async () => {
    const processor = new StreamProcessorService().window({
      name: "bookings",
      sizeMs: 1_000,
      allowedLatenessMs: 0,
      aggregator: countAggregator,
      sink: () => {
        throw new Error("dashboard down");
      },
    });

    await processor.process(at(0));
    await expect(processor.process(at(5_000))).resolves.toBeUndefined();
    expect(processor.getStats().windowsEmitted).toBe(0);
  });

  it("sums and counts distinct payload fields", async () => {
    const sums: WindowedResult[] = [];
    const distincts: WindowedResult[] = [];
    const processor = new StreamProcessorService()
      .window({
        name: "revenue",
        sizeMs: 1_000,
        aggregator: sumAggregator("amount"),
        sink: (r) => {
          sums.push(r);
        },
      })
      .window({
        name: "mentees",
        sizeMs: 1_000,
        aggregator: distinctAggregator("menteeId"),
        sink: (r) => {
          distincts.push(r);
        },
      });

    await processor.process(at(0, { payload: { amount: 10, menteeId: "a" } }));
    await processor.process(at(10, { payload: { amount: 5, menteeId: "a" } }));
    await processor.process(at(20, { payload: { menteeId: "b" } }));
    await processor.flush();

    expect(sums[0].value).toBe(15);
    expect(distincts[0].value).toBe(2);
  });
});

// ─── Event sourcing / CQRS ───────────────────────────────────────────────────

interface BookingState {
  status: "none" | "booked" | "cancelled";
}
type BookingCommand = { type: "book" } | { type: "cancel" };

const bookingAggregate: Aggregate<BookingState, BookingCommand> = {
  type: "booking",
  initial: () => ({ status: "none" }),
  apply: (state, event) => {
    if (event.eventType === "booking.created") return { status: "booked" };
    if (event.eventType === "booking.cancelled") return { status: "cancelled" };
    return state;
  },
  decide: (state, command) => {
    if (command.type === "book") {
      return state.status === "booked"
        ? []
        : [{ eventType: "booking.created", data: {} }];
    }
    return state.status === "booked"
      ? [{ eventType: "booking.cancelled", data: {} }]
      : [];
  },
};

describe("EventSourcingService", () => {
  it("appends the decided events and returns the new state", async () => {
    const journal = new InMemoryEventJournal();
    const service = new EventSourcingService({ journal });

    const result = await service.execute(bookingAggregate, "b1", {
      type: "book",
    });

    expect(result.events.map((e) => e.eventType)).toEqual(["booking.created"]);
    expect(result.state.status).toBe("booked");
    expect(result.version).toBe(1);
  });

  it("treats a command that changes nothing as a no-op", async () => {
    const journal = new InMemoryEventJournal();
    const service = new EventSourcingService({ journal });
    await service.execute(bookingAggregate, "b1", { type: "book" });

    const second = await service.execute(bookingAggregate, "b1", {
      type: "book",
    });

    expect(second.events).toEqual([]);
    expect(second.version).toBe(1);
  });

  it("rehydrates state from the stream", async () => {
    const journal = new InMemoryEventJournal();
    const service = new EventSourcingService({ journal });
    await service.execute(bookingAggregate, "b1", { type: "book" });
    await service.execute(bookingAggregate, "b1", { type: "cancel" });

    expect(await service.rehydrate(bookingAggregate, "b1")).toEqual({
      state: { status: "cancelled" },
      version: 2,
    });
  });

  it("rejects a stale append rather than losing a write", async () => {
    const journal = new InMemoryEventJournal();
    await journal.append(
      "b1",
      "booking",
      0,
      [{ eventType: "booking.created", data: {} }],
      "c",
    );

    await expect(
      journal.append(
        "b1",
        "booking",
        0,
        [{ eventType: "booking.cancelled", data: {} }],
        "c",
      ),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("runs only the projections that match the event type", async () => {
    const journal = new InMemoryEventJournal();
    const service = new EventSourcingService({ journal });
    const seen: string[] = [];

    service.registerProjection({
      name: "created-only",
      eventTypes: ["booking.created"],
      handle: (e) => {
        seen.push(`created:${e.version}`);
      },
    });
    service.registerProjection({
      name: "all",
      eventTypes: [],
      handle: (e) => {
        seen.push(`all:${e.eventType}`);
      },
    });

    await service.execute(bookingAggregate, "b1", { type: "book" });
    await service.execute(bookingAggregate, "b1", { type: "cancel" });

    expect(seen).toEqual([
      "created:1",
      "all:booking.created",
      "all:booking.cancelled",
    ]);
  });

  it("does not fail a command when a projection throws", async () => {
    const journal = new InMemoryEventJournal();
    const service = new EventSourcingService({ journal });
    service.registerProjection({
      name: "broken",
      eventTypes: [],
      handle: () => {
        throw new Error("read model down");
      },
    });

    await expect(
      service.execute(bookingAggregate, "b1", { type: "book" }),
    ).resolves.toMatchObject({
      version: 1,
    });
  });

  it("publishes durable events to Kafka", async () => {
    const journal = new InMemoryEventJournal();
    const driver = new RecordingDriver();
    const service = new EventSourcingService({
      journal,
      producer: new KafkaProducerService({ driver, sleep: noSleep }),
      topic: "bookings",
    });

    await service.execute(bookingAggregate, "b1", { type: "book" });

    expect(driver.sent[0].topic).toBe("bookings");
    expect(driver.sent[0].messages[0].key).toBe("b1");
  });

  it("keeps the events when publishing fails", async () => {
    const journal = new InMemoryEventJournal();
    const driver = new RecordingDriver();
    driver.failuresRemaining = 99;
    const service = new EventSourcingService({
      journal,
      producer: new KafkaProducerService({
        driver,
        sleep: noSleep,
        maxAttempts: 1,
      }),
      topic: "bookings",
    });

    await expect(
      service.execute(bookingAggregate, "b1", { type: "book" }),
    ).resolves.toMatchObject({
      version: 1,
    });
    expect(await journal.read("b1")).toHaveLength(1);
  });

  it("replays a stream through the projections to rebuild a read model", async () => {
    const journal = new InMemoryEventJournal();
    const service = new EventSourcingService({ journal });
    await service.execute(bookingAggregate, "b1", { type: "book" });
    await service.execute(bookingAggregate, "b1", { type: "cancel" });

    const replayed: StoredEvent[] = [];
    service.registerProjection({
      name: "rebuild",
      eventTypes: [],
      handle: (e) => {
        replayed.push(e);
      },
    });

    expect(await service.replay("b1")).toBe(2);
    expect(replayed.map((e) => e.eventType)).toEqual([
      "booking.created",
      "booking.cancelled",
    ]);
  });
});
