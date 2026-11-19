import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { AdminService } from '../services/admin.service';

const getCodeFromRequest = (req: AuthenticatedRequest): string | null => {
  const header = req.headers['x-mfa-code'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim();
  const bodyCode = (req.body as Record<string, unknown> | undefined)?.mfaCode;
  if (typeof bodyCode === 'string' && bodyCode.trim()) return bodyCode.trim();
  const bodyToken = (req.body as Record<string, unknown> | undefined)?.code;
  if (typeof bodyToken === 'string' && bodyToken.trim()) return bodyToken.trim();
  return null;
};

export const stepUpAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const user = req.user;
  if (!user || user.role !== 'admin') {
    next();
    return;
  }

  if (user.mfaVerified) {
    next();
    return;
  }

  const code = getCodeFromRequest(req);
  if (!code) {
    res.status(428).json({
      success: false,
      error: 'Step-up MFA required for this sensitive admin operation.',
      mfaRequired: true,
      errorCode: 'STEP_UP_MFA_REQUIRED',
    });
    return;
  }

  const result = await AdminService.verifyStepUpCode(user.id, code, req.ip);
  if (!result.valid) {
    res.status(result.locked ? 429 : 401).json({
      success: false,
      error: result.error || 'Invalid step-up MFA code',
      mfaRequired: true,
      attemptsRemaining: result.attemptsRemaining,
      errorCode: result.locked ? 'STEP_UP_MFA_LOCKED' : 'STEP_UP_MFA_INVALID',
    });
    return;
  }

  req.user = {
    ...user,
    mfaVerified: true,
  };

  next();
};

export const requireStepUpAuth = stepUpAuth;
