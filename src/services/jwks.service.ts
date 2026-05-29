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
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KeyPair {
  kid: string;           // key ID — included in JWT header
  privateKeyPem: string; // RSA private key (PEM) — sign only
  publicKeyPem: string;  // RSA public key (PEM) — verify + JWKS export
  createdAt: number;     // Unix ms
  rotatedAt?: number;    // Unix ms — set when demoted to "previous"
}

export interface JwkPublic {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;   // base64url modulus
  e: string;   // base64url exponent
}

export interface JwksDocument {
  keys: JwkPublic[];
}

// ─── Redis helpers (same lazy-init pattern as rate-limiter.service.ts) ────────

let _redis: any = null;
let _redisOk = false;

async function getRedis(): Promise<any | null> {
  if (_redis) return _redisOk ? _redis : null;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: Redis } = await import('ioredis');
    _redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000, enableOfflineQueue: false });
    _redis.on('error', () => { _redisOk = false; });
    _redis.on('connect', () => { _redisOk = true; });
    await _redis.connect();
    return _redis;
  } catch {
    return null;
  }
}

const REDIS_KEY_CURRENT = 'jwks:current';
const REDIS_KEY_PREVIOUS = 'jwks:previous';

// ─── In-memory fallback ───────────────────────────────────────────────────────

let _memCurrent: KeyPair | null = null;
let _memPrevious: KeyPair | null = null;

// ─── Core helpers ─────────────────────────────────────────────────────────────

function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return {
    kid: crypto.randomUUID(),
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    createdAt: Date.now(),
  };
}

/**
 * Convert a PEM public key to a JWK (RSA public key components).
 */
function pemToJwk(pair: KeyPair): JwkPublic {
  const keyObj = crypto.createPublicKey(pair.publicKeyPem);
  const { n, e } = keyObj.export({ format: 'jwk' }) as { n: string; e: string };
  return { kty: 'RSA', use: 'sig', alg: 'RS256', kid: pair.kid, n, e };
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
    }
  },

  /**
   * Return the current (signing) key pair.
   */
  async getCurrentKey(): Promise<KeyPair | null> {
    return this._loadKey(REDIS_KEY_CURRENT, 'current');
  },

  /**
   * Return the previous key pair (valid for 24 h after rotation).
   */
  async getPreviousKey(): Promise<KeyPair | null> {
    return this._loadKey(REDIS_KEY_PREVIOUS, 'previous');
  },

  /**
   * Find a key pair by kid — searches current then previous.
   */
  async getKeyById(kid: string): Promise<KeyPair | null> {
    const current = await this.getCurrentKey();
    if (current?.kid === kid) return current;
    const previous = await this.getPreviousKey();
    if (previous?.kid === kid) return previous;
    return null;
  },

  /**
   * Rotate keys:
   *   1. current → previous (stamp rotatedAt)
   *   2. new key pair → current
   * Returns the new current key's kid.
   */
  async rotateKeys(): Promise<{ newKid: string; previousKid: string | null }> {
    const current = await this.getCurrentKey();
    const previousKid = current?.kid ?? null;

    if (current) {
      const demoted: KeyPair = { ...current, rotatedAt: Date.now() };
      await this._saveKey(REDIS_KEY_PREVIOUS, 'previous', demoted);
    }

    const newPair = generateKeyPair();
    await this._saveKey(REDIS_KEY_CURRENT, 'current', newPair);

    logger.info('JWT key rotation complete', { newKid: newPair.kid, previousKid });
    return { newKid: newPair.kid, previousKid };
  },

  /**
   * Build the public JWKS document (only expose public keys).
   * Includes both current and previous keys so clients can verify old tokens.
   */
  async getJwksDocument(): Promise<JwksDocument> {
    const keys: JwkPublic[] = [];

    const current = await this.getCurrentKey();
    if (current) keys.push(pemToJwk(current));

    const previous = await this.getPreviousKey();
    if (previous) {
      // Only include previous key if it's within the 24-hour validity window
      const age = Date.now() - (previous.rotatedAt ?? previous.createdAt);
      if (age < 24 * 60 * 60 * 1000) {
        keys.push(pemToJwk(previous));
      }
    }

    return { keys };
  },

  /**
   * Check whether a previous key is still within its 24-hour validity window.
   */
  isPreviousKeyValid(previous: KeyPair): boolean {
    const rotatedAt = previous.rotatedAt ?? previous.createdAt;
    return Date.now() - rotatedAt < 24 * 60 * 60 * 1000;
  },

  // ─── Private storage helpers ───────────────────────────────────────────────

  async _saveKey(redisKey: string, memSlot: 'current' | 'previous', pair: KeyPair): Promise<void> {
    const json = JSON.stringify(pair);
    const redis = await getRedis();
    if (redis && _redisOk) {
      // No TTL on current; previous expires after 25 h (1 h grace beyond validity window)
      if (memSlot === 'previous') {
        await redis.set(redisKey, json, 'EX', 25 * 60 * 60);
      } else {
        await redis.set(redisKey, json);
      }
    }
    // Always keep in-memory copy as fallback
    if (memSlot === 'current') _memCurrent = pair;
    else _memPrevious = pair;
  },

  async _loadKey(redisKey: string, memSlot: 'current' | 'previous'): Promise<KeyPair | null> {
    const redis = await getRedis();
    if (redis && _redisOk) {
      try {
        const raw = await redis.get(redisKey);
        if (raw) {
          const pair = JSON.parse(raw) as KeyPair;
          // Keep in-memory in sync
          if (memSlot === 'current') _memCurrent = pair;
          else _memPrevious = pair;
          return pair;
        }
        return null;
      } catch {
        // fall through to memory
      }
    }
    return memSlot === 'current' ? _memCurrent : _memPrevious;
  },
};
