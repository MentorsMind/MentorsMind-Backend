// @ts-nocheck
/**
 * Escrow Validation Schemas
 * Zod schemas for escrow-related endpoints.
 */

import { z } from 'zod';
import { idParamSchema, uuidSchema, longTextSchema } from './common.schemas';

const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, 'Amount must be a valid decimal with up to 7 decimal places')
  .refine((v) => parseFloat(v) > 0, 'Amount must be greater than 0');

const currencySchema = z
  .string()
  .trim()
  .min(1)
  .max(12, 'Currency code must not exceed 12 characters')
  .regex(/^[A-Z0-9]+$/, 'Currency code must be uppercase letters or digits')
  .default('XLM');

export const createEscrowSchema = z.object({
  body: z.object({
    mentorId: uuidSchema,
    amount: amountSchema,
    currency: currencySchema.optional(),
    description: longTextSchema.optional(),
  }).strict(),
});

export const releaseEscrowSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    stellarTxHash: z
      .string()
      .trim()
      .length(64, 'Transaction hash must be exactly 64 characters')
      .regex(/^[a-fA-F0-9]+$/, 'Transaction hash must be hexadecimal')
      .optional(),
  }).strict().optional(),
});

export const disputeEscrowSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    reason: z
      .string()
      .trim()
      .min(10, 'Dispute reason must be at least 10 characters')
      .max(2000, 'Dispute reason must not exceed 2000 characters'),
  }).strict(),
});

export const resolveDisputeSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    resolution: z.enum(['release_to_mentor', 'refund_to_learner'], {
      errorMap: () => ({ message: 'Resolution must be either "release_to_mentor" or "refund_to_learner"' }),
    }),
    notes: longTextSchema.optional(),
    stellarTxHash: z
      .string()
      .trim()
      .length(64, 'Transaction hash must be exactly 64 characters')
      .regex(/^[a-fA-F0-9]+$/, 'Transaction hash must be hexadecimal')
      .optional(),
  }).strict(),
});

export const refundEscrowSchema = z.object({
  params: idParamSchema.shape.params,
  body: z.object({
    stellarTxHash: z
      .string()
      .trim()
      .length(64, 'Transaction hash must be exactly 64 characters')
      .regex(/^[a-fA-F0-9]+$/, 'Transaction hash must be hexadecimal')
      .optional(),
  }).strict().optional(),
});

export const listEscrowsSchema = z.object({
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
      .enum(['pending', 'funded', 'released', 'disputed', 'resolved', 'refunded', 'cancelled'])
      .optional(),
    role: z.enum(['mentee', 'mentor']).optional(),
  }),
});

export const getEscrowByIdSchema = idParamSchema;

export type CreateEscrowInput = z.infer<typeof createEscrowSchema>['body'];
export type ReleaseEscrowInput = z.infer<typeof releaseEscrowSchema>['body'];
export type DisputeEscrowInput = z.infer<typeof disputeEscrowSchema>['body'];
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>['body'];
export type RefundEscrowInput = z.infer<typeof refundEscrowSchema>['body'];
export type ListEscrowsQuery = z.infer<typeof listEscrowsSchema>['query'];
