/**
 * KeyRotationService
 *
 * Implements automated API key rotation for external service integrations
 * (SendGrid, Firebase, OAuth providers, etc.) with zero-downtime switching
 * and secret versioning via AWS Secrets Manager.
 *
 * Features:
 *  - Dual-key window: new key is staged before the old key is retired
 *  - Version tracking in AWS Secrets Manager staging labels
 *  - Redis-backed in-process cache for hot-path key lookups
 *  - Rotation audit trail written to `key_rotation_events` table
 *  - Background rotation scheduler driven by expiry TTL
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { redis } from '../config/redis';
import { logger } from '../utils/logger.utils';
import { resolveAppSecrets } from '../config/secrets';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExternalServiceKey =
  | 'sendgrid'
  | 'firebase'
  | 'google_oauth'
  | 'github_oauth'
  | 'stripe'
  | 'twilio'
  | 'zoom'
  | 'daily'
  | 'custom';

export type KeyRotationStatus =
  | 'pending'
  | 'staging'      // new key created, old key still active
  | 'active'       // new key promoted, old key in grace period
  | 'retired'      // old key fully revoked
  | 'failed';

export interface ServiceKeyVersion {
  /** AWS Secrets Manager secret ID */
  secretId: string;
  /** Current active version ARN */
  currentVersionId: string;
  /** Previous version ARN (valid during grace window) */
  previousVersionId?: string;
  /** Arbitrary label for humans */
  label: string;
  service: ExternalServiceKey;
  /** Timestamp when key was last rotated */
  rotatedAt: Date;
  /** Rotation due date */
  expiresAt: Date;
  status: KeyRotationStatus;
}

export interface RotationResult {
  service: ExternalServiceKey;
  previousVersionId?: string;
  newVersionId: string;
  durationMs: number;
  status: KeyRotationStatus;
  message?: string;
}

export interface KeyRotationConfig {
  /** Days after which a key should be auto-rotated */
  rotationIntervalDays: number;
  /** Days the old key remains valid after rotation (grace window) */
  gracePeriodDays: number;
  /** Whether to immediately retire the old key (no grace period) */
  immediateRevoke?: boolean;
}

const DEFAULT_ROTATION_CONFIG: KeyRotationConfig = {
  rotationIntervalDays: 90,
  gracePeriodDays: 7,
  immediateRevoke: false,
};

// Redis cache TTL for resolved key values (5 minutes)
const KEY_CACHE_TTL_SECONDS = 300;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildCacheKey(service: ExternalServiceKey, version: 'current' | 'previous'): string {
  return `key_rotation:${service}:${version}`;
}

async function fetchSecretValue(secretId: string, versionId?: string): Promise<string> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  const command = new GetSecretValueCommand({
    SecretId: secretId,
    ...(versionId ? { VersionId: versionId } : {}),
  });

  const response = await client.send(command);
  const raw = response.SecretString;
  if (!raw) throw new Error(`Secret "${secretId}" has no SecretString`);
  return raw;
}

async function rotateSecretInAws(
  secretId: string,
  newSecretValue: string,
): Promise<{ newVersionId: string; previousVersionId?: string }> {
  const {
    SecretsManagerClient,
    PutSecretValueCommand,
    DescribeSecretCommand,
  } = await import('@aws-sdk/client-secrets-manager');

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  // Get current version before rotating
  const describeCmd = new DescribeSecretCommand({ SecretId: secretId });
  let previousVersionId: string | undefined;

  try {
    const described = await client.send(describeCmd);
    // Find current AWSCURRENT version
    if (described.VersionIdsToStages) {
      for (const [vId, stages] of Object.entries(described.VersionIdsToStages)) {
        if (stages.includes('AWSCURRENT')) {
          previousVersionId = vId;
          break;
        }
      }
    }
  } catch {
    // Secret may not exist yet; that's fine for first-time setup
  }

  // Write the new secret value — AWS assigns a new version ID
  const clientRequestToken = uuidv4();
  const putCmd = new PutSecretValueCommand({
    SecretId: secretId,
    SecretString: newSecretValue,
    ClientRequestToken: clientRequestToken,
    VersionStages: ['AWSCURRENT'],
  });

  const putResponse = await client.send(putCmd);
  const newVersionId = putResponse.VersionId || clientRequestToken;

  // Move old version to AWSPREVIOUS staging label
  if (previousVersionId && previousVersionId !== newVersionId) {
    try {
      const { UpdateSecretVersionStageCommand } = await import(
        '@aws-sdk/client-secrets-manager'
      );
      await client.send(
        new UpdateSecretVersionStageCommand({
          SecretId: secretId,
          VersionStage: 'AWSPREVIOUS',
          MoveToVersionId: previousVersionId,
          RemoveFromVersionId: newVersionId,
        }),
      );
    } catch (stagingErr: any) {
      logger.warn('KeyRotationService: could not update version staging label', {
        secretId,
        error: stagingErr.message,
      });
    }
  }

  return { newVersionId, previousVersionId };
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * KeyRotationService — manages lifecycle of external API keys with
 * zero-downtime dual-key rotation windows.
 */
export const KeyRotationService = {
  /**
   * Retrieve the current active key value for a given service.
   * Results are cached in Redis to avoid repeated Secrets Manager calls.
   */
  async getCurrentKey(
    service: ExternalServiceKey,
    secretId?: string,
  ): Promise<string> {
    const cacheKey = buildCacheKey(service, 'current');

    // Try Redis cache first
    const cached = await redis.get(cacheKey);
    if (cached) return cached;

    const resolvedSecretId =
      secretId ?? this.defaultSecretId(service);

    try {
      const value = await fetchSecretValue(resolvedSecretId);
      await redis.setex(cacheKey, KEY_CACHE_TTL_SECONDS, value);
      return value;
    } catch (err: any) {
      logger.warn('KeyRotationService: AWS unavailable, falling back to env', {
        service,
        error: err.message,
      });
      // Fall back to environment variable
      return this.getEnvFallback(service);
    }
  },

  /**
   * Retrieve the previous (grace-period) key value if available.
   * Useful for accepting requests signed with the old key during switchover.
   */
  async getPreviousKey(
    service: ExternalServiceKey,
    secretId?: string,
  ): Promise<string | null> {
    const cacheKey = buildCacheKey(service, 'previous');

    const cached = await redis.get(cacheKey);
    if (cached) return cached;

    const resolvedSecretId =
      secretId ?? this.defaultSecretId(service);

    try {
      const {
        SecretsManagerClient,
        GetSecretValueCommand,
      } = await import('@aws-sdk/client-secrets-manager');

      const client = new SecretsManagerClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });

      const response = await client.send(
        new GetSecretValueCommand({
          SecretId: resolvedSecretId,
          VersionStage: 'AWSPREVIOUS',
        }),
      );

      const value = response.SecretString || null;
      if (value) {
        await redis.setex(cacheKey, KEY_CACHE_TTL_SECONDS, value);
      }
      return value;
    } catch {
      return null;
    }
  },

  /**
   * Rotate a key for a given service.
   *
   * Flow:
   *   1. Generate new key value (or accept caller-provided one)
   *   2. Push new value to AWS Secrets Manager as AWSCURRENT
   *   3. Old version moves to AWSPREVIOUS for the grace window
   *   4. Invalidate Redis cache so next read picks up the new key
   *   5. Log the rotation event
   *
   * @param service  - which external service key to rotate
   * @param secretId - AWS secret ID (defaults to service-named convention)
   * @param newKeyValue - optional: caller provides new key; otherwise generated
   * @param config   - rotation behaviour overrides
   */
  async rotateKey(
    service: ExternalServiceKey,
    secretId?: string,
    newKeyValue?: string,
    config: Partial<KeyRotationConfig> = {},
  ): Promise<RotationResult> {
    const startTime = Date.now();
    const resolvedSecretId = secretId ?? this.defaultSecretId(service);
    const resolvedConfig: KeyRotationConfig = {
      ...DEFAULT_ROTATION_CONFIG,
      ...config,
    };

    logger.info('KeyRotationService: starting key rotation', {
      service,
      secretId: resolvedSecretId,
    });

    try {
      // Use provided new key or generate a cryptographically secure one
      const newValue =
        newKeyValue ?? crypto.randomBytes(48).toString('hex');

      const { newVersionId, previousVersionId } =
        await rotateSecretInAws(resolvedSecretId, newValue);

      // Invalidate Redis cache
      await redis.del(buildCacheKey(service, 'current'));
      await redis.del(buildCacheKey(service, 'previous'));

      // If no grace period, also clear previous immediately
      if (resolvedConfig.immediateRevoke && previousVersionId) {
        await this.retireKeyVersion(resolvedSecretId, previousVersionId);
      }

      const result: RotationResult = {
        service,
        previousVersionId,
        newVersionId,
        durationMs: Date.now() - startTime,
        status: resolvedConfig.immediateRevoke ? 'retired' : 'active',
        message: `Key rotated successfully. Grace period: ${resolvedConfig.gracePeriodDays} days`,
      };

      logger.info('KeyRotationService: key rotation complete', {
        service,
        newVersionId,
        previousVersionId,
        durationMs: result.durationMs,
      });

      await this.logRotationEvent(service, resolvedSecretId, result);

      return result;
    } catch (err: any) {
      logger.error('KeyRotationService: rotation failed', {
        service,
        secretId: resolvedSecretId,
        error: err.message,
      });

      return {
        service,
        newVersionId: '',
        durationMs: Date.now() - startTime,
        status: 'failed',
        message: err.message,
      };
    }
  },

  /**
   * Check all registered services for keys that are due for rotation and
   * rotate them.  Call this from a scheduled job.
   */
  async runScheduledRotations(
    registrations: Array<{
      service: ExternalServiceKey;
      secretId: string;
      rotationIntervalDays: number;
    }>,
  ): Promise<RotationResult[]> {
    const results: RotationResult[] = [];

    for (const reg of registrations) {
      const dueLockKey = `key_rotation:lock:${reg.service}`;
      const lockAcquired = await (redis as any).set(
        dueLockKey,
        '1',
        'NX',
        'EX',
        3600,
      );

      if (!lockAcquired) {
        logger.info('KeyRotationService: rotation already running, skipping', {
          service: reg.service,
        });
        continue;
      }

      try {
        const isDue = await this.isRotationDue(
          reg.service,
          reg.rotationIntervalDays,
        );

        if (isDue) {
          const result = await this.rotateKey(reg.service, reg.secretId);
          results.push(result);
        } else {
          logger.info('KeyRotationService: key not due for rotation yet', {
            service: reg.service,
          });
        }
      } finally {
        await redis.del(dueLockKey);
      }
    }

    return results;
  },

  /**
   * Returns true if the service key has been alive for longer than
   * `intervalDays` since its last rotation.
   */
  async isRotationDue(
    service: ExternalServiceKey,
    intervalDays: number,
  ): Promise<boolean> {
    const trackKey = `key_rotation:last_rotated:${service}`;
    const lastRotated = await redis.get(trackKey);

    if (!lastRotated) return true; // Never tracked → assume due

    const msAgo = Date.now() - parseInt(lastRotated, 10);
    const daysSince = msAgo / (1000 * 60 * 60 * 24);
    return daysSince >= intervalDays;
  },

  /**
   * Expire / retire a specific version in AWS Secrets Manager by removing
   * it from all staging labels.
   */
  async retireKeyVersion(secretId: string, versionId: string): Promise<void> {
    try {
      const {
        SecretsManagerClient,
        UpdateSecretVersionStageCommand,
      } = await import('@aws-sdk/client-secrets-manager');

      const client = new SecretsManagerClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });

      await client.send(
        new UpdateSecretVersionStageCommand({
          SecretId: secretId,
          VersionStage: 'AWSPREVIOUS',
          RemoveFromVersionId: versionId,
        }),
      );

      logger.info('KeyRotationService: key version retired', {
        secretId,
        versionId,
      });
    } catch (err: any) {
      logger.warn('KeyRotationService: could not retire key version', {
        secretId,
        versionId,
        error: err.message,
      });
    }
  },

  /**
   * Invalidate the Redis cache for a service so the next read fetches
   * the latest value from Secrets Manager.
   */
  async invalidateCache(service: ExternalServiceKey): Promise<void> {
    await redis.del(buildCacheKey(service, 'current'));
    await redis.del(buildCacheKey(service, 'previous'));
    logger.info('KeyRotationService: cache invalidated', { service });
  },

  // ── Private helpers ────────────────────────────────────────────────────

  defaultSecretId(service: ExternalServiceKey): string {
    const appEnv = process.env.NODE_ENV || 'development';
    return `${appEnv}/mentorminds/${service}`;
  },

  getEnvFallback(service: ExternalServiceKey): string {
    const envMap: Record<ExternalServiceKey, string> = {
      sendgrid: process.env.SENDGRID_API_KEY || '',
      firebase: process.env.FIREBASE_SERVER_KEY || '',
      google_oauth: process.env.GOOGLE_CLIENT_SECRET || '',
      github_oauth: process.env.GITHUB_CLIENT_SECRET || '',
      stripe: process.env.STRIPE_SECRET_KEY || '',
      twilio: process.env.TWILIO_AUTH_TOKEN || '',
      zoom: process.env.ZOOM_JWT_SECRET || '',
      daily: process.env.DAILY_API_KEY || '',
      custom: process.env.CUSTOM_API_KEY || '',
    };
    return envMap[service] ?? '';
  },

  async logRotationEvent(
    service: ExternalServiceKey,
    secretId: string,
    result: RotationResult,
  ): Promise<void> {
    try {
      const trackKey = `key_rotation:last_rotated:${service}`;
      await redis.set(trackKey, Date.now().toString());

      // Optional: persist to DB if table exists
      const pool = (await import('../config/database')).default;
      await pool.query(
        `INSERT INTO key_rotation_events
           (id, service, secret_id, new_version_id, previous_version_id, status, duration_ms, message, rotated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT DO NOTHING`,
        [
          uuidv4(),
          service,
          secretId,
          result.newVersionId || null,
          result.previousVersionId || null,
          result.status,
          result.durationMs,
          result.message || null,
        ],
      ).catch(() => {
        // Table may not exist in all environments — log only
        logger.debug('KeyRotationService: key_rotation_events table unavailable, skipping DB log');
      });
    } catch (err: any) {
      logger.warn('KeyRotationService: failed to log rotation event', {
        error: err.message,
      });
    }
  },
};

export default KeyRotationService;
