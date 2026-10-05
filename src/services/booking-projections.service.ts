/**
 * @file booking-projections.service.ts
 * @description Rebuilds the `bookings` table (read model) from the event stream.
 *
 * This service implements the projection / read-side of the CQRS pattern.
 * It folds a sequence of `DomainEvent` records into a `Partial<BookingRecord>`
 * and upserts that state into the `bookings` table so that query handlers
 * always read from a fast, denormalised relational snapshot rather than
 * replaying the full event log on every request.
 *
 * Usage:
 *   // At application bootstrap:
 *   BookingProjectionsService.registerProjectionHandlers();
 *
 *   // To force a full rebuild (e.g. after schema migrations):
 *   const result = await BookingProjectionsService.replayAll();
 */

import { DomainEvent } from '../models/event.model';
import { BookingRecord } from '../models/booking.model';
import { BookingEventType } from '../models/booking-events.model';
import {
  BookingCreatedPayload,
  BookingConfirmedPayload,
  BookingCompletedPayload,
  BookingCancelledPayload,
  BookingRescheduledPayload,
  BookingPaymentUpdatedPayload,
} from '../models/booking-events.model';
import { EventStoreService } from './event-store.service';
import { ProjectionService } from './projection.service';
import { db } from '../config/database';
import { logger } from '../utils/logger.utils';

// ---------------------------------------------------------------------------
// Internal helper types
// ---------------------------------------------------------------------------

/**
 * A DB row from `domain_events` as actually returned by the pg driver.
 * The interface `DomainEvent` uses camelCase (TypeScript convention), but
 * `pg` returns raw snake_case column names.  We cast to this union when we
 * need to read the discriminant column.
 */
type RawDomainEvent = DomainEvent & {
  /** Raw pg column â€” present on rows returned directly from SQL queries */
  event_type?: string;
  aggregate_id?: string;
};

/**
 * Extended booking state that includes the `version` column added by
 * migration 080_event_sourcing_enhancements.sql.  `BookingRecord` predates
 * that migration so it does not declare `version`.
 */
type BookingState = Partial<BookingRecord> & { version?: number };

// ---------------------------------------------------------------------------
// BookingProjectionsService
// ---------------------------------------------------------------------------

/**
 * Projection service for the `Booking` aggregate.
 *
 * All methods are static â€” no instance state is needed because the projection
 * logic is purely functional (event â†’ state fold) and I/O is delegated to
 * the shared `db` pool.
 */
export class BookingProjectionsService {
  // -------------------------------------------------------------------------
  // applyEvent
  // -------------------------------------------------------------------------

  /**
   * Applies a single domain event to the current booking state, returning
   * the new (immutable) state.
   *
   * @param state  - Current accumulated state (may be empty `{}` for the first event).
   * @param event  - The domain event to apply.
   * @returns      Updated state with the event's payload merged in.
   */
  static applyEvent(
    state: BookingState,
    event: DomainEvent,
  ): BookingState {
    // The DomainEvent TypeScript interface uses `eventType` (camelCase), but
    // rows returned directly from the pg driver carry the raw column name
    // `event_type` (snake_case).  Support both so this method works whether
    // called with a hydrated model object or a raw DB row.
    const raw = event as RawDomainEvent;
    const eventType: string = raw.event_type ?? event.eventType;

    // Resolve the timestamp for `updated_at`.
    // DomainEvent.metadata uses `timestamp`; guard against undefined.
    const updatedAt: Date =
      (event.metadata?.timestamp instanceof Date
        ? event.metadata.timestamp
        : event.metadata?.timestamp
          ? new Date(event.metadata.timestamp as unknown as string)
          : null) ?? new Date();

    switch (eventType) {
      // -----------------------------------------------------------------------
      case BookingEventType.BookingCreated: {
        const p = event.data as BookingCreatedPayload;
        return {
          ...state,
          id: event.aggregateId ?? raw.aggregate_id,
          mentee_id: p.menteeId,
          mentor_id: p.mentorId,
          scheduled_at: p.scheduledAt instanceof Date ? p.scheduledAt : new Date(p.scheduledAt),
          duration_minutes: p.durationMinutes,
          topic: p.topic,
          notes: p.notes ?? null,
          amount: p.amount,
          currency: p.currency,
          status: 'pending',
          payment_status: 'pending',
          stellar_tx_hash: null,
          transaction_id: null,
          cancellation_reason: null,
          version: event.version,
          updated_at: updatedAt,
        };
      }

      // -----------------------------------------------------------------------
      case BookingEventType.BookingConfirmed: {
        const p = event.data as BookingConfirmedPayload;
        return {
          ...state,
          status: 'confirmed',
          // Store escrow details in transaction_id / stellar_tx_hash when present
          ...(p.escrowId !== undefined ? { transaction_id: p.escrowId } : {}),
          ...(p.escrowContractAddress !== undefined
            ? { stellar_tx_hash: p.escrowContractAddress }
            : {}),
          version: event.version,
          updated_at: updatedAt,
        };
      }

      // -----------------------------------------------------------------------
      case BookingEventType.BookingCompleted: {
        const p = event.data as BookingCompletedPayload;
        return {
          ...state,
          status: 'completed',
          ...(p.sessionId !== undefined ? { session_id: p.sessionId } : {}),
          version: event.version,
          updated_at: updatedAt,
        };
      }

      // -----------------------------------------------------------------------
      case BookingEventType.BookingCancelled: {
        const p = event.data as BookingCancelledPayload;
        return {
          ...state,
          status: 'cancelled',
          cancellation_reason: p.cancellationReason,
          version: event.version,
          updated_at: updatedAt,
        };
      }

      // -----------------------------------------------------------------------
      case BookingEventType.BookingRescheduled: {
        const p = event.data as BookingRescheduledPayload;
        return {
          ...state,
          status: 'rescheduled' as BookingRecord['status'],
          scheduled_at:
            p.newScheduledAt instanceof Date
              ? p.newScheduledAt
              : new Date(p.newScheduledAt),
          version: event.version,
          updated_at: updatedAt,
        };
      }

      // -----------------------------------------------------------------------
      case BookingEventType.BookingPaymentUpdated: {
        const p = event.data as BookingPaymentUpdatedPayload;
        return {
          ...state,
          payment_status: p.newPaymentStatus as BookingRecord['payment_status'],
          ...(p.stellarTxHash !== undefined
            ? { stellar_tx_hash: p.stellarTxHash }
            : {}),
          ...(p.transactionId !== undefined
            ? { transaction_id: p.transactionId }
            : {}),
          version: event.version,
          updated_at: updatedAt,
        };
      }

      // -----------------------------------------------------------------------
      default:
        logger.warn(
          { eventType, aggregateId: event.aggregateId ?? raw.aggregate_id },
          'BookingProjectionsService.applyEvent: unknown event type â€” skipping',
        );
        return state;
    }
  }

  // -------------------------------------------------------------------------
  // rebuildBooking
  // -------------------------------------------------------------------------

  /**
   * Rebuilds the booking state by folding all events for a given booking ID
   * through `applyEvent`.
   *
   * @param bookingId - The UUID of the booking aggregate.
   * @returns         Final projected state after all events have been applied.
   */
  static async rebuildBooking(bookingId: string): Promise<BookingState> {
    const events = await EventStoreService.getEvents(bookingId, 1);

    if (events.length === 0) {
      logger.warn({ bookingId }, 'BookingProjectionsService.rebuildBooking: no events found');
      return {};
    }

    const finalState = events.reduce<BookingState>(
      (state, event) => BookingProjectionsService.applyEvent(state, event),
      {},
    );

    logger.debug(
      { bookingId, eventCount: events.length, version: finalState.version },
      'BookingProjectionsService.rebuildBooking: rebuilt from events',
    );

    return finalState;
  }

  // -------------------------------------------------------------------------
  // projectToDatabase
  // -------------------------------------------------------------------------

  /**
   * Rebuilds the booking state from its event stream and upserts it into the
   * `bookings` table.  Uses `INSERT ... ON CONFLICT (id) DO UPDATE SET` so
   * the operation is idempotent and safe to replay multiple times.
   *
   * @param bookingId - The UUID of the booking aggregate.
   */
  static async projectToDatabase(bookingId: string): Promise<void> {
    let state: BookingState;

    try {
      state = await BookingProjectionsService.rebuildBooking(bookingId);
    } catch (err) {
      logger.error(
        { err, bookingId },
        'BookingProjectionsService.projectToDatabase: failed to rebuild booking state',
      );
      throw err;
    }

    if (!state.id) {
      // No BookingCreated event was found â€” nothing to upsert.
      logger.warn(
        { bookingId },
        'BookingProjectionsService.projectToDatabase: state has no id, skipping upsert',
      );
      return;
    }

    try {
      await db.query(
        `INSERT INTO bookings (
          id,
          mentee_id,
          mentor_id,
          scheduled_at,
          duration_minutes,
          topic,
          notes,
          status,
          amount,
          currency,
          payment_status,
          stellar_tx_hash,
          transaction_id,
          cancellation_reason,
          session_id,
          version,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (id) DO UPDATE SET
          mentee_id          = EXCLUDED.mentee_id,
          mentor_id          = EXCLUDED.mentor_id,
          scheduled_at       = EXCLUDED.scheduled_at,
          duration_minutes   = EXCLUDED.duration_minutes,
          topic              = EXCLUDED.topic,
          notes              = EXCLUDED.notes,
          status             = EXCLUDED.status,
          amount             = EXCLUDED.amount,
          currency           = EXCLUDED.currency,
          payment_status     = EXCLUDED.payment_status,
          stellar_tx_hash    = EXCLUDED.stellar_tx_hash,
          transaction_id     = EXCLUDED.transaction_id,
          cancellation_reason = EXCLUDED.cancellation_reason,
          session_id         = EXCLUDED.session_id,
          version            = EXCLUDED.version,
          updated_at         = EXCLUDED.updated_at`,
        [
          state.id,
          state.mentee_id ?? null,
          state.mentor_id ?? null,
          state.scheduled_at ?? null,
          state.duration_minutes ?? null,
          state.topic ?? null,
          state.notes ?? null,
          state.status ?? 'pending',
          state.amount ?? '0',
          state.currency ?? 'XLM',
          state.payment_status ?? 'pending',
          state.stellar_tx_hash ?? null,
          state.transaction_id ?? null,
          state.cancellation_reason ?? null,
          state.session_id ?? null,
          state.version ?? 1,
          state.updated_at ?? new Date(),
        ],
      );

      logger.info(
        { bookingId, version: state.version },
        'BookingProjectionsService.projectToDatabase: upsert succeeded',
      );
    } catch (err) {
      logger.error(
        { err, bookingId },
        'BookingProjectionsService.projectToDatabase: upsert failed',
      );
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // replayAll
  // -------------------------------------------------------------------------

  /**
   * Replays all booking projections by querying every distinct `aggregate_id`
   * in the `domain_events` table where `aggregate_type = 'Booking'` and
   * calling `projectToDatabase` for each one.
   *
   * Processes IDs in batches to avoid overwhelming the database connection
   * pool.
   *
   * @param batchSize - Number of booking IDs to process per batch (default 100).
   * @returns         Summary of replayed and errored projections.
   */
  static async replayAll(
    batchSize = 100,
  ): Promise<{ replayed: number; errors: number }> {
    logger.info({ batchSize }, 'BookingProjectionsService.replayAll: starting full replay');

    let replayed = 0;
    let errors = 0;
    let offset = 0;

    while (true) {
      const { rows } = await db.query(
        `SELECT DISTINCT aggregate_id
         FROM   domain_events
         WHERE  aggregate_type = 'Booking'
         ORDER  BY aggregate_id
         LIMIT  $1
         OFFSET $2`,
        [batchSize, offset],
      );

      if (rows.length === 0) {
        break;
      }

      // Process this batch concurrently but with error isolation so one
      // failure does not abort the remaining IDs.
      const results = await Promise.allSettled(
        rows.map((row: { aggregate_id: string }) =>
          BookingProjectionsService.projectToDatabase(row.aggregate_id),
        ),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          replayed++;
        } else {
          errors++;
          logger.error(
            { err: result.reason },
            'BookingProjectionsService.replayAll: projection failed for one booking',
          );
        }
      }

      offset += rows.length;

      // If we received fewer rows than the batch size we've reached the end.
      if (rows.length < batchSize) {
        break;
      }
    }

    logger.info(
      { replayed, errors },
      'BookingProjectionsService.replayAll: completed',
    );

    return { replayed, errors };
  }

  // -------------------------------------------------------------------------
  // registerProjectionHandlers
  // -------------------------------------------------------------------------

  /**
   * Registers real-time projection handlers with `ProjectionService` for all
   * 6 booking event types.  Each handler triggers a targeted `projectToDatabase`
   * call so the read model is kept in sync as events are published.
   *
   * Call this **once** at application bootstrap, e.g. in `server.ts` after the
   * database connection has been established.
   *
   * @example
   *   // In server.ts
   *   BookingProjectionsService.registerProjectionHandlers();
   */
  static registerProjectionHandlers(): void {
    const aggregateType = 'Booking';

    const eventTypes: BookingEventType[] = [
      BookingEventType.BookingCreated,
      BookingEventType.BookingConfirmed,
      BookingEventType.BookingCompleted,
      BookingEventType.BookingCancelled,
      BookingEventType.BookingRescheduled,
      BookingEventType.BookingPaymentUpdated,
    ];

    for (const eventType of eventTypes) {
      ProjectionService.registerHandler(
        aggregateType,
        eventType,
        async (event: DomainEvent) => {
          const raw = event as RawDomainEvent;
          const bookingId = event.aggregateId ?? raw.aggregate_id ?? '';

          if (!bookingId) {
            logger.warn(
              { eventType },
              'BookingProjectionsService: handler received event without aggregateId',
            );
            return;
          }

          try {
            await BookingProjectionsService.projectToDatabase(bookingId);
          } catch (err) {
            // Log but do not re-throw so one bad projection does not crash the
            // entire event-handling pipeline.
            logger.error(
              { err, bookingId, eventType },
              'BookingProjectionsService: real-time projection failed',
            );
          }
        },
      );
    }

    logger.info(
      { eventTypes },
      'BookingProjectionsService.registerProjectionHandlers: handlers registered',
    );
  }
}

