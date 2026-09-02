import { z } from 'zod';
import { uuidSchema } from './common.schemas';

export const leaderboardQuerySchema = z.object({
  query: z.object({
    type: z.enum(['mentor', 'mentee', 'skill']).optional().default('mentor'),
    period: z.enum(['daily', 'weekly', 'monthly', 'all-time']).optional().default('all-time'),
    limit: z.coerce.number().min(1).max(100).optional().default(20),
    offset: z.coerce.number().min(0).optional().default(0),
    skill: z.string().optional(),
  }).optional(),
});

export const showcaseUpdateSchema = z.object({
  body: z.object({
    badgeIds: z.array(z.string()).min(1).max(5),
  }),
});

export const achievementIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const challengeIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const userIdParamSchema = z.object({
  params: z.object({
    userId: uuidSchema,
  }),
});

export const createAchievementSchema = z.object({
  body: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    icon: z.string().min(1),
    category: z.enum(['sessions', 'learning', 'social', 'special']),
    rarity: z.enum(['common', 'rare', 'epic', 'legendary']),
    criteria: z.object({
      type: z.enum(['session_count', 'streak_days', 'review_rating', 'learning_milestones', 'challenge_count', 'custom']),
      target: z.number().min(1),
      metric: z.string().optional(),
    }),
    reward: z.object({
      type: z.enum(['xp', 'xlm', 'discount', 'badge']),
      value: z.number().min(0),
      currency: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    }),
  }),
});
