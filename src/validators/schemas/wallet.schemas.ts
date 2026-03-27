/**
 * Wallet Validation Schemas
 * Zod schemas for wallet management endpoints.
 */

import { z } from 'zod';
import { stellarAddressSchema } from './common.schemas';

// ---------------------------------------------------------------------------
// Amount validation schema
// ---------------------------------------------------------------------------

/** Stellar amount validation (up to 7 decimal places) */
export const stellarAmountSchema = z
  .string()
  .min(1, 'Amount is required')
  .regex(/^\d+(\.\d{1,7})?$/, 'Amount must be a valid decimal with up to 7 decimal places')
  .refine((v) => {
    const num = parseFloat(v);
    // Stellar int64 max scaled by 1e7 — avoid float literal precision issues
    return num > 0 && num <= 922337203685.4775;
  }, 'Amount must be positive and within Stellar limits');

/** Asset code validation (1-12 alphanumeric characters) */
export const assetCodeSchema = z
  .string()
  .trim()
  .min(1, 'Asset code is required')
  .max(12, 'Asset code must not exceed 12 characters')
  .regex(/^[A-Z0-9]+$/, 'Asset code must be uppercase letters or digits');

/** Optional asset code (defaults to XLM) */
export const optionalAssetCodeSchema = assetCodeSchema.optional().default('XLM');

/** Stellar memo validation (max 28 bytes) */
export const stellarMemoSchema = z
  .string()
  .trim()
  .max(28, 'Memo must not exceed 28 characters')
  .optional();

// ---------------------------------------------------------------------------
// Payout request schemas
// ---------------------------------------------------------------------------

export const payoutRequestSchema = z.object({
  body: z.object({
    amount: stellarAmountSchema,
    assetCode: optionalAssetCodeSchema,
    assetIssuer: stellarAddressSchema.optional(),
    destinationAddress: stellarAddressSchema,
    memo: stellarMemoSchema,
  }).strict(),
});

// ---------------------------------------------------------------------------
// Trustline request schemas
// ---------------------------------------------------------------------------

export const trustlineRequestSchema = z.object({
  body: z.object({
    assetCode: assetCodeSchema,
    assetIssuer: stellarAddressSchema,
    limit: stellarAmountSchema.optional(),
  }).strict(),
});

// ---------------------------------------------------------------------------
// Query parameter schemas
// ---------------------------------------------------------------------------

export const transactionQuerySchema = z.object({
  query: z.object({
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(100, 'Cursor too long')
      .optional(),
    limit: z
      .string()
      .optional()
      .transform((v) => (v ? parseInt(v, 10) : 10))
      .refine((v) => v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
    order: z.enum(['asc', 'desc']).optional().default('desc'),
  }),
});

export const earningsQuerySchema = z.object({
  query: z.object({
    startDate: z
      .string()
      .datetime({ message: 'Start date must be a valid ISO datetime' })
      .optional(),
    endDate: z
      .string()
      .datetime({ message: 'End date must be a valid ISO datetime' })
      .optional(),
    assetCode: optionalAssetCodeSchema,
    page: z
      .string()
      .optional()
      .transform((v) => (v ? parseInt(v, 10) : 1))
      .refine((v) => v >= 1, 'Page must be at least 1'),
    limit: z
      .string()
      .optional()
      .transform((v) => (v ? parseInt(v, 10) : 10))
      .refine((v) => v >= 1 && v <= 50, 'Limit must be between 1 and 50'),
  }).refine((data) => {
    // Ensure end date is after start date if both are provided
    if (data.startDate && data.endDate) {
      return new Date(data.endDate) > new Date(data.startDate);
    }
    return true;
  }, {
    message: 'End date must be after start date',
    path: ['endDate'],
  }),
});

export const balanceQuerySchema = z.object({
  query: z.object({
    assetCode: optionalAssetCodeSchema,
    assetIssuer: stellarAddressSchema.optional(),
  }),
});

// ---------------------------------------------------------------------------
// Wallet creation schema (for future use)
// ---------------------------------------------------------------------------

export const createWalletSchema = z.object({
  body: z.object({
    stellarPublicKey: stellarAddressSchema,
  }).strict(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type PayoutRequestInput = z.infer<typeof payoutRequestSchema>['body'];
export type TrustlineRequestInput = z.infer<typeof trustlineRequestSchema>['body'];
export type TransactionQuery = z.infer<typeof transactionQuerySchema>['query'];
export type EarningsQuery = z.infer<typeof earningsQuerySchema>['query'];
export type BalanceQuery = z.infer<typeof balanceQuerySchema>['query'];
export type CreateWalletInput = z.infer<typeof createWalletSchema>['body'];

// ---------------------------------------------------------------------------
// Schema validation helpers
// ---------------------------------------------------------------------------

/**
 * Validates if an asset is native XLM
 */
export const isNativeAsset = (assetCode?: string): boolean => {
  return !assetCode || assetCode === 'XLM';
};

/**
 * Validates asset issuer requirement
 */
export const validateAssetIssuer = (assetCode: string, assetIssuer?: string): boolean => {
  if (isNativeAsset(assetCode)) {
    return !assetIssuer; // Native XLM should not have issuer
  }
  return !!assetIssuer; // Non-native assets must have issuer
};

/**
 * Combined validation for asset code and issuer
 */
export const assetValidationSchema = z.object({
  assetCode: optionalAssetCodeSchema,
  assetIssuer: stellarAddressSchema.optional(),
}).refine((data) => validateAssetIssuer(data.assetCode, data.assetIssuer), {
  message: 'Non-native assets must have an issuer, native XLM must not have an issuer',
  path: ['assetIssuer'],
});