import { z } from 'zod';

export const completeStepSchema = z.object({
  params: z.object({
    stepId: z.string().min(1),
  }),
});

export const pauseOnboardingSchema = z.object({
  body: z.object({
    reason: z.string().max(500).optional(),
  }),
});

export const completeChecklistItemSchema = z.object({
  params: z.object({
    itemKey: z.string().min(1),
  }),
});

export const initializeOnboardingSchema = z.object({
  body: z.object({}).optional(),
});
