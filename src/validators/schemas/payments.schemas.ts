/**
 * Payment Validation Schemas
 */

import { z } from 'zod';
import { idParamSchema, uuidSchema, longTextSchema, stellarTxHashSchema } from './common.schemas';

const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, 'Amount must be a valid decimal with up to 7 decimal places')
  .refine((v) => parseFloat(v) > 0, 'Amount must be greater than 0');

const currencySchema = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Z0-9]+$/, 'Currency code must be uppercase letters or digits')
  .default('XLM');

export const initiatePaymentSchema = z.object({
  body: z.object({
    bookingId: uuidSchema,
    amount: amountSchema,
    currency: currencySchema.optional(),
    description: longTextSchema.optional(),
    fromAddress: z
      .string()
      .trim()
      .regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar address')
      .optional(),
    toAddress: z
      .string()
      .trim()
      .regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar address')
      .optional(),
  }).strict(),
});

export const confirmPaymentSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    stellarTxHash: stellarTxHashSchema,
  }).strict(),
});

export const refundPaymentSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    reason: z.string().trim().min(5).max(1000).optional(),
    stellarTxHash: stellarTxHashSchema.optional(),
  }).strict().optional(),
});

export const webhookPaymentSchema = z.object({
  body: z.object({
    type: z.string().min(1),
    transaction_hash: stellarTxHashSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    amount: z.string().optional(),
    asset_code: z.string().optional(),
    memo: z.string().optional(),
  }),
});

export const listPaymentsSchema = z.object({
  query: z.object({
    page: z
      .string()
      .optional()
      .transform((v) => (v ? parseInt(v, 10) : 1))
      .refine((v) => v >= 1, 'Page must be at least 1'),
    limit: z
      .string()
      .optional()
      .transform((v) => (v ? parseInt(v, 10) : 20))
      .refine((v) => v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
    status: z
      .enum(['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded'])
      .optional(),
    type: z
      .enum(['deposit', 'withdrawal', 'payment', 'refund', 'platform_fee', 'mentor_payout', 'escrow_hold', 'escrow_release'])
      .optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});

export const getPaymentByIdSchema = idParamSchema;

export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>['body'];
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>['body'];
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsSchema>['query'];
