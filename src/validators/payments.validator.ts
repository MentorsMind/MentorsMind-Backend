/**
 * Payments Validator
 *
 * Canonical location for Zod schemas that validate payment-related
 * request inputs. The listUserPaymentsSchema intentionally derives its
 * enum values from the PaymentStatus / PaymentType types in
 * payments.service.ts so there is a single source of truth.
 *
 * The schemas are also re-exported from here so routes/controllers can
 * import directly from this file instead of reaching into the raw
 * schemas directory.
 */

import { z } from 'zod';
import { cursorPaginationSchema } from './schemas/common.schemas';

// ---------------------------------------------------------------------------
// Enum values — kept in sync with PaymentStatus / PaymentType in
// src/services/payments.service.ts
// ---------------------------------------------------------------------------

export const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'refunded',
] as const;

export const PAYMENT_TYPES = [
  'payment',
  'refund',
  'platform_fee',
  'mentor_payout',
  'escrow_hold',
  'escrow_release',
] as const;

export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];
export type PaymentTypeValue = (typeof PAYMENT_TYPES)[number];

// ---------------------------------------------------------------------------
// listUserPayments query-parameter schema
// ---------------------------------------------------------------------------

/**
 * Validates the query parameters accepted by GET /api/v1/payments.
 *
 * - `status`  must be one of the valid PaymentStatus enum values.
 * - `type`    must be one of the valid PaymentType enum values.
 * - `cursor`, `limit`, `from`, `to` follow the shared pagination schema.
 *
 * Invalid values return HTTP 400 with a clear validation message via the
 * `validate()` middleware.
 */
export const listUserPaymentsSchema = z.object({
  query: cursorPaginationSchema.shape.query.extend({
    status: z
      .enum(PAYMENT_STATUSES)
      .optional(),
    type: z
      .enum(PAYMENT_TYPES)
      .optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});

export type ListUserPaymentsQuery = z.infer<typeof listUserPaymentsSchema>['query'];

// ---------------------------------------------------------------------------
// Re-export all other payment schemas for convenience
// ---------------------------------------------------------------------------
export {
  initiatePaymentSchema,
  confirmPaymentSchema,
  refundPaymentSchema,
  webhookPaymentSchema,
  getPaymentByIdSchema,
  type InitiatePaymentInput,
  type ConfirmPaymentInput,
  type RefundPaymentInput,
} from './schemas/payments.schemas';
