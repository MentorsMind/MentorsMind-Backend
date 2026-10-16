/**
 * Booking Validation Schemas
 * Zod schemas for booking endpoints.
 */

import { z } from 'zod';
import { idParamSchema, shortTextSchema, longTextSchema, paginationSchema } from './common.schemas';

/**
 * Shared 30-minute future check used by both booking creation and
 * rescheduling (issue #1299). Extracted so both paths enforce the same rule.
 */
export const futureScheduledAt = z
  .string()
  .min(1, 'Scheduled time is required')
  .datetime({ message: 'scheduledAt must be an ISO 8601 datetime string' })
  .refine(
    (v) => new Date(v) > new Date(Date.now() + 30 * 60 * 1000),
    { message: 'scheduledAt must be at least 30 minutes in the future' }
  );

/** Service-layer guard mirroring `futureScheduledAt` for non-HTTP callers. */
export function isFutureScheduledAt(value: Date | string): boolean {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return time > Date.now() + 30 * 60 * 1000;
}

export const createBookingSchema = z.object({
  body: z.object({
    mentorId: z.string().uuid('Mentor ID must be a valid UUID'),
    scheduledAt: z
      .string()
      .min(1, 'Scheduled time is required')
      .datetime({ message: 'scheduledAt must be an ISO 8601 datetime string' })
      .refine(
        (v) => new Date(v) > new Date(Date.now() + 30 * 60 * 1000),
        { message: 'scheduledAt must be at least 30 minutes in the future' }
      ),
    durationMinutes: z
      .number()
      .int('Duration must be a whole number of minutes')
      .min(15, 'Session must be at least 15 minutes')
      .max(480, 'Session cannot exceed 8 hours')
      .refine((value) => value % 15 === 0, {
        message: 'Duration must be a multiple of 15 minutes',
      }),
    topic: shortTextSchema,
    notes: longTextSchema.optional(),
  }).strict(),
});

export const updateBookingSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    scheduledAt: z
      .string()
      .datetime({ message: 'scheduledAt must be an ISO 8601 datetime string' })
      .refine(
        (v) => new Date(v) > new Date(),
        { message: 'Booking must be scheduled in the future' }
      )
      .optional(),
    durationMinutes: z
      .number()
      .int()
      .min(15)
      .max(480)
      .refine((value) => value % 15 === 0, {
        message: 'Duration must be a multiple of 15 minutes',
      })
      .optional(),
    topic: shortTextSchema.optional(),
    notes: longTextSchema.optional(),
  }).strict(),
});

export const rescheduleBookingSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    scheduledAt: futureScheduledAt,
    reason: shortTextSchema.optional(),
  }).strict(),
});

export const cancelBookingSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    reason: shortTextSchema.optional(),
  }).strict(),
});

export const listBookingsSchema = z.object({
  query: paginationSchema.shape.query.extend({
    status: z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'rescheduled']).optional(),
  }),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>['body'];
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>['body'];
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>['body'];
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>['body'];
export type ListBookingsQuery = z.infer<typeof listBookingsSchema>['query'];
