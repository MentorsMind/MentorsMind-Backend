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
 * Allow access only if the authenticated user owns the resource (matching :id param)
 * or has the admin role.
 */
export const requireOwnerOrAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    ResponseUtil.unauthorized(res, 'Authentication required');
    return;
  }
  const resourceId = req.params.id;
  if (req.user.role === 'admin' || req.user.id === resourceId) {
    next();
    return;
  }
  ResponseUtil.forbidden(res, 'Access denied');
};

/**
 * Require admin role.
 */
export const requireAdmin = requireRole('admin');
