import { redis } from "../config/redis";
import { logger } from "../utils/logger";
import { DomainEvent } from "../events";

export interface EventHandler<T = any> {
  (event: DomainEvent<T>): Promise<void>;
}

export class EventBus {
  private static readonly EVENT_CHANNEL_PREFIX = "events:";
  private static handlers: Map<string, Set<EventHandler>> = new Map();
  private static isSubscribed = false;

  static async publish(event: DomainEvent): Promise<void> {
    try {
      const channel = `${this.EVENT_CHANNEL_PREFIX}${event.type}`;
      const message = JSON.stringify(event);
      await redis.publish(channel, message);
      logger.debug(`Event published: ${event.type}`, {
        eventId: event.id,
        aggregateId: event.aggregateId,
      });
    } catch (error) {
      logger.error(`Failed to publish event: ${event.type}`, error);
    }
  }

  static subscribe<T>(eventType: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    logger.debug(`Subscribed handler to event: ${eventType}`);

    // Start listening if not already
    this.startListening();
  }

  static unsubscribe<T>(eventType: string, handler: EventHandler<T>): void {
    if (this.handlers.has(eventType)) {
      this.handlers.get(eventType)!.delete(handler);
      if (this.handlers.get(eventType)!.size === 0) {
        this.handlers.delete(eventType);
      }
    }
  }

  private static async startListening(): Promise<void> {
    if (this.isSubscribed) return;
    this.isSubscribed = true;

    const subscriber = redis.duplicate();
    
    // Subscribe to all event channels with pattern
    await subscriber.psubscribe(`${this.EVENT_CHANNEL_PREFIX}*`);

    subscriber.on("pmessage", async (_pattern: string, channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as DomainEvent;
        const eventType = channel.replace(this.EVENT_CHANNEL_PREFIX, "");
        const handlers = this.handlers.get(eventType);
        
        if (handlers && handlers.size > 0) {
          logger.debug(`Processing event: ${eventType}`, { eventId: event.id });
          await Promise.allSettled(
            Array.from(handlers).map((handler) => handler(event))
          );
        }
      } catch (error) {
        logger.error("Failed to process event from bus:", error);
      }
    });

    logger.info("Event bus listener started");
  }
}
