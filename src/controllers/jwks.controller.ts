import { Request, Response } from 'express';
import { JwksService } from '../services/jwks.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AuditLogService, extractIpAddress } from '../services/auditLog.service';
import { ResponseUtil } from '../utils/response.utils';

export const JwksController = {
  /**
   * GET /.well-known/jwks.json
   * Public endpoint — returns the active public key set.
   * Cache-Control is set so CDNs/clients can cache it briefly.
   */
  async getJwks(_req: Request, res: Response): Promise<void> {
    const jwks = await JwksService.getJwksDocument();
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5-minute CDN cache
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(jwks);
  },

  /**
   * POST /admin/auth/rotate-keys
   * Admin-only — rotates the signing key pair.
   * Current key becomes previous (valid 24 h); a new key pair is generated.
   */
  async rotateKeys(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await JwksService.rotateKeys();

    await AuditLogService.log({
      userId: req.user?.userId ?? null,
      action: 'JWT_KEY_ROTATED',
      resourceType: 'auth',
      ipAddress: extractIpAddress(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { newKid: result.newKid, previousKid: result.previousKid },
    });

    ResponseUtil.success(res, {
      newKid: result.newKid,
      previousKid: result.previousKid,
      message: 'Key rotation complete. Previous key valid for 24 hours.',
    }, 'JWT keys rotated successfully');
  },
};
