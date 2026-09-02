/**
 * Kafka producer (issue #861).
 *
 * Every message leaves as a versioned envelope, so a consumer can tell what it
 * is looking at without inferring it from the topic name, and so a schema change
 * is a visible number rather than a surprise deserialisation failure.
 *
 * The broker client is behind `KafkaProducerDriver`: kafkajs is loaded lazily
 * and only when a real producer connects. Nothing here needs a broker to be
 * unit-tested, and a service that merely imports this module does not pay for a
 * TCP connection it never uses.
 */

import { randomUUID } from "crypto";
import { Logger } from "../utils/logger";

const logger = new Logger("KafkaProducer");

export interface EventEnvelope<T = unknown> {
  /** Unique per message; the idempotency key a consumer deduplicates on. */
  eventId: string;
  eventType: string;
  /** Schema version of `payload`. Bump on any incompatible change. */
  version: number;
  /** Partition key. Messages sharing a key keep their relative order. */
  key: string;
  occurredAt: string;
  /** Ties a message to the request that produced it. */
  correlationId: string;
  payload: T;
}

export interface OutboundMessage<T = unknown> {
  topic: string;
  key: string;
  eventType: string;
  payload: T;
  version?: number;
  correlationId?: string;
}

export interface DriverRecord {
  topic: string;
  messages: Array<{
    key: string;
    value: string;
    headers: Record<string, string>;
  }>;
}

export interface KafkaProducerDriver {
  connect(): Promise<void>;
  send(record: DriverRecord): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ProducerOptions {
  driver?: KafkaProducerDriver;
  /** Attempts per send, including the first. */
  maxAttempts?: number;
  /** Base delay for exponential backoff, in milliseconds. */
  retryBaseMs?: number;
  /** Called with messages that exhausted their retries. */
  onDeadLetter?: (
    message: OutboundMessage,
    error: Error,
  ) => Promise<void> | void;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_MS = 100;

export function buildEnvelope<T>(
  message: OutboundMessage<T>,
  now = new Date(),
): EventEnvelope<T> {
  return {
    eventId: randomUUID(),
    eventType: message.eventType,
    version: message.version ?? 1,
    key: message.key,
    occurredAt: now.toISOString(),
    correlationId: message.correlationId ?? randomUUID(),
    payload: message.payload,
  };
}

/** Group messages by topic so one send covers a whole topic's batch. */
export function groupByTopic(
  envelopes: Array<{ topic: string; envelope: EventEnvelope }>,
): DriverRecord[] {
  const byTopic = new Map<string, DriverRecord["messages"]>();

  for (const { topic, envelope } of envelopes) {
    const messages = byTopic.get(topic) ?? [];
    messages.push({
      key: envelope.key,
      value: JSON.stringify(envelope),
      headers: {
        "event-type": envelope.eventType,
        "event-version": String(envelope.version),
        "correlation-id": envelope.correlationId,
      },
    });
    byTopic.set(topic, messages);
  }

  return [...byTopic.entries()].map(([topic, messages]) => ({
    topic,
    messages,
  }));
}

export class KafkaProducerService {
  private driver: KafkaProducerDriver | null;
  private connected = false;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly onDeadLetter?: ProducerOptions["onDeadLetter"];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ProducerOptions = {}) {
    this.driver = options.driver ?? null;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.onDeadLetter = options.onDeadLetter;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (!this.driver) this.driver = createKafkaJsProducer();
    await this.driver.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.driver) return;
    await this.driver.disconnect();
    this.connected = false;
  }

  /** Publish a single message. */
  async publish<T>(message: OutboundMessage<T>): Promise<EventEnvelope<T>> {
    const [envelope] = await this.publishBatch([message]);
    return envelope as EventEnvelope<T>;
  }

  /**
   * Publish a batch, retrying the whole batch on failure.
   *
   * Retrying the batch rather than each message keeps per-key ordering: a
   * partial retry could deliver message 2 before message 1 for the same key.
   * Messages that exhaust their attempts go to `onDeadLetter` rather than being
   * dropped silently.
   */
  async publishBatch(messages: OutboundMessage[]): Promise<EventEnvelope[]> {
    if (messages.length === 0) return [];
    await this.connect();

    const envelopes = messages.map((message) => buildEnvelope(message));
    const records = groupByTopic(
      messages.map((message, index) => ({
        topic: message.topic,
        envelope: envelopes[index],
      })),
    );

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        for (const record of records) {
          await (this.driver as KafkaProducerDriver).send(record);
        }
        return envelopes;
      } catch (err) {
        lastError = err as Error;
        logger.warn(
          `Publish attempt ${attempt}/${this.maxAttempts} failed: ${lastError.message}`,
        );
        if (attempt < this.maxAttempts) {
          await this.sleep(this.retryBaseMs * 2 ** (attempt - 1));
        }
      }
    }

    const error = lastError ?? new Error("publish failed");
    if (this.onDeadLetter) {
      for (const message of messages) await this.onDeadLetter(message, error);
    }
    throw error;
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Real driver, backed by kafkajs.
 *
 * Required lazily so importing this module — which every producer-side service
 * does — never pulls in the broker client or its config.
 */
export function createKafkaJsProducer(): KafkaProducerDriver {
  const { Kafka, logLevel } = require("kafkajs");
  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? "mentorminds-backend",
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092")
      .split(",")
      .map((b: string) => b.trim()),
    logLevel: logLevel.WARN,
  });
  const producer = kafka.producer({
    allowAutoTopicCreation: false,
    idempotent: true,
  });

  return {
    connect: () => producer.connect(),
    send: (record: DriverRecord) => producer.send(record),
    disconnect: () => producer.disconnect(),
  };
}

export const kafkaProducer = new KafkaProducerService();
