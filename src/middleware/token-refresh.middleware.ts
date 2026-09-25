import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { TokenService } from '../services/token.service';
import { JwtUtils } from '../utils/jwt.utils';
import { ResponseUtil } from '../utils/response.utils';
import { logger } from '../utils/logger';
import config from '../config';
import { env } from '../config/env';

/**
 * Middleware to handle token refresh requests
 * Rotates the refresh token and issues a new access token
 */
export const handleTokenRefresh = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      ResponseUtil.unauthorized(res, 'Refresh token required');
      return;
    }

    const fingerprint = JwtUtils.getDeviceFingerprint(req) ?? undefined;

    try {
      const tokens = await TokenService.rotateRefreshToken(
        refreshToken,
        fingerprint,
      );
      ResponseUtil.success(res, tokens, 'Token refreshed successfully');
    } catch (error: any) {
      // Check for specific security errors to log them
      if (
        error.message.includes('Suspicious activity') ||
        error.message.includes('Device mismatch')
      ) {
        // Here you could also trigger an audit log or email the user
        logger.warn('Security alert detected during token refresh', { message: error.message, ip: req.ip });
        ResponseUtil.unauthorized(res, 'Security alert: Session revoked');
        return;
      }

      ResponseUtil.unauthorized(res, error.message || 'Invalid refresh token');
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Access token verification middleware that enforces token expiration.
 * Rejects expired tokens with 401 TOKEN_EXPIRED and directs client to /auth/refresh.
 * Distinguishes between expired tokens and invalid tokens.
 */
export const tokenRefreshMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.headers['x-access-token']) {
      token = req.headers['x-access-token'] as string;
    } else if (req.body?.accessToken) {
      token = req.body.accessToken;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Invalid token: No token provided.',
        code: 'TOKEN_INVALID',
      });
      return;
    }

    const secret = env.JWT_SECRET || config?.jwt?.secret || 'test-jwt-secret';

    let decoded: any;
    try {
      decoded = jwt.verify(token, secret, { ignoreExpiration: false });
    } catch (err: any) {
      if (config?.jwt?.secret && config.jwt.secret !== secret) {
        try {
          decoded = jwt.verify(token, config.jwt.secret, { ignoreExpiration: false });
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // Explicit check against current system time (works with jest.setSystemTime)
    if (decoded && typeof decoded === 'object' && decoded.exp) {
      const nowInSeconds = Math.floor(Date.now() / 1000);
      if (decoded.exp <= nowInSeconds) {
        res.status(401).json({
          success: false,
          error: 'Token expired. Please use the refresh endpoint.',
          code: 'TOKEN_EXPIRED',
        });
        return;
      }
    }

    (req as any).user = decoded;
    next();
  } catch (error: any) {
    if (error instanceof jwt.TokenExpiredError || error.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        error: 'Token expired. Please use the refresh endpoint.',
        code: 'TOKEN_EXPIRED',
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: 'Invalid token.',
      code: 'TOKEN_INVALID',
    });
  }
};

export const verifyAccessToken = tokenRefreshMiddleware;
export const validateAccessToken = tokenRefreshMiddleware;
export default tokenRefreshMiddleware;
