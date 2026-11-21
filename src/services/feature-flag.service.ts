import { pool } from '../config/database';
import { logger } from '../utils/logger.utils';
import { redis } from '../config/redis';
import { redisConfig } from '../config/redis.config';
import { featureFlagEvaluationsTotal } from '../config/metrics';
import crypto from 'crypto';
import Redis from 'ioredis';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FlagVariant {
  name: string;
  weight: number; // 0-100, weights must sum to 100
  config: Record<string, unknown>;
}

export interface FlagTargeting {
  userIds?: string[];
  userSegments?: string[];
  tenants?: string[];
  userTiers?: string[];
  roles?: string[];
}

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  rolloutPercentage: number;
  targeting: FlagTargeting;
  variants: FlagVariant[];
  dependsOnKey?: string | null;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFlagInput {
  key: string;
  name: string;
  description?: string;
  enabled?: boolean;
  rolloutPercentage?: number;
  targeting?: FlagTargeting;
  variants?: FlagVariant[];
  dependsOnKey?: string | null;
  createdBy?: string;
}

export interface UpdateFlagInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  rolloutPercentage?: number;
  targeting?: FlagTargeting;
  variants?: FlagVariant[];
  dependsOnKey?: string | null;
  updatedBy?: string;
}

export interface FlagMetrics {
  flagKey: string;
  exposures: number;
  conversions: number;
  conversionRate: number;
  variantBreakdown: Record<string, { exposures: number; conversions: number }>;
}

export interface EvaluationContext {
  segment?: string;
  tenantId?: string;
  userTier?: string;
  role?: string;
}

// ─── Real-time invalidation (Redis pub/sub) ───────────────────────────────────

const FLAG_UPDATED_CHANNEL = 'feature_flag:updated';

/** In-memory per-process cache, invalidated via Redis pub/sub across instances. */
const flagCache = new Map<string, { flag: FeatureFlag; cachedAt: number }>();
const FLAG_CACHE_TTL_MS = 60_000; // local safety-net TTL; pub/sub invalidates sooner

let subClient: Redis | null = null;

/**
 * Subscribe this instance to flag-update events so its in-memory cache is
 * invalidated within ~2s of any instance writing a change to Postgres.
 * Call once at server startup.
 */
export async function subscribeToFeatureFlagUpdates(): Promise<void> {
  if (subClient) return;

  const url = redisConfig.url!;
  const isTls = url.startsWith('rediss://');
  subClient = new Redis(url, { lazyConnect: true, ...(isTls ? { tls: { rejectUnauthorized: false } } : {}) });
  await subClient.connect();
  await subClient.subscribe(FLAG_UPDATED_CHANNEL);

  subClient.on('message', (_channel, message) => {
    try {
      const { key } = JSON.parse(message) as { key: string };
      flagCache.delete(key);
      logger.info({ key }, 'FeatureFlagService: invalidated local cache from pub/sub event');
    } catch (err) {
      logger.error({ err, message }, 'FeatureFlagService: failed to parse flag update event');
    }
  });

  logger.info('FeatureFlagService: subscribed to feature_flag:updated channel');
}

async function publishFlagUpdated(key: string): Promise<void> {
  flagCache.delete(key);
  try {
    await redis.publish(FLAG_UPDATED_CHANNEL, JSON.stringify({ key, at: Date.now() }));
  } catch (err) {
    logger.error({ err, key }, 'FeatureFlagService: failed to publish flag update event');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deterministic hash of (userId + flagName) → 0-99.
 * Same user always gets the same bucket for a given flag (consistent hashing).
 */
function getBucket(flagKey: string, userId: string): number {
  const hash = crypto.createHash('sha256').update(`${userId}${flagKey}`).digest('hex');
  return parseInt(hash.slice(0, 8), 16) % 100;
}

function mapRow(row: Record<string, unknown>): FeatureFlag {
  return {
    id: row.id as string,
    key: row.key as string,
    name: row.name as string,
    description: row.description as string | undefined,
    enabled: row.enabled as boolean,
    rolloutPercentage: parseFloat(row.rollout_percentage as string),
    targeting: (row.targeting as FlagTargeting) ?? {},
    variants: (row.variants as FlagVariant[]) ?? [],
    dependsOnKey: (row.depends_on_key as string | null) ?? null,
    createdBy: row.created_by as string | undefined,
    updatedBy: row.updated_by as string | undefined,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class FeatureFlagService {
  // ── CRUD ────────────────────────────────────────────────────────────────────

  static async create(input: CreateFlagInput): Promise<FeatureFlag> {
    this.assertValidVariantWeights(input.variants);

    if (input.dependsOnKey) {
      await this.assertNoDependencyCycle(input.key, input.dependsOnKey);
    }

    const { rows } = await pool.query(
      `INSERT INTO feature_flags
         (key, name, description, enabled, rollout_percentage, targeting, variants, depends_on_key, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING *`,
      [
        input.key,
        input.name,
        input.description ?? null,
        input.enabled ?? false,
        input.rolloutPercentage ?? 0,
        JSON.stringify(input.targeting ?? {}),
        JSON.stringify(input.variants ?? []),
        input.dependsOnKey ?? null,
        input.createdBy ?? null,
      ],
    );
    return mapRow(rows[0]);
  }

  static async findAll(): Promise<FeatureFlag[]> {
    const { rows } = await pool.query('SELECT * FROM feature_flags ORDER BY created_at DESC');
    return rows.map(mapRow);
  }

  static async findByKey(key: string, useCache = true): Promise<FeatureFlag | null> {
    if (useCache) {
      const cached = flagCache.get(key);
      if (cached && Date.now() - cached.cachedAt < FLAG_CACHE_TTL_MS) {
        return cached.flag;
      }
    }

    const { rows } = await pool.query('SELECT * FROM feature_flags WHERE key = $1', [key]);
    if (!rows.length) return null;

    const flag = mapRow(rows[0]);
    flagCache.set(key, { flag, cachedAt: Date.now() });
    return flag;
  }

  static async findById(id: string): Promise<FeatureFlag | null> {
    const { rows } = await pool.query('SELECT * FROM feature_flags WHERE id = $1', [id]);
    return rows.length ? mapRow(rows[0]) : null;
  }

  static async update(id: string, input: UpdateFlagInput): Promise<FeatureFlag | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    this.assertValidVariantWeights(input.variants);

    if (input.dependsOnKey) {
      await this.assertNoDependencyCycle(existing.key, input.dependsOnKey);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.name !== undefined)               { sets.push(`name = $${idx++}`);               values.push(input.name); }
    if (input.description !== undefined)        { sets.push(`description = $${idx++}`);        values.push(input.description); }
    if (input.enabled !== undefined)            { sets.push(`enabled = $${idx++}`);            values.push(input.enabled); }
    if (input.rolloutPercentage !== undefined)  { sets.push(`rollout_percentage = $${idx++}`); values.push(input.rolloutPercentage); }
    if (input.targeting !== undefined)          { sets.push(`targeting = $${idx++}`);          values.push(JSON.stringify(input.targeting)); }
    if (input.variants !== undefined)           { sets.push(`variants = $${idx++}`);           values.push(JSON.stringify(input.variants)); }
    if (input.dependsOnKey !== undefined)       { sets.push(`depends_on_key = $${idx++}`);      values.push(input.dependsOnKey); }
    if (input.updatedBy !== undefined)          { sets.push(`updated_by = $${idx++}`);         values.push(input.updatedBy); }

    if (!sets.length) return existing;

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE feature_flags SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    if (!rows.length) return null;

    const updated = mapRow(rows[0]);
    await publishFlagUpdated(updated.key);
    return updated;
  }

  static async delete(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    const { rowCount } = await pool.query('DELETE FROM feature_flags WHERE id = $1', [id]);
    if (existing) await publishFlagUpdated(existing.key);
    return (rowCount ?? 0) > 0;
  }

  /**
   * Enforces that variant weights (0-100 each) sum to 100 so rollout
   * percentages are not silently skewed. No-op when no variants are provided.
   */
  private static assertValidVariantWeights(variants?: FlagVariant[]): void {
    if (!variants || variants.length === 0) return;

    for (const variant of variants) {
      if (variant.weight < 0 || variant.weight > 100) {
        throw new Error(
          `Feature flag variant "${variant.name}" weight must be between 0 and 100 (got ${variant.weight})`,
        );
      }
    }

    const sum = variants.reduce((acc, variant) => acc + variant.weight, 0);
    // Tolerance guards against floating-point drift for fractional weights.
    if (Math.abs(sum - 100) > 0.001) {
      throw new Error(`Feature flag variant weights must sum to 100 (got ${sum})`);
    }
  }

  /**
   * Walks the dependsOnKey chain to detect cycles before a write.
   * candidateKey is the flag being created/updated; dependsOnKey is what it would point to.
   */
  private static async assertNoDependencyCycle(candidateKey: string, dependsOnKey: string): Promise<void> {
    if (candidateKey === dependsOnKey) {
      throw new Error(`Feature flag "${candidateKey}" cannot depend on itself`);
    }

    const visited = new Set<string>([candidateKey]);
    let current: string | null = dependsOnKey;

    while (current) {
      if (visited.has(current)) {
        throw new Error(
          `Feature flag dependency cycle detected: "${candidateKey}" -> "${dependsOnKey}" loops back to "${current}"`,
        );
      }
      visited.add(current);

      const flag = await this.findByKey(current, false);
      current = flag?.dependsOnKey ?? null;
    }
  }

  // ── Evaluation ──────────────────────────────────────────────────────────────

  /**
   * Returns true if the flag is enabled for the given user.
   * Evaluation order:
   *   1. Dependency flag (if set) must itself evaluate true
   *   2. Flag disabled globally → false
   *   3. User in targeting.userIds → true
   *   4. Segment / tenant / userTier / role targeting
   *   5. Percentage rollout bucket check (consistent hashing)
   */
  static async isEnabled(flagKey: string, userId: string, context?: EvaluationContext): Promise<boolean> {
    try {
      const result = await this.evaluate(flagKey, userId, context);
      featureFlagEvaluationsTotal.inc({ flag: flagKey, result: String(result) });
      return result;
    } catch (err) {
      logger.error({ err, flagKey, userId }, 'FeatureFlagService.isEnabled error');
      featureFlagEvaluationsTotal.inc({ flag: flagKey, result: 'error' });
      return false; // fail-safe: off
    }
  }

  private static async evaluate(flagKey: string, userId: string, context?: EvaluationContext): Promise<boolean> {
    const flag = await this.findByKey(flagKey);
    if (!flag || !flag.enabled) return false;

    if (flag.dependsOnKey) {
      const dependencyEnabled = await this.evaluate(flag.dependsOnKey, userId, context);
      if (!dependencyEnabled) return false;
    }

    // Explicit user targeting
    if (flag.targeting.userIds?.includes(userId)) return true;

    // Segment / tenant / tier / role targeting
    if (context?.segment && flag.targeting.userSegments?.includes(context.segment)) return true;
    if (context?.tenantId && flag.targeting.tenants?.includes(context.tenantId)) return true;
    if (context?.userTier && flag.targeting.userTiers?.includes(context.userTier)) return true;
    if (context?.role && flag.targeting.roles?.includes(context.role)) return true;

    // If any targeting dimension is configured but none matched and the dimension
    // was provided, tier/role-restricted flags should not fall through to rollout
    // for users outside the target set.
    const hasTierOrRoleRestriction =
      (flag.targeting.userTiers?.length ?? 0) > 0 || (flag.targeting.roles?.length ?? 0) > 0;
    if (hasTierOrRoleRestriction) {
      const tierMatches = !flag.targeting.userTiers?.length || (context?.userTier && flag.targeting.userTiers.includes(context.userTier));
      const roleMatches = !flag.targeting.roles?.length || (context?.role && flag.targeting.roles.includes(context.role));
      if (!tierMatches || !roleMatches) return false;
    }

    // Percentage rollout — consistent per-user assignment
    if (flag.rolloutPercentage >= 100) return true;
    if (flag.rolloutPercentage <= 0) return false;
    return getBucket(flagKey, userId) < flag.rolloutPercentage;
  }

  /**
   * Returns the variant assigned to the user for an A/B test flag.
   * Returns null if the flag is disabled or has no variants.
   */
  static async getVariant(flagKey: string, userId: string, context?: EvaluationContext): Promise<FlagVariant | null> {
    try {
      const enabled = await this.isEnabled(flagKey, userId, context);
      if (!enabled) return null;

      const flag = await this.findByKey(flagKey);
      if (!flag || !flag.variants.length) return null;

      // Weighted variant selection using deterministic bucket
      const bucket = getBucket(`${flagKey}:variant`, userId); // separate bucket for variant assignment
      let cumulative = 0;
      for (const variant of flag.variants) {
        cumulative += variant.weight;
        if (bucket < cumulative) return variant;
      }
      return flag.variants[flag.variants.length - 1];
    } catch (err) {
      logger.error({ err, flagKey, userId }, 'FeatureFlagService.getVariant error');
      return null;
    }
  }

  /**
   * Evaluate all flags for a user — used by GET /me/feature-flags.
   * Returns only flags that resolve to enabled=true for this user.
   */
  static async getActiveFlagsForUser(userId: string, context?: EvaluationContext): Promise<Record<string, boolean>> {
    const flags = await this.findAll();
    const result: Record<string, boolean> = {};

    for (const flag of flags) {
      const enabled = await this.isEnabled(flag.key, userId, context);
      if (enabled) result[flag.key] = true;
    }

    return result;
  }

  // ── Metrics ─────────────────────────────────────────────────────────────────

  static async trackEvent(
    flagKey: string,
    userId: string | null,
    eventType: 'exposure' | 'conversion' | 'custom',
    variant?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO experiment_events (flag_key, user_id, variant, event_type, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [flagKey, userId, variant ?? null, eventType, JSON.stringify(metadata ?? {})],
      );
    } catch (err) {
      logger.error({ err, flagKey, userId }, 'FeatureFlagService.trackEvent error');
    }
  }

  static async getMetrics(flagKey: string, since?: Date): Promise<FlagMetrics> {
    const sinceClause = since ? `AND created_at >= $2` : '';
    const params: unknown[] = [flagKey];
    if (since) params.push(since);

    const { rows } = await pool.query(
      `SELECT variant, event_type, COUNT(*) AS count
       FROM experiment_events
       WHERE flag_key = $1 ${sinceClause}
       GROUP BY variant, event_type`,
      params,
    );

    const variantBreakdown: Record<string, { exposures: number; conversions: number }> = {};
    let totalExposures = 0;
    let totalConversions = 0;

    for (const row of rows) {
      const v = (row.variant as string) ?? '__default__';
      if (!variantBreakdown[v]) variantBreakdown[v] = { exposures: 0, conversions: 0 };
      const count = parseInt(row.count as string, 10);
      if (row.event_type === 'exposure') {
        variantBreakdown[v].exposures += count;
        totalExposures += count;
      } else if (row.event_type === 'conversion') {
        variantBreakdown[v].conversions += count;
        totalConversions += count;
      }
    }

    return {
      flagKey,
      exposures: totalExposures,
      conversions: totalConversions,
      conversionRate: totalExposures > 0 ? totalConversions / totalExposures : 0,
      variantBreakdown,
    };
  }
}
