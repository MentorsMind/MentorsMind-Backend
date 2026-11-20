import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { ResponseUtil } from '../utils/response.utils';

/**
 * Require one of the specified roles.
 */
export const requireRole = (...roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      ResponseUtil.unauthorized(res, 'Authentication required');
      return;
    }
    if (!roles.includes(req.user.role)) {
      ResponseUtil.forbidden(res, 'Insufficient permissions');
      return;
    }
    next();
  };
};

/**
 * Allow access only if the authenticated user owns the resource or has the admin role.
 * The route must specify how to resolve the resource owner's user ID.
 */
export const requireOwnerOrAdmin = (
  getOwnerId: (req: AuthenticatedRequest) => string | undefined
) => {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.user) {
      ResponseUtil.unauthorized(res, 'Authentication required');
      return;
    }
    if (req.user.role === 'admin') {
      next();
      return;
    }
    const ownerId = getOwnerId(req);
    if (typeof ownerId === 'string' && req.user.id === ownerId) {
      next();
      return;
    }
    ResponseUtil.forbidden(res, 'Access denied');
  };
};

/**
 * Require admin role.
 */
export const requireAdmin = requireRole('admin');
