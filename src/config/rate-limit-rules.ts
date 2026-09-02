import os from "os";
import { EndpointCategory, UserTier } from "../services/rate-limiter.service";

export type BusinessTier = UserTier | "premium";
export type LoadBand = "normal" | "elevated" | "critical";

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

export interface SystemLoadSnapshot {
  load1: number;
  cpuCount: number;
  memoryUtilization: number;
}

export interface RateLimitRuleContext {
  tier: BusinessTier;
  category: EndpointCategory;
  behaviorBlockRate: number;
  behaviorSampleSize: number;
  load: SystemLoadSnapshot;
}

const minute = 60 * 1000;

const CATEGORY_RULES: Record<EndpointCategory, RateLimitRule> = {
  auth: { max: 10, windowMs: 15 * minute },
  payment: { max: 20, windowMs: minute },
  "file-upload": { max: 5, windowMs: minute },
  general: { max: 60, windowMs: minute },
  other: { max: 60, windowMs: minute },
};

const TIER_MULTIPLIERS: Record<BusinessTier, number> = {
  free: 1,
  unknown: 1,
  pro: 2,
  premium: 3,
  enterprise: Number.POSITIVE_INFINITY,
};

export const rateLimitRules = {
  behavior: {
    minimumSamples: 10,
    abusiveBlockRate: 0.5,
    elevatedBlockRate: 0.25,
    trustedBlockRate: 0.05,
    abusiveMultiplier: 0.5,
    elevatedMultiplier: 0.75,
    trustedMultiplier: 1.1,
  },
  load: {
    elevatedThreshold: 0.7,
    criticalThreshold: 1,
    elevatedMultiplier: 0.8,
    criticalMultiplier: 0.6,
  },
  tiers: TIER_MULTIPLIERS,
  categories: CATEGORY_RULES,
};

export function resolveBusinessTier(user: unknown): BusinessTier {
  const candidate = (user as Record<string, unknown> | null | undefined)?.userTier ??
    (user as Record<string, unknown> | null | undefined)?.user_tier ??
    (user as Record<string, unknown> | null | undefined)?.tier ??
    "free";
  const tier = String(candidate).toLowerCase();
  return ["free", "pro", "premium", "enterprise"].includes(tier)
    ? (tier as BusinessTier)
    : "free";
}

export function getSystemLoad(): SystemLoadSnapshot {
  const [load1 = 0] = os.loadavg();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  return {
    load1: load1 / Math.max(1, os.cpus().length),
    cpuCount: os.cpus().length,
    memoryUtilization: totalMemory > 0 ? 1 - freeMemory / totalMemory : 0,
  };
}

export function getLoadBand(load: SystemLoadSnapshot): LoadBand {
  const normalizedLoad = Math.max(load.load1, load.memoryUtilization);
  if (normalizedLoad >= rateLimitRules.load.criticalThreshold) return "critical";
  if (normalizedLoad >= rateLimitRules.load.elevatedThreshold) return "elevated";
  return "normal";
}

export function calculateRateLimit(context: RateLimitRuleContext): RateLimitRule {
  const base = rateLimitRules.categories[context.category];
  if (context.tier === "enterprise") return { ...base, max: Number.POSITIVE_INFINITY };

  const loadMultiplier =
    getLoadBand(context.load) === "critical"
      ? rateLimitRules.load.criticalMultiplier
      : getLoadBand(context.load) === "elevated"
        ? rateLimitRules.load.elevatedMultiplier
        : 1;
  const behaviorMultiplier =
    context.behaviorSampleSize < rateLimitRules.behavior.minimumSamples
      ? 1
      : context.behaviorBlockRate >= rateLimitRules.behavior.abusiveBlockRate
        ? rateLimitRules.behavior.abusiveMultiplier
        : context.behaviorBlockRate >= rateLimitRules.behavior.elevatedBlockRate
          ? rateLimitRules.behavior.elevatedMultiplier
          : context.behaviorBlockRate <= rateLimitRules.behavior.trustedBlockRate
            ? rateLimitRules.behavior.trustedMultiplier
            : 1;

  return {
    windowMs: base.windowMs,
    max: Math.max(
      1,
      Math.floor(base.max * TIER_MULTIPLIERS[context.tier] * loadMultiplier * behaviorMultiplier),
    ),
  };
}