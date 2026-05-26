import { z } from 'zod';
import {
  SUPPORTED_EVENT_TYPES,
  SUPPORTED_RESOURCE_TYPES,
  SUPPORTED_FILTER_STATUSES,
} from '../../services/webhook.service';
import { uuidSchema } from './common.schemas';

const eventTypeEnum = z.enum(SUPPORTED_EVENT_TYPES);
const resourceTypeEnum = z.enum(SUPPORTED_RESOURCE_TYPES);
const filterStatusEnum = z.enum(SUPPORTED_FILTER_STATUSES);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createWebhookSchema = z.object({
  body: z.object({
    url: z
      .string({ required_error: 'url is required' })
      .url('url must be a valid URL')
      .max(2048, 'url must not exceed 2048 characters'),

    event_types: z
      .array(eventTypeEnum, { required_error: 'event_types is required' })
      .min(1, 'event_types must contain at least one event')
      .max(50, 'event_types must not exceed 50 entries'),

    /** Optional: only deliver events whose resource type matches one of these */
    resource_types: z
      .array(resourceTypeEnum)
      .max(20)
      .optional()
      .default([]),

    /** Optional: only deliver events whose status matches one of these */
    filter_statuses: z
      .array(filterStatusEnum)
      .max(20)
      .optional()
      .default([]),

    description: z
      .string()
      .max(500, 'description must not exceed 500 characters')
      .optional(),
  }),
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const updateWebhookSchema = z.object({
  params: z.object({ id: uuidSchema }),
  body: z
    .object({
      url: z.string().url('url must be a valid URL').max(2048).optional(),
      event_types: z.array(eventTypeEnum).min(1).max(50).optional(),
      resource_types: z.array(resourceTypeEnum).max(20).optional(),
      filter_statuses: z.array(filterStatusEnum).max(20).optional(),
      description: z.string().max(500).optional(),
    })
    .refine(
      (b) =>
        b.url !== undefined ||
        b.event_types !== undefined ||
        b.resource_types !== undefined ||
        b.filter_statuses !== undefined ||
        b.description !== undefined,
      { message: 'At least one field must be provided for update' },
    ),
});

// ---------------------------------------------------------------------------
// Param-only routes
// ---------------------------------------------------------------------------

export const webhookIdParamSchema = z.object({
  params: z.object({ id: uuidSchema }),
});

export const webhookDeliveriesQuerySchema = z.object({
  params: z.object({ id: uuidSchema }),
  query: z.object({
    limit: z
      .string()
      .optional()
      .transform((v) => (v ? Math.min(parseInt(v, 10), 100) : 50)),
    offset: z
      .string()
      .optional()
      .transform((v) => (v ? parseInt(v, 10) : 0)),
  }),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type CreateWebhookBody = z.infer<typeof createWebhookSchema>['body'];
export type UpdateWebhookBody = z.infer<typeof updateWebhookSchema>['body'];
