import { Request, Response, NextFunction } from 'express';
import { FeatureFlagService } from '../services/feature-flag.service';
import { logger } from '../utils/logger.utils';

export interface FeatureFlagRequest extends Request {
  featureFlags?: Record<string, boolean>;
  getFlag?: (key: string) => boolean;
}

/**
 * Middleware that pre-evaluates a list of feature flags for the authenticated user
 * and attaches results to req.featureFlags.
 *
 * Usage:
 *   router.get('/some-route', authenticate, withFeatureFlags(['new-ui', 'beta-pricing']), handler);
 *
 * In handler:
 *   if (req.featureFlags?.['new-ui']) { ... }
 *   // or
 *   if (req.getFlag?.('new-ui')) { ... }
 */
export function withFeatureFlags(flagKeys: string[]) {
  return async (req: FeatureFlagRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as Request & { user?: { userId: string } }).user?.userId;
      if (!userId) {
        req.featureFlags = Object.fromEntries(flagKeys.map((k) => [k, false]));
        req.getFlag = () => false;
        return next();
      }

      const context = {
        tenantId: (req.headers['x-tenant-id'] as string) || undefined,
        segment: (req.headers['x-user-segment'] as string) || undefined,
      };

      const results = await Promise.all(
        flagKeys.map((key) =>
          FeatureFlagService.isEnabled(key, userId, context).then((enabled) => [key, enabled] as const),
        ),
      );

      req.featureFlags = Object.fromEntries(results);
      req.getFlag = (key: string) => req.featureFlags?.[key] ?? false;
    } catch (err) {
      logger.error({ err }, 'withFeatureFlags middleware error');
      // Fail-safe: all flags off
      req.featureFlags = Object.fromEntries(flagKeys.map((k) => [k, false]));
      req.getFlag = () => false;
    }
    next();
  };
}
