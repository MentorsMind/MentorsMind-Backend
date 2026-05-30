import { z } from 'zod';

export const createExperimentSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    control_price: z.number().positive(),
    variant_prices: z.array(z.object({
      label: z.string().min(1).max(100),
      price: z.number().positive(),
    })).min(1).max(10),
    start_at: z.string().datetime().optional(),
    end_at: z.string().datetime().optional(),
  }),
});

export const updateExperimentStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    status: z.enum(['draft', 'running', 'paused', 'completed', 'cancelled']),
  }),
});

export const applyRecommendationSchema = z.object({
  body: z.object({
    price: z.number().positive(),
  }),
});

export const getMarketDemandSchema = z.object({
  query: z.object({
    skill: z.string().max(100).optional(),
    category: z.string().max(100).optional(),
    period: z.enum(['daily', 'weekly', 'monthly']).optional().default('monthly'),
    limit: z.string().optional().transform(v => v ? parseInt(v, 10) : 12),
  }),
});
