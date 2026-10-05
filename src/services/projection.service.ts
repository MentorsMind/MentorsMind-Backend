import { DomainEvent } from '../models';
import { Logger } from "../utils/logger.utils";

interface EventHandler {
  aggregateType: string;
  eventType: string;
  handler: (event: DomainEvent) => Promise<void>;
}

export class ProjectionService {
  private static handlers: EventHandler[] = [];

  static registerHandler(
    aggregateType: string,
    eventType: string,
    handler: (event: DomainEvent) => Promise<void>
  ): void {
    this.handlers.push({ aggregateType, eventType, handler });
  }

  /** Number of registered projection handlers (for startup assertions / tests). */
  static getHandlerCount(): number {
    return this.handlers.length;
  }

  /** Snapshot of registered handler keys for diagnostics. */
  static listHandlers(): Array<{ aggregateType: string; eventType: string }> {
    return this.handlers.map(({ aggregateType, eventType }) => ({
      aggregateType,
      eventType,
    }));
  }

  static async handleEvent(event: DomainEvent): Promise<void> {
    const relevantHandlers = this.handlers.filter(
      h => h.aggregateType === event.aggregateType && h.eventType === event.eventType
    );

    if (relevantHandlers.length === 0) {
      logger.debug({ eventType: event.eventType, aggregateType: event.aggregateType }, 'No projection handlers registered');
      return;
    }

    const promises = relevantHandlers.map(h => h.handler(event));
    await Promise.all(promises);

    logger.info({ eventId: event.id, handlers: relevantHandlers.length }, 'Projections updated');
  }

  static async handleEvents(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.handleEvent(event);
    }
  }
}
