import { Request, Response, NextFunction } from 'express';
import { WebhookService, WebhookRecord } from '../services/webhook.service';
import { RateLimiterService } from '../services/rate-limiter.service';
import rateLimitsConfig from '../config/rate-limits.config';
import { ResponseUtil } from '../utils/response.utils';
import { logger } from '../utils/logger';
import { extractIpAddress } from '../services/auditLog.service';

export interface WebhookAuthenticatedRequest extends Request {
  webhook?: WebhookRecord;
}

/**
 * Middleware to authenticate webhook requests using an API key.
 * 
 * Features:
 * 1. Validate X-API-Key header
 * 2. Log authentication failures to database
 * 3. Rate limit by API key
 */
export const webhookAuth = async (
  req: WebhookAuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string;
  const ip = extractIpAddress(req);
  const userAgent = req.headers['user-agent'] || 'unknown';

  if (!apiKey) {
    await WebhookService.logAuthFailure(null, ip, userAgent, 'Missing API key');
    return ResponseUtil.unauthorized(res, 'API key is required in X-API-Key header');
  }

  try {
    const webhook = await WebhookService.validateApiKey(apiKey);

    if (!webhook) {
      await WebhookService.logAuthFailure(null, ip, userAgent, 'Invalid API key');
      return ResponseUtil.unauthorized(res, 'Invalid or expired API key');
    }

    // Rate limit by API key
    const profile = rateLimitsConfig.webhook;
    const rateLimitKey = `ratelimit:webhook:${webhook.id}`;
    const result = await RateLimiterService.check(rateLimitKey, profile.windowMs, profile.max);

    res.setHeader('X-RateLimit-Limit', result.limit.toString());
    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    res.setHeader('X-RateLimit-Reset', result.resetTime.toISOString());

    if (!result.allowed) {
      await WebhookService.logAuthFailure(webhook.id, ip, userAgent, 'Rate limit exceeded');
      res.setHeader('Retry-After', Math.ceil((result.resetTime.getTime() - Date.now()) / 1000));
      return ResponseUtil.error(res, profile.message, 429);
    }

    req.webhook = webhook;
    next();
  } catch (error: any) {
    logger.error('Webhook authentication error', { error: error.message, ip });
    return ResponseUtil.error(res, 'Internal server error during authentication', 500);
  }
};
