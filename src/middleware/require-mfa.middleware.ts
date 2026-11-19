import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { AdminService } from '../services/admin.service';

export const requireMfa = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
    return;
  }

  if (user.role !== 'admin') {
    next();
    return;
  }

  const result = await AdminService.requireAdminMfa(user.id, user.role);
  if (!result.allowed) {
    res.status(403).json({
      success: false,
      error: result.error || 'Admin MFA required',
      mfaRequired: true,
    });
    return;
  }

  next();
};

export const requireAdminMfa = requireMfa;
