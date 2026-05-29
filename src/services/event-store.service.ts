import { EventStoreModel, DomainEvent, Snapshot } from '../models';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class EventStoreService {
  private static readonly SNAPSHOT_THRESHOLD = 10;

  static async publishEvent(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
    data: Record<string, any>,
    metadata: { userId: string; correlationId?: string }
  ): Promise<DomainEvent | null> {
    try {
      const latestVersion = await EventStoreModel.getLatestVersion(aggregateId);
      const newVersion = latestVersion + 1;

      const event: Omit<DomainEvent, 'id'> = {
        aggregateId,
        aggregateType,
        eventType,
        version: newVersion,
        data,
        metadata: {
          userId: metadata.userId,
          timestamp: new Date(),
          correlationId: metadata.correlationId || uuidv4()
        }
      };

      const savedEvent = await EventStoreModel.append(event);
      
      if (savedEvent && newVersion % this.SNAPSHOT_THRESHOLD === 0) {
        await this.createSnapshot(aggregateId, aggregateType);
      }

      logger.info({ eventType, aggregateId, aggregateType, version: newVersion }, 'Event published successfully');
      return savedEvent;
    } catch (error) {
      logger.error({ error }, 'Failed to publish event');
      return null;
    }
  }

  static async getAggregateState(
    aggregateId: string,
    aggregateType: string,
    applyEvent: (state: Record<string, any>, event: DomainEvent) => Record<string, any>,
    initialState: Record<string, any> = {},
    toVersion?: number
  ): Promise<Record<string, any>> {
    return EventStoreModel.replay(
      aggregateId,
      aggregateType,
      applyEvent,
      initialState,
      toVersion
    );
  }

  static async createSnapshot(
    aggregateId: string,
    aggregateType: string,
    applyEvent?: (state: Record<string, any>, event: DomainEvent) => Record<string, any>,
    initialState: Record<string, any> = {}
  ): Promise<Snapshot | null> {
    try {
      const state = applyEvent 
        ? await this.getAggregateState(aggregateId, aggregateType, applyEvent, initialState)
        : {};
      
      const latestVersion = await EventStoreModel.getLatestVersion(aggregateId);

      const snapshot = await EventStoreModel.createSnapshot({
        aggregateId,
        aggregateType,
        version: latestVersion,
        data: state
      });

      logger.info({ aggregateId, aggregateType, version: latestVersion }, 'Snapshot created');
      return snapshot;
    } catch (error) {
      logger.error({ error }, 'Failed to create snapshot');
      return null;
    }
  }

  static async getEvents(aggregateId: string, fromVersion = 1): Promise<DomainEvent[]> {
    return EventStoreModel.getEvents(aggregateId, fromVersion);
  }

  static async getEventHistory(
    aggregateId: string,
    limit = 100,
    offset = 0
  ): Promise<{ events: DomainEvent[], total: number }> {
    const events = await EventStoreModel.getEvents(aggregateId);
    const total = events.length;

    return {
      events: events.slice(offset, offset + limit),
      total
    };
  }
}
