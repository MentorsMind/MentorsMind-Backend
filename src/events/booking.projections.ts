/**
 * Booking projection handlers — registers concrete read-model updaters
 * with ProjectionService for the Booking aggregate.
 *
 * Handlers (issue requirements):
 * - BookingCreated       → insert/upsert bookings read model
 * - BookingStatusChanged → update status + payment_status
 * - BookingCancelled     → update status + cancellation_reason, enqueue refund
 *
 * Call `registerBookingProjectionHandlers()` once at server startup.
 */

import { DomainEvent } from "../models/event.model";
import { ProjectionService } from "../services/projection.service";
import { QueueService } from "../services/queue.service";
import { db } from "../config/database";
import { Logger } from "../utils/logger.utils";
import {
  BOOKING_AGGREGATE_TYPE,
  BookingProjectionEventType,
  normalizeBookingEvent,
} from "./booking.reducer";

async function projectBookingCreated(event: DomainEvent): Promise<void> {
  const e = normalizeBookingEvent(event);
  const d = e.data || {};

  await db.query(
    `INSERT INTO bookings (
       id, mentee_id, mentor_id, scheduled_at, duration_minutes,
       topic, notes, status, amount, currency, payment_status, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (id) DO UPDATE SET
       mentee_id = EXCLUDED.mentee_id,
       mentor_id = EXCLUDED.mentor_id,
       scheduled_at = EXCLUDED.scheduled_at,
       duration_minutes = EXCLUDED.duration_minutes,
       topic = EXCLUDED.topic,
       notes = EXCLUDED.notes,
       status = EXCLUDED.status,
       amount = EXCLUDED.amount,
       currency = EXCLUDED.currency,
       payment_status = EXCLUDED.payment_status,
       updated_at = NOW()`,
    [
      e.aggregateId,
      d.menteeId ?? d.mentee_id,
      d.mentorId ?? d.mentor_id,
      d.scheduledAt ?? d.scheduled_at,
      d.durationMinutes ?? d.duration_minutes,
      d.topic,
      d.notes ?? null,
      d.status ?? "pending",
      d.amount,
      d.currency ?? "XLM",
      d.paymentStatus ?? d.payment_status ?? "pending",
    ],
  );

  logger.info(
    { bookingId: e.aggregateId, version: e.version },
    "Projection BookingCreated applied",
  );
}

async function projectBookingStatusChanged(event: DomainEvent): Promise<void> {
  const e = normalizeBookingEvent(event);
  const d = e.data || {};
  const status = d.status ?? d.newStatus;
  const paymentStatus = d.paymentStatus ?? d.payment_status ?? d.newPaymentStatus;

  if (!status && !paymentStatus) {
    logger.warn(
      { bookingId: e.aggregateId },
      "BookingStatusChanged missing status fields — skipping",
    );
    return;
  }

  await db.query(
    `UPDATE bookings
     SET status = COALESCE($2, status),
         payment_status = COALESCE($3, payment_status),
         updated_at = NOW()
     WHERE id = $1`,
    [e.aggregateId, status ?? null, paymentStatus ?? null],
  );

  logger.info(
    { bookingId: e.aggregateId, status, paymentStatus, version: e.version },
    "Projection BookingStatusChanged applied",
  );
}

async function projectBookingCancelled(event: DomainEvent): Promise<void> {
  const e = normalizeBookingEvent(event);
  const d = e.data || {};
  const reason =
    d.cancellationReason ?? d.cancellation_reason ?? "No reason provided";
  const paymentStatus = d.paymentStatus ?? d.payment_status ?? null;

  await db.query(
    `UPDATE bookings
     SET status = 'cancelled',
         cancellation_reason = $2,
         payment_status = COALESCE($3, payment_status),
         updated_at = NOW()
     WHERE id = $1`,
    [e.aggregateId, reason, paymentStatus],
  );

  const refundEligible = Boolean(d.refundEligible);
  const transactionId = d.transactionId ?? d.transaction_id;
  const refundPercentage = Number(d.refundPercentage ?? 0);
  const amount = d.amount != null ? parseFloat(String(d.amount)) : NaN;
  const menteeId = d.menteeId ?? d.mentee_id;

  if (
    refundEligible &&
    transactionId &&
    menteeId &&
    Number.isFinite(amount) &&
    amount > 0
  ) {
    try {
      await QueueService.submitStellarTx(
        {
          type: "refund",
          paymentId: String(transactionId),
          amount: String(amount * (refundPercentage / 100)),
          currency: d.currency ?? "XLM",
          userId: String(menteeId),
          description: reason,
        },
        `refund:booking:${e.aggregateId}`,
      );
      logger.info(
        { bookingId: e.aggregateId },
        "Projection BookingCancelled enqueued refund job",
      );
    } catch (err) {
      logger.error(
        { err, bookingId: e.aggregateId },
        "Projection BookingCancelled failed to enqueue refund",
      );
    }
  }

  logger.info(
    { bookingId: e.aggregateId, version: e.version },
    "Projection BookingCancelled applied",
  );
}

/**
 * Register the three required booking projection handlers.
 * Idempotent enough for startup — callers should invoke once.
 */
export function registerBookingProjectionHandlers(): void {
  ProjectionService.registerHandler(
    BOOKING_AGGREGATE_TYPE,
    BookingProjectionEventType.BookingCreated,
    projectBookingCreated,
  );

  ProjectionService.registerHandler(
    BOOKING_AGGREGATE_TYPE,
    BookingProjectionEventType.BookingStatusChanged,
    projectBookingStatusChanged,
  );

  ProjectionService.registerHandler(
    BOOKING_AGGREGATE_TYPE,
    BookingProjectionEventType.BookingCancelled,
    projectBookingCancelled,
  );

  logger.info(
    {
      aggregateType: BOOKING_AGGREGATE_TYPE,
      handlers: [
        BookingProjectionEventType.BookingCreated,
        BookingProjectionEventType.BookingStatusChanged,
        BookingProjectionEventType.BookingCancelled,
      ],
      registeredCount: ProjectionService.getHandlerCount(),
    },
    "Booking projection handlers registered",
  );
}

export const BookingEventHandlers = {
  register: registerBookingProjectionHandlers,
  projectBookingCreated,
  projectBookingStatusChanged,
  projectBookingCancelled,
};
