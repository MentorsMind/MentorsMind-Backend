/**
 * Booking Validation Schemas
 * Zod schemas for booking endpoints.
 */

import { z } from 'zod';
import { idParamSchema, shortTextSchema, longTextSchema, paginationSchema } from './common.schemas';

export const createBookingSchema = z.object({
  body: z.object({
    mentorId: z.string().uuid('Mentor ID must be a valid UUID'),
    scheduledAt: z
      .string()
      .min(1, 'Scheduled time is required')
      .datetime({ message: 'scheduledAt must be an ISO 8601 datetime string' })
      .refine(
        (v) => new Date(v) > new Date(),
        { message: 'Booking must be scheduled in the future' }
      ),
    durationMinutes: z
      .number()
      .int('Duration must be a whole number of minutes')
      .min(15, 'Session must be at least 15 minutes')
      .max(240, 'Session cannot exceed 4 hours'),
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
      .max(240)
      .optional(),
    topic: shortTextSchema.optional(),
    notes: longTextSchema.optional(),
  }).strict(),
});

export const rescheduleBookingSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    scheduledAt: z
      .string()
      .min(1, 'New scheduled time is required')
      .datetime({ message: 'scheduledAt must be an ISO 8601 datetime string' })
      .refine(
        (v) => new Date(v) > new Date(),
        { message: 'Booking must be scheduled in the future' }
      ),
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
