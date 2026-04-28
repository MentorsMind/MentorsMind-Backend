import jwt, { SignOptions } from 'jsonwebtoken';
import config from '../config';
import crypto from 'crypto';
import { Request } from 'express';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  fingerprint?: string;
}

export interface DecodedToken extends TokenPayload {
  iat: number;
  exp: number;
  jti: string;
}

export const JwtUtils = {
  isSha256Hash(value: string): boolean {
    return /^[a-f0-9]{64}$/i.test(value);
  },

  /**
   * Generate access token with short TTL (15 min)
   */
  generateAccessToken(payload: TokenPayload, fingerprint?: string): string {
    const options: SignOptions = {
      expiresIn: '15m', // Hardened: 15 min as requested
      issuer: 'mentorsmind-api',
      audience: 'mentorsmind-client',
      jwtid: crypto.randomUUID(),
    };

    const finalPayload = {
      ...payload,
      fingerprint: fingerprint ? this.hashFingerprint(fingerprint) : undefined,
    };

    return jwt.sign(finalPayload, config.jwt.secret, options);
  },

  /**
   * Generate refresh token with longer TTL (7 days)
   */
  generateRefreshToken(payload: TokenPayload, fingerprint?: string): string {
    const options: SignOptions = {
      expiresIn: '7d', // Hardened: 7 days as requested
      issuer: 'mentorsmind-api',
      audience: 'mentorsmind-client',
      jwtid: crypto.randomUUID(),
    };

    const finalPayload = {
      ...payload,
      fingerprint: fingerprint ? this.hashFingerprint(fingerprint) : undefined,
    };

    return jwt.sign(finalPayload, config.jwt.refreshSecret, options);
  },

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): DecodedToken {
    return jwt.verify(token, config.jwt.secret, {
      issuer: 'mentorsmind-api',
      audience: 'mentorsmind-client',
    }) as DecodedToken;
  },

  /**
   * Verify refresh token
   */
  verifyRefreshToken(token: string): DecodedToken {
    return jwt.verify(token, config.jwt.refreshSecret, {
      issuer: 'mentorsmind-api',
      audience: 'mentorsmind-client',
    }) as DecodedToken;
  },

  /**
   * Generate device fingerprint from request
   */
  getDeviceFingerprint(req: Request): string | null {
    const userAgentHeader = req.headers['user-agent'];
    const acceptLanguageHeader = req.headers['accept-language'];
    const forwardedFor = req.headers['x-forwarded-for'];

    const userAgent =
      typeof userAgentHeader === 'string' ? userAgentHeader.trim() : '';
    const acceptLanguage =
      typeof acceptLanguageHeader === 'string'
        ? acceptLanguageHeader.trim()
        : '';
    const forwardedIp =
      typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0]?.trim() || ''
        : Array.isArray(forwardedFor)
          ? forwardedFor[0] || ''
          : '';
    const ip = req.ip || forwardedIp || req.socket?.remoteAddress || '';

    if (!userAgent && !acceptLanguage && !ip) {
      return null;
    }

    return this.hashFingerprint(`${userAgent}|${acceptLanguage}|${ip}`);
  },

  /**
   * Hash fingerprint for privacy in token
   */
  hashFingerprint(fingerprint: string): string {
    if (this.isSha256Hash(fingerprint)) {
      return fingerprint;
    }
    return crypto.createHash('sha256').update(fingerprint).digest('hex');
  },

  /**
   * Hash token for storage in DB
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  },
};
