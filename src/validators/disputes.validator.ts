import { z } from 'zod';

export const openDisputeSchema = z.object({
  body: z.object({
    session_id: z.string().uuid(),
    type: z.enum(['payment', 'service_quality', 'no_show', 'cancellation', 'other']),
    reason: z.string().min(10).max(1000),
    evidence: z.array(z.string()).optional(),
  }),
});

export const uploadEvidenceSchema = z.object({
  body: z.object({
    text_content: z.string().max(5000).optional(),
    file_url: z.string().url().optional(),
  }),
});

export const resolveDisputeSchema = z.object({
  body: z.object({
    mentor_pct: z
      .number()
      .min(0, 'mentor_pct must be at least 0')
      .max(100, 'mentor_pct must not exceed 100'),
    notes: z.string().max(1000).optional(),
  }),
});

export const mediateDisputeSchema = z.object({
  body: z.object({
    notes: z.string().max(1000).optional(),
  }),
});
