import { z } from 'zod';
import { emailSchema, passwordSchema } from './schemas/common.schemas';

export const registerSchema = z.object({
    body: z.object({
        email: emailSchema,
        password: passwordSchema,
        firstName: z.string().min(2, 'First name is required').max(50),
        lastName: z.string().min(2, 'Last name is required').max(50),
        role: z.enum(['mentee', 'mentor'])
            .default('mentee'),
    }).strict()
});

export const loginSchema = z.object({
    body: z.object({
        email: emailSchema,
        password: z.string().min(1, 'Password is required'), // Don't use strict password validation on login
    }).strict()
});

export const forgotPasswordSchema = z.object({
    body: z.object({
        email: emailSchema,
    }).strict()
});

export const resetPasswordSchema = z.object({
    body: z.object({
        token: z.string().min(1, 'Reset token is required'),
        newPassword: passwordSchema,
    }).strict()
});

export const refreshTokenSchema = z.object({
    body: z.object({
        refreshToken: z.string().min(1, 'Refresh token is required'),
    }).strict()
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>['body'];
