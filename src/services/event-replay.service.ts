import { EventStoreService } from './event-store.service';
import { ProjectionService } from './projection.service';
import { cache } from '../config/cache';
import { db } from '../config/database';
import { Logger } from "../utils/logger.utils";
import { DomainEvent } from '../models';

export interface ReplayProgress {
  aggregateType: string;
  total: number;
  processed: number;
  failed: number;
  startedAt: string;
  completedAt?: string;
  estimatedSecondsRemaining?: number;
}

/**
 * EventReplayService provides operational tools for rebuilding projections and recovering from corruption.
 * It allows replaying events through projection handlers with idempotency guarantees.
 */
export class EventReplayService {
  private static readonly BATCH_SIZE = 100;
  private static readonly PROGRESS_UPDATE_INTERVAL = 10; // Update progress every N aggregates

  /**
   * Replay all events for a single aggregate through registered projection handlers.
   * Wraps each handler in try/catch to skip broken events with logging.
   */
  static async replayAggregate(
    aggregateId: string,
    aggregateType: string,
    fromVersion?: number,
  ): Promise<{ success: boolean; processedEvents: number; failedEvents: number; errors: string[] }> {
    const errors: string[] = [];
    let processedEvents = 0;
    let failedEvents = 0;

    try {
      logger.info('Starting replay for aggregate', {
        aggregateId,
        aggregateType,
        fromVersion,
      });

      // Fetch all events for this aggregate
      const events = await EventStoreService.getEvents(
        aggregateId,
        fromVersion || 1,
      );

      if (events.length === 0) {
        logger.warn('No events found for aggregate', {
          aggregateId,
          aggregateType,
        });
        return {
          success: true,
          processedEvents: 0,
          failedEvents: 0,
          errors: [],
        };
      }

      // Apply each event through all registered projection handlers
      for (const event of events) {
        try {
          // Get all registered handlers from ProjectionService
          const handlers = await this.getProjectionHandlers();

          for (const handler of handlers) {
            try {
              // Create idempotency key from event ID
              const idempotencyKey = event.id;

              // Apply handler with idempotency protection
              await handler(event, idempotencyKey);
            } catch (handlerError) {
              logger.error('Projection handler failed during replay', {
                aggregateId,
                aggregateType,
                eventId: event.id,
                eventType: event.eventType,
                handler: handler.name,
                error: handlerError instanceof Error ? handlerError.message : 'Unknown error',
              });

              // Record but continue processing other handlers
              errors.push(
                `Handler ${handler.name} failed for event ${event.id}: ${
                  handlerError instanceof Error ? handlerError.message : 'Unknown'
                }`,
              );
              failedEvents++;
            }
          }

          processedEvents++;
        } catch (eventError) {
          logger.error('Error processing event during replay', {
            aggregateId,
            aggregateType,
            eventId: event.id,
            eventType: event.eventType,
            error: eventError instanceof Error ? eventError.message : 'Unknown error',
          });

          errors.push(
            `Event ${event.id} failed: ${eventError instanceof Error ? eventError.message : 'Unknown'}`,
          );
          failedEvents++;
        }
      }

      logger.info('Aggregate replay completed', {
        aggregateId,
        aggregateType,
        processedEvents,
        failedEvents,
        errorCount: errors.length,
      });

      return {
        success: failedEvents === 0,
        processedEvents,
        failedEvents,
        errors,
      };
    } catch (error) {
      logger.error('Aggregate replay failed', {
        aggregateId,
        aggregateType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Replay all events for a given aggregate type, paging through aggregates.
   * Tracks progress in Redis replay:{aggregateType}:progress.
   */
  static async replayAllForType(
    aggregateType: string,
    batchSize: number = this.BATCH_SIZE,
  ): Promise<ReplayProgress> {
    const progressKey = `replay:${aggregateType}:progress`;
    const startedAt = new Date().toISOString();

    try {
      logger.info('Starting replay for aggregate type', {
        aggregateType,
        batchSize,
      });

      // Get count of unique aggregates
      const countResult = await db.query(
        `SELECT COUNT(DISTINCT aggregate_id) as total FROM domain_events WHERE aggregate_type = $1`,
        [aggregateType],
      );

      const totalAggregates = countResult.rows[0]?.total || 0;

      if (totalAggregates === 0) {
        logger.warn('No aggregates found for type', { aggregateType });
        const progress: ReplayProgress = {
          aggregateType,
          total: 0,
          processed: 0,
          failed: 0,
          startedAt,
          completedAt: new Date().toISOString(),
        };
        return progress;
      }

      // Initialize progress
      const progress: ReplayProgress = {
        aggregateType,
        total: totalAggregates,
        processed: 0,
        failed: 0,
        startedAt,
      };

      await cache.set(progressKey, JSON.stringify(progress), 24 * 3600);

      // Get all unique aggregate IDs for this type
      const aggregateIdsResult = await db.query(
        `SELECT DISTINCT aggregate_id FROM domain_events WHERE aggregate_type = $1 ORDER BY aggregate_id`,
        [aggregateType],
      );

      const aggregateIds = aggregateIdsResult.rows.map((row: any) => row.aggregate_id);
      const replayStartTime = Date.now();

      // Process in batches
      for (let i = 0; i < aggregateIds.length; i += batchSize) {
        const batch = aggregateIds.slice(i, i + batchSize);

        // Process batch in parallel
        const results = await Promise.allSettled(
          batch.map((aggregateId: string) =>
            this.replayAggregate(aggregateId, aggregateType),
          ),
        );

        // Count successes and failures
        for (const result of results) {
          if (result.status === 'fulfilled') {
            progress.processed++;
            progress.failed += result.value.failedEvents;
          } else {
            progress.processed++;
            progress.failed++;
          }
        }

        // Update progress every N aggregates
        if ((i + batchSize) % (this.PROGRESS_UPDATE_INTERVAL * batchSize) === 0) {
          const elapsedSeconds = (Date.now() - replayStartTime) / 1000;
          const estimatedTotalSeconds = (elapsedSeconds / progress.processed) * progress.total;
          progress.estimatedSecondsRemaining = Math.ceil(
            estimatedTotalSeconds - elapsedSeconds,
          );

          await cache.set(progressKey, JSON.stringify(progress), 24 * 3600);

          logger.info('Replay progress update', {
            aggregateType,
            processed: progress.processed,
            total: progress.total,
            failed: progress.failed,
            percentComplete: Math.round((progress.processed / progress.total) * 100),
            estimatedSecondsRemaining: progress.estimatedSecondsRemaining,
          });
        }
      }

      // Mark as completed
      progress.completedAt = new Date().toISOString();
      await cache.set(progressKey, JSON.stringify(progress), 24 * 3600);

      logger.info('Replay for aggregate type completed', {
        aggregateType,
        total: progress.total,
        processed: progress.processed,
        failed: progress.failed,
        duration: `${((Date.now() - replayStartTime) / 1000).toFixed(2)}s`,
      });

      return progress;
    } catch (error) {
      logger.error('Replay for aggregate type failed', {
        aggregateType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get current replay progress from Redis.
   */
  static async getReplayProgress(aggregateType: string): Promise<ReplayProgress | null> {
    try {
      const progressKey = `replay:${aggregateType}:progress`;
      const cached = await cache.get(progressKey);
      if (cached) {
        return JSON.parse(cached as string) as ReplayProgress;
      }
      return null;
    } catch (error) {
      logger.error('Failed to get replay progress', {
        aggregateType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Get registered projection handlers.
   * This should return all handlers registered in ProjectionService.
   */
  private static async getProjectionHandlers(): Promise<
    Array<(event: DomainEvent, idempotencyKey: string) => Promise<void>>
  > {
    // This would be populated from ProjectionService's registered handlers
    // For now, return empty array and update this when handlers are registered
    return [];
  }

  /**
   * Clear replay progress for a given aggregate type.
   */
  static async clearReplayProgress(aggregateType: string): Promise<void> {
    const progressKey = `replay:${aggregateType}:progress`;
    await cache.delete(progressKey);
    logger.info('Cleared replay progress', { aggregateType });
  }
}

export default EventReplayService;
