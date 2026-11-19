/**
 * JwksService — RSA-256 key pair management for zero-downtime JWT rotation.
 *
 * Key storage strategy:
 *   - Redis (preferred, multi-instance safe): keys stored as JSON under
 *     "jwks:current" and "jwks:previous".
 *   - In-memory fallback: used when Redis is unavailable (single-instance /
 *     development). Keys are regenerated on restart in this mode.
 *
 * Rotation model:
 *   - Two slots: "current" and "previous".
 *   - Access tokens are always signed with the current key.
 *   - Tokens signed with the previous key remain valid for 24 hours after
 *     rotation (enforced by the key's rotatedAt timestamp in middleware).
 *   - POST /admin/auth/rotate-keys: current → previous, new key → current.
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.utils';
import { redis } from '../config/redis';
import * as Sentry from '@sentry/node';
import { AuditLogService } from './auditLog.service';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROTATION_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
const TTL_EXTENSION_GRACE_MS = 1 * 60 * 60 * 1000; // 1 hour beyond grace period
const REDIS_KEY_CURRENT = 'jwks:current';
const REDIS_KEY_PREVIOUS = 'jwks:previous';
const REDIS_KEY_LAST_ROTATED = 'jwks:lastRotated';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KeyPair {
  kid: string;           // key ID — included in JWT header
  privateKeyPem: string; // RSA private key (PEM) — sign only
  publicKeyPem: string;  // RSA public key (PEM) — verify + JWKS export
  createdAt: number;     // Unix ms
  rotatedAt?: number;    // Unix ms — set when demoted to "previous"
  notBefore?: number;    // Unix ms — key becomes valid at this time
  notAfter?: number;     // Unix ms — key expires after this time
}

export interface JwkPublic {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;   // base64url modulus
  e: string;   // base64url exponent
  nbf?: number; // not before (Unix seconds)
  exp?: number; // not after (Unix seconds)
}

export interface JwksDocument {
  keys: JwkPublic[];
}

export interface JwksRotationStatus {
  currentKid: string | null;
  previousKid: string | null;
  lastRotated: number | null;
  nextRotationDue: number | null;
}

// ─── In-memory fallback ───────────────────────────────────────────────────────

let _memCurrent: KeyPair | null = null;
let _memPrevious: KeyPair | null = null;
let _lastRotated: number | null = null;
let _redisSubscriber: any = null;

// ─── Core helpers ─────────────────────────────────────────────────────────────

function generateKeyPair(): KeyPair {
  const now = Date.now();
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return {
    kid: crypto.randomUUID(),
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    createdAt: now,
    notBefore: now,
    notAfter: now + ROTATION_INTERVAL_MS + GRACE_PERIOD_MS,
  };
}

/**
 * Convert a PEM public key to a JWK (RSA public key components).
 */
function pemToJwk(pair: KeyPair): JwkPublic {
  const keyObj = crypto.createPublicKey(pair.publicKeyPem);
  const { n, e } = keyObj.export({ format: 'jwk' }) as { n: string; e: string };
  return {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid: pair.kid,
    n,
    e,
    ...(pair.notBefore && { nbf: Math.floor(pair.notBefore / 1000) }),
    ...(pair.notAfter && { exp: Math.floor(pair.notAfter / 1000) }),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const JwksService = {
  /**
   * Initialise key store on startup.
   * Generates a new current key if none exists yet.
   */
  async initialize(): Promise<void> {
    const current = await this.getCurrentKey();
    if (!current) {
      logger.info('No JWKS keys found — generating initial RSA key pair');
      const pair = generateKeyPair();
      await this._saveKey(REDIS_KEY_CURRENT, 'current', pair);
      await this._setLastRotated(Date.now());
    }

    // Set up pub/sub for cross-instance rotation syncing
    if (!_redisSubscriber) {
      _redisSubscriber = redis.duplicate();
      await _redisSubscriber.subscribe('jwks:rotated');
      _redisSubscriber.on('message', async (channel: string) => {
        if (channel === 'jwks:rotated') {
          logger.info('Received JWKS rotated event via Pub/Sub, reloading keys');
          await this._loadKey(REDIS_KEY_CURRENT, 'current');
          await this._loadKey(REDIS_KEY_PREVIOUS, 'previous');
          await this._getLastRotated();
        }
      });
    }
  },

  /**
   * Return the current (signing) key pair.
   */
  async getCurrentKey(): Promise<KeyPair | null> {
    return this._loadKey(REDIS_KEY_CURRENT, 'current');
  },

  /**
   * Return the previous key pair (valid for grace period after rotation).
   */
  async getPreviousKey(): Promise<KeyPair | null> {
    return this._loadKey(REDIS_KEY_PREVIOUS, 'previous');
  },

  /**
   * Find a key pair by kid — searches current then previous.
   */
  async getKeyById(kid: string): Promise<KeyPair | null> {
    const now = Date.now();
    
    const current = await this.getCurrentKey();
    if (current?.kid === kid) {
      // Check if key is within validity period
      if (
        (!current.notBefore || now >= current.notBefore) && 
        (!current.notAfter || now <= current.notAfter)
      ) {
        return current;
      }
    }
    
    const previous = await this.getPreviousKey();
    if (previous?.kid === kid) {
      // Check if key is within validity period
      if (
        (!previous.notBefore || now >= previous.notBefore) && 
        (!previous.notAfter || now <= previous.notAfter)
      ) {
        // Also check if still within grace period after rotation
        const rotatedAt = previous.rotatedAt ?? previous.createdAt;
        if (now - rotatedAt < GRACE_PERIOD_MS) {
          return previous;
        }
      }
    }
    return null;
  },

  /**
   * Rotate keys:
   *   1. current → previous (stamp rotatedAt)
   *   2. new key pair → current
   * Returns the new current key's kid.
   */
  async rotateKeys(isAuto = false): Promise<{ newKid: string; previousKid: string | null }> {
    const now = Date.now();
    const current = await this.getCurrentKey();
    const previousKid = current?.kid ?? null;

    if (current) {
      const demoted: KeyPair = { 
        ...current, 
        rotatedAt: now,
        notAfter: now + GRACE_PERIOD_MS // Previous key expires after grace period
      };
      await this._saveKey(REDIS_KEY_PREVIOUS, 'previous', demoted);
    }

    const newPair = generateKeyPair();
    await this._saveKey(REDIS_KEY_CURRENT, 'current', newPair);
    await this._setLastRotated(now);

    // Emit audit log
    await AuditLogService.log({
      userId: null,
      action: isAuto ? 'JWT_KEY_AUTO_ROTATED' : 'JWT_KEY_ROTATED',
      resourceType: 'auth',
      metadata: { newKid: newPair.kid, previousKid, isAuto },
    });

    // Capture Sentry event
    Sentry.captureMessage(isAuto ? 'JWT keys auto-rotated' : 'JWT keys rotated', {
      level: 'info',
      tags: { component: 'jwks' },
      extra: { newKid: newPair.kid, previousKid },
    });

    logger.info('JWT key rotation complete', { 
      newKid: newPair.kid, 
      previousKid,
      isAuto 
    });
    
    // Publish rotation event so other instances reload caches
    await redis.publish('jwks:rotated', now.toString());

    return { newKid: newPair.kid, previousKid };
  },

  /**
   * Automatically rotate keys if interval has passed.
   * Safe to call on a schedule.
   */
  async autoRotateIfNeeded(): Promise<void> {
    const lastRotated = await this._getLastRotated();
    const now = Date.now();
    
    if (!lastRotated || now - lastRotated >= ROTATION_INTERVAL_MS) {
      logger.info('Auto-rotating JWT keys', { lastRotated, now });
      await this.rotateKeys(true);
    } else {
      logger.debug('No JWT key rotation needed', { lastRotated, nextDue: lastRotated + ROTATION_INTERVAL_MS });
    }
  },

  /**
   * Get rotation status for health check/diagnostics.
   */
  async getRotationStatus(): Promise<JwksRotationStatus> {
    const current = await this.getCurrentKey();
    const previous = await this.getPreviousKey();
    const lastRotated = await this._getLastRotated();
    
    return {
      currentKid: current?.kid ?? null,
      previousKid: previous?.kid ?? null,
      lastRotated,
      nextRotationDue: lastRotated ? lastRotated + ROTATION_INTERVAL_MS : null,
    };
  },

  /**
   * Build the public JWKS document (only expose public keys).
   * Includes both current and previous keys so clients can verify old tokens.
   */
  async getJwksDocument(): Promise<JwksDocument> {
    const keys: JwkPublic[] = [];
    const now = Date.now();

    const current = await this.getCurrentKey();
    if (current) {
      // Only include current key if it's within its validity window
      if (
        (!current.notBefore || now >= current.notBefore) && 
        (!current.notAfter || now <= current.notAfter)
      ) {
        keys.push(pemToJwk(current));
      }
    }

    const previous = await this.getPreviousKey();
    if (previous) {
      // Only include previous key if it's still valid
      const rotatedAt = previous.rotatedAt ?? previous.createdAt;
      if (
        now - rotatedAt < GRACE_PERIOD_MS &&
        (!previous.notBefore || now >= previous.notBefore) && 
        (!previous.notAfter || now <= previous.notAfter)
      ) {
        keys.push(pemToJwk(previous));
      }
    }

    return { keys };
  },

  /**
   * Return the verification method metadata currently used to sign DID credentials.
   * This supports downstream W3C verification and public revocation registry proofs.
   */
  async getCurrentVerificationMethod(): Promise<{ id: string; type: string; controller: string; publicKeyPem: string; kid: string }> {
    const current = await this.getCurrentKey();
    if (!current) {
      throw new Error("No signing key available for DID verification method");
    }

    return {
      id: `${process.env.PLATFORM_DID || "did:web:api.mentorminds.com"}#key-1`,
      type: "RsaVerificationKey2018",
      controller: process.env.PLATFORM_DID || "did:web:api.mentorminds.com",
      publicKeyPem: current.publicKeyPem,
      kid: current.kid,
    };
  },

  /**
   * Check whether a key is still within its validity window.
   */
  isKeyValid(key: KeyPair): boolean {
    const now = Date.now();
    const rotatedAt = key.rotatedAt ?? key.createdAt;
    
    // Check if key is within validity period
    if (key.notBefore && now < key.notBefore) return false;
    if (key.notAfter && now > key.notAfter) return false;
    
    // If it's a previous key, check grace period
    if (key.rotatedAt) {
      return now - rotatedAt < GRACE_PERIOD_MS;
    }
    
    return true;
  },

  // ─── Private storage helpers ───────────────────────────────────────────────

  async _saveKey(redisKey: string, memSlot: 'current' | 'previous', pair: KeyPair): Promise<void> {
    const json = JSON.stringify(pair);
    try {
      // Use shared Redis client
      if (memSlot === 'previous') {
        // Previous key expires after grace period + 1 hour
        const ttl = Math.ceil((GRACE_PERIOD_MS + TTL_EXTENSION_GRACE_MS) / 1000);
        await redis.set(redisKey, json, 'EX', ttl);
      } else {
        await redis.set(redisKey, json);
      }
    } catch (err) {
      logger.warn('Failed to save key to Redis, falling back to in-memory', { error: err });
    }
    // Always keep in-memory copy as fallback
    if (memSlot === 'current') _memCurrent = pair;
    else _memPrevious = pair;
  },

  async _loadKey(redisKey: string, memSlot: 'current' | 'previous'): Promise<KeyPair | null> {
    try {
      const raw = await redis.get(redisKey);
      if (raw) {
        const pair = JSON.parse(raw) as KeyPair;
        // Keep in-memory in sync
        if (memSlot === 'current') _memCurrent = pair;
        else _memPrevious = pair;
        return pair;
      }
    } catch (err) {
      logger.warn('Failed to load key from Redis, using in-memory fallback', { error: err });
    }
    return memSlot === 'current' ? _memCurrent : _memPrevious;
  },

  async _getLastRotated(): Promise<number | null> {
    try {
      const raw = await redis.get(REDIS_KEY_LAST_ROTATED);
      if (raw) {
        const val = parseInt(raw, 10);
        _lastRotated = val;
        return val;
      }
    } catch (err) {
      logger.warn('Failed to load lastRotated from Redis', { error: err });
    }
    return _lastRotated;
  },

  async _setLastRotated(timestamp: number): Promise<void> {
    try {
      await redis.set(REDIS_KEY_LAST_ROTATED, timestamp.toString());
    } catch (err) {
      logger.warn('Failed to save lastRotated to Redis', { error: err });
    }
    _lastRotated = timestamp;
  },
};
