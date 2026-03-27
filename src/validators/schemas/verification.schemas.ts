import { z } from 'zod';

export const submitVerificationSchema = z.object({
    body: z.object({
        documentType: z.enum(['passport', 'national_id', 'drivers_license', 'professional_certificate']),
        documentUrl: z.string().url('Document URL must be a valid URL'),
        credentialUrl: z.string().url('Credential URL must be a valid URL').optional(),
        linkedinUrl: z.string().url('LinkedIn URL must be a valid URL').optional(),
        additionalNotes: z.string().max(1000).optional(),
    }).strict(),
});

export const rejectVerificationSchema = z.object({
    body: z.object({
        reason: z.string().min(10, 'Rejection reason must be at least 10 characters').max(1000),
    }).strict(),
});

export const requestMoreInfoSchema = z.object({
    body: z.object({
        message: z.string().min(10, 'Message must be at least 10 characters').max(1000),
    }).strict(),
});

export const listVerificationsSchema = z.object({
    query: z.object({
        status: z.enum(['pending', 'approved', 'rejected', 'more_info_requested', 'expired']).optional(),
        page: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 1)),
        limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 20)),
    }),
});
