/**
 * Sunset Exemption Service
 *
 * Manages the per-version allowlist of users that may continue calling an
 * API version after its `sunsetAt` date has passed (gradual sunset).
 *
 * Sources of exemptions, checked in order:
 *   1. Static config / env allowlist (`SUNSET_EXEMPT_USER_IDS` in
 *      api-versions.config.ts, seeded from `API_SUNSET_EXEMPTIONS_V*`).
 *   2. The `api_sunset_exemptions` table managed via the admin endpoints.
 *
 * Results are cached briefly to keep the hot versioning middleware path cheap.
 */

import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { isStaticallySunsetExempt } from "../config/api-versions.config";

export interface SunsetExemption {
  id: string;
  userId: string;
  apiVersion: string;
  reason: string | null;
  grantedBy: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

interface CacheEntry {
  exempt: boolean;
  cachedAt: number;
}

const CACHE_TTL_MS = 60_000;
const exemptionCache = new Map<string, CacheEntry>();

function cacheKey(userId: string, apiVersion: string): string {
  return `${apiVersion}:${userId}`;
}

export const SunsetExemptionService = {
  /**
   * Check whether a user is exempt from sunset enforcement for a version.
   * Consults the static config first, then the database (with caching).
   */
  async isExempt(userId: string | null | undefined, apiVersion: string): Promise<boolean> {
    if (!userId) return false;

    if (isStaticallySunsetExempt(apiVersion, userId)) return true;

    const key = cacheKey(userId, apiVersion);
    const cached = exemptionCache.get(key);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.exempt;
    }

    const { rows } = await pool.query(
      `SELECT 1 FROM api_sunset_exemptions
       WHERE user_id = $1 AND api_version = $2
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [userId, apiVersion],
    );
    const exempt = rows.length > 0;

    exemptionCache.set(key, { exempt, cachedAt: Date.now() });
    return exempt;
  },

  /** Grant a sunset exemption. Idempotent per (user, version). */
  async grant(params: {
    userId: string;
    apiVersion: string;
    reason?: string | null;
    grantedBy?: string | null;
    expiresAt?: Date | null;
  }): Promise<SunsetExemption> {
    const { rows } = await pool.query(
      `INSERT INTO api_sunset_exemptions
         (user_id, api_version, reason, granted_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, api_version)
       DO UPDATE SET
         reason = EXCLUDED.reason,
         granted_by = EXCLUDED.granted_by,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()
       RETURNING id, user_id AS "userId", api_version AS "apiVersion",
                 reason, granted_by AS "grantedBy",
                 expires_at AS "expiresAt", created_at AS "createdAt"`,
      [
        params.userId,
        params.apiVersion,
        params.reason ?? null,
        params.grantedBy ?? null,
        params.expiresAt ?? null,
      ],
    );

    exemptionCache.delete(cacheKey(params.userId, params.apiVersion));
    logger.info("Sunset exemption granted", {
      userId: params.userId,
      apiVersion: params.apiVersion,
      grantedBy: params.grantedBy ?? undefined,
    });
    return rows[0];
  },

  /** Revoke a sunset exemption by user + version. Returns true when a row was removed. */
  async revoke(userId: string, apiVersion: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM api_sunset_exemptions
       WHERE user_id = $1 AND api_version = $2`,
      [userId, apiVersion],
    );
    exemptionCache.delete(cacheKey(userId, apiVersion));
    logger.info("Sunset exemption revoked", { userId, apiVersion });
    return (rowCount ?? 0) > 0;
  },

  /** List exemptions, optionally filtered by version. */
  async list(apiVersion?: string): Promise<SunsetExemption[]> {
    const { rows } = apiVersion
      ? await pool.query(
          `SELECT id, user_id AS "userId", api_version AS "apiVersion",
                  reason, granted_by AS "grantedBy",
                  expires_at AS "expiresAt", created_at AS "createdAt"
           FROM api_sunset_exemptions
           WHERE api_version = $1
           ORDER BY created_at DESC`,
          [apiVersion],
        )
      : await pool.query(
          `SELECT id, user_id AS "userId", api_version AS "apiVersion",
                  reason, granted_by AS "grantedBy",
                  expires_at AS "expiresAt", created_at AS "createdAt"
           FROM api_sunset_exemptions
           ORDER BY created_at DESC`,
        );
    return rows;
  },
};
