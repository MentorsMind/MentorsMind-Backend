/**
 * User Validation Schemas
 * Zod schemas for all user-related endpoints.
 */

import { z } from 'zod';
import { idParamSchema, nameSchema, longTextSchema, base64ImageSchema, urlSchema } from './common.schemas';

export const updateUserSchema = z.object({
    params: idParamSchema.shape.params,
    body: z.object({
        firstName: nameSchema.optional(),
        lastName: nameSchema.optional(),
        bio: longTextSchema.optional(),
        avatarUrl: urlSchema.optional(),
        phoneNumber: z.string().trim().max(50).nullable().optional(),
        dateOfBirth: z.string().trim().max(20).nullable().optional(),
        governmentIdNumber: z.string().trim().max(100).nullable().optional(),
        bankAccountDetails: z.string().trim().max(255).nullable().optional(),
    }).strict(),
});

export const updateMeSchema = z.object({
    body: z.object({
        firstName: nameSchema.optional(),
        lastName: nameSchema.optional(),
        bio: longTextSchema.optional(),
        avatarUrl: urlSchema.optional(),
        phoneNumber: z.string().trim().max(50).nullable().optional(),
        dateOfBirth: z.string().trim().max(20).nullable().optional(),
        governmentIdNumber: z.string().trim().max(100).nullable().optional(),
        bankAccountDetails: z.string().trim().max(255).nullable().optional(),
    }).strict(),
});

export const avatarUploadSchema = z.object({
    body: z.object({
        avatarBase64: base64ImageSchema,
    }).strict(),
});

export const getUserByIdSchema = idParamSchema;

export const listUsersSchema = z.object({
    query: z.object({
        page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 1)),
        limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 10)),
        role: z.enum(['mentor', 'mentee'])
            .optional(),
        search: z.string().trim().max(200, 'Search term is too long').optional(),
        sortBy: z.enum(['createdAt', 'firstName', 'lastName']).optional(),
        sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    }),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>['body'];
export type UpdateMeInput = z.infer<typeof updateMeSchema>['body'];
export type AvatarUploadInput = z.infer<typeof avatarUploadSchema>['body'];
export type ListUsersQuery = z.infer<typeof listUsersSchema>['query'];
