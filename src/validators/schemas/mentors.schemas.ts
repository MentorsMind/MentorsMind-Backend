// @ts-nocheck
/**
 * Mentor Validation Schemas
 */

import { z } from 'zod';
import { idParamSchema, nameSchema, longTextSchema, urlSchema } from './common.schemas';

// ---------------------------------------------------------------------------
// Reusable building blocks
// ---------------------------------------------------------------------------

const hourlyRateSchema = z
  .number({ invalid_type_error: 'Hourly rate must be a number' })
  .min(0, 'Hourly rate must be non-negative')
  .max(10000, 'Hourly rate cannot exceed 10000');

const expertiseSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1, 'At least one expertise area is required')
  .max(20, 'Cannot exceed 20 expertise areas');

const timeSlotSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
});

const dayScheduleSchema = z.object({
  enabled: z.boolean(),
  slots: z.array(timeSlotSchema).max(10, 'Cannot exceed 10 time slots per day'),
});

const availabilityScheduleSchema = z.object({
  monday: dayScheduleSchema.optional(),
  tuesday: dayScheduleSchema.optional(),
  wednesday: dayScheduleSchema.optional(),
  thursday: dayScheduleSchema.optional(),
  friday: dayScheduleSchema.optional(),
  saturday: dayScheduleSchema.optional(),
  sunday: dayScheduleSchema.optional(),
});

// ---------------------------------------------------------------------------
// Endpoint schemas
// ---------------------------------------------------------------------------

export const createMentorProfileSchema = z.object({
  body: z.object({
    bio: longTextSchema.optional(),
    avatarUrl: urlSchema.optional(),
    hourlyRate: hourlyRateSchema,
    expertise: expertiseSchema,
    yearsOfExperience: z.number().int().min(0).max(60).optional(),
    timezone: z.string().trim().max(50).optional(),
    availabilitySchedule: availabilityScheduleSchema.optional(),
  }).strict(),
});

export const updateMentorProfileSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    bio: longTextSchema.optional(),
    avatarUrl: urlSchema.optional(),
    hourlyRate: hourlyRateSchema.optional(),
    expertise: expertiseSchema.optional(),
    yearsOfExperience: z.number().int().min(0).max(60).optional(),
    timezone: z.string().trim().max(50).optional(),
    isAvailable: z.boolean().optional(),
  }).strict(),
});

export const listMentorsSchema = z.object({
  query: z.object({
    page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 1)),
    limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 10)),
    search: z.string().trim().max(200).optional(),
    expertise: z.string().trim().max(100).optional(),
    minRate: z.string().optional().transform((v) => (v ? parseFloat(v) : undefined)),
    maxRate: z.string().optional().transform((v) => (v ? parseFloat(v) : undefined)),
    isAvailable: z.string().optional().transform((v) => v === 'true' ? true : v === 'false' ? false : undefined),
    sortBy: z.enum(['hourlyRate', 'averageRating', 'totalSessions', 'createdAt']).optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  }),
});

export const setAvailabilitySchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    schedule: availabilityScheduleSchema,
    isAvailable: z.boolean().optional(),
  }).strict(),
});

export const updatePricingSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    hourlyRate: hourlyRateSchema,
    currency: z.string().trim().length(3, 'Currency must be a 3-letter code').optional().default('USD'),
  }).strict(),
});

export const getMentorSessionsSchema = z.object({
  params: idParamSchema.shape.params,
  query: z.object({
    page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 1)),
    limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 10)),
    status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  }),
});

export const getMentorEarningsSchema = z.object({
  params: idParamSchema.shape.params,
  query: z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    groupBy: z.enum(['day', 'week', 'month']).optional().default('month'),
  }),
});

export const submitVerificationSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    documentType: z.enum(['passport', 'national_id', 'drivers_license']),
    documentUrl: urlSchema,
    linkedinUrl: urlSchema.optional(),
    additionalNotes: longTextSchema.optional(),
  }).strict(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateMentorProfileInput = z.infer<typeof createMentorProfileSchema>['body'];
export type UpdateMentorProfileInput = z.infer<typeof updateMentorProfileSchema>['body'];
export type ListMentorsQuery = z.infer<typeof listMentorsSchema>['query'];
export type SetAvailabilityInput = z.infer<typeof setAvailabilitySchema>['body'];
export type UpdatePricingInput = z.infer<typeof updatePricingSchema>['body'];
export type GetMentorSessionsQuery = z.infer<typeof getMentorSessionsSchema>['query'];
export type GetMentorEarningsQuery = z.infer<typeof getMentorEarningsSchema>['query'];
export type SubmitVerificationInput = z.infer<typeof submitVerificationSchema>['body'];
