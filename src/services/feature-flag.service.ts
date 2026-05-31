import { pool } from '../config/database';
import { logger } from '../utils/logger.utils';
import crypto from 'crypto';

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
  createdBy?: string;
}

export interface UpdateFlagInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  rolloutPercentage?: number;
  targeting?: FlagTargeting;
  variants?: FlagVariant[];
  updatedBy?: string;
}

export interface FlagMetrics {
  flagKey: string;
  exposures: number;
  conversions: number;
  conversionRate: number;
  variantBreakdown: Record<string, { exposures: number; conversions: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deterministic hash of (flagKey + userId) → 0-99.
 * Same user always gets the same bucket for a given flag.
 */
function getBucket(flagKey: string, userId: string): number {
  const hash = crypto.createHash('sha256').update(`${flagKey}:${userId}`).digest('hex');
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
    const { rows } = await pool.query(
      `INSERT INTO feature_flags
         (key, name, description, enabled, rollout_percentage, targeting, variants, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING *`,
      [
        input.key,
        input.name,
        input.description ?? null,
        input.enabled ?? false,
        input.rolloutPercentage ?? 0,
        JSON.stringify(input.targeting ?? {}),
        JSON.stringify(input.variants ?? []),
        input.createdBy ?? null,
      ],
    );
    return mapRow(rows[0]);
  }

  static async findAll(): Promise<FeatureFlag[]> {
    const { rows } = await pool.query('SELECT * FROM feature_flags ORDER BY created_at DESC');
    return rows.map(mapRow);
  }

  static async findByKey(key: string): Promise<FeatureFlag | null> {
    const { rows } = await pool.query('SELECT * FROM feature_flags WHERE key = $1', [key]);
    return rows.length ? mapRow(rows[0]) : null;
  }

  static async findById(id: string): Promise<FeatureFlag | null> {
    const { rows } = await pool.query('SELECT * FROM feature_flags WHERE id = $1', [id]);
    return rows.length ? mapRow(rows[0]) : null;
  }

  static async update(id: string, input: UpdateFlagInput): Promise<FeatureFlag | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.name !== undefined)               { sets.push(`name = $${idx++}`);               values.push(input.name); }
    if (input.description !== undefined)        { sets.push(`description = $${idx++}`);        values.push(input.description); }
    if (input.enabled !== undefined)            { sets.push(`enabled = $${idx++}`);            values.push(input.enabled); }
    if (input.rolloutPercentage !== undefined)  { sets.push(`rollout_percentage = $${idx++}`); values.push(input.rolloutPercentage); }
    if (input.targeting !== undefined)          { sets.push(`targeting = $${idx++}`);          values.push(JSON.stringify(input.targeting)); }
    if (input.variants !== undefined)           { sets.push(`variants = $${idx++}`);           values.push(JSON.stringify(input.variants)); }
    if (input.updatedBy !== undefined)          { sets.push(`updated_by = $${idx++}`);         values.push(input.updatedBy); }

    if (!sets.length) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE feature_flags SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  static async delete(id: string): Promise<boolean> {
    const { rowCount } = await pool.query('DELETE FROM feature_flags WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  // ── Evaluation ──────────────────────────────────────────────────────────────

  /**
   * Returns true if the flag is enabled for the given user.
   * Evaluation order:
   *   1. Flag disabled globally → false
   *   2. User in targeting.userIds → true
   *   3. Percentage rollout bucket check
   */
  static async isEnabled(flagKey: string, userId: string, context?: { segment?: string; tenantId?: string }): Promise<boolean> {
    try {
      const flag = await this.findByKey(flagKey);
      if (!flag || !flag.enabled) return false;

      // Explicit user targeting
      if (flag.targeting.userIds?.includes(userId)) return true;

      // Segment targeting
      if (context?.segment && flag.targeting.userSegments?.includes(context.segment)) return true;

      // Tenant targeting
      if (context?.tenantId && flag.targeting.tenants?.includes(context.tenantId)) return true;

      // Percentage rollout
      if (flag.rolloutPercentage >= 100) return true;
      if (flag.rolloutPercentage <= 0) return false;
      return getBucket(flagKey, userId) < flag.rolloutPercentage;
    } catch (err) {
      logger.error({ err, flagKey, userId }, 'FeatureFlagService.isEnabled error');
      return false; // fail-safe: off
    }
  }

  /**
   * Returns the variant assigned to the user for an A/B test flag.
   * Returns null if the flag is disabled or has no variants.
   */
  static async getVariant(flagKey: string, userId: string, context?: { segment?: string; tenantId?: string }): Promise<FlagVariant | null> {
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
