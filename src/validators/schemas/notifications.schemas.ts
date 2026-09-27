import { z } from 'zod';
import { uuidSchema } from './common.schemas';

export const listNotificationsSchema = z.object({
    query: z.object({
        page: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 1))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 1_000_000, 'Invalid page'),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 20))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 50, 'Limit must be between 1 and 50'),
    }),
});

export const notificationIdParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

export const updateNotificationPreferencesSchema = z.object({
    body: z
        .object({
            preferences: z.record(z.string(), z.unknown()),
        })
        .strict(),
});

export const pushUnsubscribeSchema = z.object({
    body: z
        .object({
            token: z.string().trim().min(1, 'token is required').max(4096),
        })
        .strict(),
});
