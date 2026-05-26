/**
 * Auth Validation Schemas
 * Zod schemas for all authentication endpoints.
 */

import { z } from 'zod';
import { emailSchema, passwordSchema } from './common.schemas';

export const registerSchema = z.object({
    body: z.object({
        email: emailSchema,
        password: passwordSchema,
        firstName: z
            .string()
            .min(1, 'First name is required')
            .trim()
            .min(2, 'First name must be at least 2 characters')
            .max(100, 'First name must not exceed 100 characters'),
        lastName: z
            .string()
            .min(1, 'Last name is required')
            .trim()
            .min(2, 'Last name must be at least 2 characters')
            .max(100, 'Last name must not exceed 100 characters'),
        role: z.enum(['mentee', 'mentor'])
            .default('mentee'),
    }).strict(),
});

export const loginSchema = z.object({
    body: z.object({
        email: emailSchema,
        password: z.string().min(1, 'Password is required'),
    }).strict(),
});

export const refreshTokenSchema = z.object({
    body: z.object({
        refreshToken: z
            .string()
            .min(1, 'Refresh token is required'),
    }).strict(),
});

export const forgotPasswordSchema = z.object({
    body: z.object({
        email: emailSchema,
    }).strict(),
});

export const resetPasswordSchema = z.object({
    body: z.object({
        token: z.string().min(1, 'Reset token is required'),
        password: passwordSchema,
    }).strict(),
});

export const changePasswordSchema = z.object({
    body: z.object({
        currentPassword: z
            .string()
            .min(1, 'Current password is required'),
        newPassword: passwordSchema,
    }).strict(),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>['body'];
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
