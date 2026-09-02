/**
 * Kafka consumer (issue #861).
 *
 * At-least-once delivery with per-message isolation: one poisoned message must
 * not stall a partition or take down the handlers for every other topic.
 *
 *   - Handlers are registered per topic and run in registration order.
 *   - A failing message is retried in place up to `maxAttempts`, then routed to
 *     a dead-letter topic and skipped so the partition keeps moving.
 *   - Delivery is at-least-once, so handlers must be idempotent. `eventId` on
 *     the envelope is the key to deduplicate on.
 *
 * As with the producer, kafkajs sits behind a driver interface so the dispatch
 * logic is unit-testable without a broker.
 */

import { Logger } from "../utils/logger";
import type { EventEnvelope } from "./kafka-producer.service";

const logger = new Logger("KafkaConsumer");

export interface ConsumedMessage {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

export type MessageHandler = (
  envelope: EventEnvelope,
  message: ConsumedMessage,
) => Promise<void> | void;

export interface KafkaConsumerDriver {
  connect(): Promise<void>;
  subscribe(topics: string[]): Promise<void>;
  run(onMessage: (message: ConsumedMessage) => Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
}

export interface DeadLetterSink {
  send(message: ConsumedMessage, error: Error, attempts: number): Promise<void>;
}

export interface ConsumerOptions {
  groupId: string;
  driver?: KafkaConsumerDriver;
  /** Attempts per message before dead-lettering. */
  maxAttempts?: number;
  deadLetter?: DeadLetterSink;
  sleep?: (ms: number) => Promise<void>;
  retryBaseMs?: number;
}

export interface ConsumerStats {
  processed: number;
  failed: number;
  deadLettered: number;
  skippedUnparseable: number;
}

export const DEFAULT_MAX_ATTEMPTS = 3;

/** Dead-letter topic for a source topic. */
export function deadLetterTopicFor(topic: string): string {
  return `${topic}.dlq`;
}

export function parseEnvelope(message: ConsumedMessage): EventEnvelope | null {
  if (!message.value) return null;
  try {
    const parsed = JSON.parse(message.value) as EventEnvelope;
    // A message without an eventId cannot be deduplicated, which defeats the
    // at-least-once contract — treat it as unparseable rather than deliver it.
    if (
      !parsed ||
      typeof parsed.eventId !== "string" ||
      typeof parsed.eventType !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export class KafkaConsumerService {
  private handlers = new Map<string, MessageHandler[]>();
  private driver: KafkaConsumerDriver | null;
  private running = false;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly deadLetter?: DeadLetterSink;
  private readonly sleep: (ms: number) => Promise<void>;
  private stats: ConsumerStats = {
    processed: 0,
    failed: 0,
    deadLettered: 0,
    skippedUnparseable: 0,
  };

  constructor(private readonly options: ConsumerOptions) {
    this.driver = options.driver ?? null;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBaseMs = options.retryBaseMs ?? 50;
    this.deadLetter = options.deadLetter;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  on(topic: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(topic) ?? [];
    handlers.push(handler);
    this.handlers.set(topic, handlers);
  }

  topics(): string[] {
    return [...this.handlers.keys()];
  }

  getStats(): ConsumerStats {
    return { ...this.stats };
  }

  /**
   * Handle one message: parse, dispatch to every handler for its topic, retry,
   * then dead-letter.
   *
   * Never throws — the caller is a partition loop, and an exception escaping
   * here stops consumption for that partition entirely.
   */
  async handle(message: ConsumedMessage): Promise<void> {
    const envelope = parseEnvelope(message);

    if (!envelope) {
      this.stats.skippedUnparseable++;
      logger.warn(
        `Unparseable message at ${message.topic}/${message.partition}@${message.offset}; skipping`,
      );
      if (this.deadLetter) {
        await this.deadLetter.send(
          message,
          new Error("unparseable envelope"),
          0,
        );
        this.stats.deadLettered++;
      }
      return;
    }

    const handlers = this.handlers.get(message.topic) ?? [];
    if (handlers.length === 0) return;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        for (const handler of handlers) await handler(envelope, message);
        this.stats.processed++;
        return;
      } catch (err) {
        lastError = err as Error;
        this.stats.failed++;
        logger.warn(
          `Handler attempt ${attempt}/${this.maxAttempts} failed for ${envelope.eventType} ` +
            `(${envelope.eventId}): ${lastError.message}`,
        );
        if (attempt < this.maxAttempts)
          await this.sleep(this.retryBaseMs * 2 ** (attempt - 1));
      }
    }

    if (this.deadLetter && lastError) {
      await this.deadLetter.send(message, lastError, this.maxAttempts);
      this.stats.deadLettered++;
    }
    // Deliberately not rethrown: the partition must keep moving.
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.driver) this.driver = createKafkaJsConsumer(this.options.groupId);

    await this.driver.connect();
    await this.driver.subscribe(this.topics());
    await this.driver.run((message) => this.handle(message));
    this.running = true;
    logger.info(
      `Consumer ${this.options.groupId} started on ${this.topics().join(", ")}`,
    );
  }

  async stop(): Promise<void> {
    if (!this.running || !this.driver) return;
    await this.driver.disconnect();
    this.running = false;
    logger.info(`Consumer ${this.options.groupId} stopped`);
  }

  get isRunning(): boolean {
    return this.running;
  }
}

export function createKafkaJsConsumer(groupId: string): KafkaConsumerDriver {
  const { Kafka, logLevel } = require("kafkajs");
  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? "mentorminds-backend",
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092")
      .split(",")
      .map((b: string) => b.trim()),
    logLevel: logLevel.WARN,
  });
  const consumer = kafka.consumer({ groupId });

  return {
    connect: () => consumer.connect(),
    subscribe: (topics: string[]) =>
      consumer.subscribe({ topics, fromBeginning: false }),
    run: (onMessage) =>
      consumer.run({
        eachMessage: async ({ topic, partition, message }: any) =>
          onMessage({
            topic,
            partition,
            offset: message.offset,
            key: message.key?.toString() ?? null,
            value: message.value?.toString() ?? null,
            headers: Object.fromEntries(
              Object.entries(message.headers ?? {}).map(([k, v]) => [
                k,
                String(v),
              ]),
            ),
          }),
      }),
    disconnect: () => consumer.disconnect(),
  };
}
