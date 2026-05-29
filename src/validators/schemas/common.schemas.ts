/**
 * Common / shared Zod schemas used across multiple validators.
 */

import { z } from 'zod';
import { validationConfig } from '../../config/validation.config';

const { string: strCfg, pagination: pagCfg, stellar: stlCfg } = validationConfig;

// ---------------------------------------------------------------------------
// Primitive building blocks
// ---------------------------------------------------------------------------

export const emailSchema = z
    .string()
    .min(1, 'Email is required')
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(254, 'Email address is too long');

export const passwordSchema = z
    .string()
    .min(1, 'Password is required')
    .min(
        validationConfig.password.minLength,
        `Password must be at least ${validationConfig.password.minLength} characters`,
    )
    .max(
        validationConfig.password.maxLength,
        `Password must not exceed ${validationConfig.password.maxLength} characters`,
    )
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number');

/** UUID v4 param – used in path parameters */
export const uuidSchema = z
    .string()
    .min(1, 'ID is required')
    .uuid('ID must be a valid UUID v4');

// ---------------------------------------------------------------------------
// Stellar-specific schemas
// ---------------------------------------------------------------------------

/**
 * Validates a Stellar/StrKey G-address (public key).
 * Checks length and prefix; full checksum validation happens at the service layer
 * via the Stellar SDK.
 */
export const stellarAddressSchema = z
    .string()
    .min(1, 'Stellar address is required')
    .trim()
    .transform((v) => v.toUpperCase())
    .refine(
        (v) => v.startsWith(stlCfg.publicKeyPrefix),
        { message: `Stellar address must start with "${stlCfg.publicKeyPrefix}"` },
    )
    .refine(
        (v) => v.length === stlCfg.publicKeyLength,
        { message: `Stellar address must be exactly ${stlCfg.publicKeyLength} characters` },
    )
    .refine(
        (v) => /^[A-Z2-7]+$/.test(v),
        { message: 'Stellar address must contain only base32 characters (A-Z, 2-7)' },
    );

/** Stellar transaction hash (64 hex characters) */
export const stellarTxHashSchema = z
    .string()
    .min(1, 'Transaction hash is required')
    .trim()
    .length(stlCfg.txHashLength, `Transaction hash must be exactly ${stlCfg.txHashLength} characters`)
    .regex(/^[a-fA-F0-9]+$/, 'Transaction hash must be hexadecimal');

// ---------------------------------------------------------------------------
// Shared structural schemas
// ---------------------------------------------------------------------------

/** Route parameter carrying a UUID :id */
export const idParamSchema = z.object({
    params: z.object({
        id: uuidSchema,
    }),
});

/** Standard pagination query parameters */
export const paginationSchema = z.object({
    query: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : pagCfg.defaultPage))
            .refine((v) => v >= 1, 'Page must be at least 1'),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : pagCfg.defaultLimit))
            .refine(
                (v) => v >= pagCfg.minLimit && v <= pagCfg.maxLimit,
                `Limit must be between ${pagCfg.minLimit} and ${pagCfg.maxLimit}`,
            ),
        sortBy: z.string().max(strCfg.maxShort).optional(),
        sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    }),
});

/** Standard cursor-based pagination query parameters */
export const cursorPaginationSchema = z.object({
    query: z.object({
        cursor: z.string().trim().optional(),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : pagCfg.defaultLimit))
            .refine(
                (v) => v >= 1 && v <= 100,
                'Limit must be between 1 and 100',
            ),
    }),
});

/** Reusable name field (first / last name, display name, etc.) */
export const nameSchema = z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(strCfg.maxShort, `Name must not exceed ${strCfg.maxShort} characters`)
    .regex(/^[\p{L}\p{M}' -]+$/u, 'Name contains invalid characters');

/** Reusable short text (title, subject, code) */
export const shortTextSchema = z
    .string()
    .trim()
    .min(strCfg.minShort)
    .max(strCfg.maxMedium, `Text must not exceed ${strCfg.maxMedium} characters`);

/** Reusable long text (bio, description) */
export const longTextSchema = z
    .string()
    .trim()
    .max(strCfg.maxLong, `Text must not exceed ${strCfg.maxLong} characters`);

/** A safe URL (http/https only) */
export const urlSchema = z
    .string()
    .trim()
    .url('Must be a valid URL')
    .max(validationConfig.maxUrlLength, 'URL is too long')
    .refine(
        (v) => /^https?:\/\//i.test(v),
        { message: 'URL must use http or https protocol' },
    );

/** Base64-encoded image (data URI) */
export const base64ImageSchema = z
    .string()
    .trim()
    .max(
        validationConfig.fileUpload.maxBase64AvatarLength,
        'Image data is too large (max 5 MB)',
    )
    .regex(
        /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/,
        'Must be a valid base64-encoded image (JPEG, PNG, WebP, or GIF)',
    );
