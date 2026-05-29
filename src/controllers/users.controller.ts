import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { UsersService } from '../services/users.service';
import { ResponseUtil } from '../utils/response.utils';
import { AuditLogService, extractIpAddress } from '../services/auditLog.service';
import { accountDeletionService } from '../services/accountDeletion.service';

function getAuthenticatedUserId(req: AuthenticatedRequest): string {
  return (req.user as any)?.id ?? (req.user as any)?.userId;
}

export const UsersController = {
  /** GET /users/:id */
  async getUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = await UsersService.findById(req.params.id as string);
    if (!user) {
      ResponseUtil.notFound(res, 'User not found');
      return;
    }
    ResponseUtil.success(res, user, 'User retrieved successfully');
  },

  /** PUT /users/:id */
  async updateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const {
      firstName,
      lastName,
      bio,
      phoneNumber,
      dateOfBirth,
      governmentIdNumber,
      bankAccountDetails,
    } = req.body;
    const userId = req.params.id as string;
    
    // Get old values for audit
    const oldUser = await UsersService.findById(userId);
    
    const updated = await UsersService.update(userId, {
      firstName,
      lastName,
      bio,
      phoneNumber,
      dateOfBirth,
      governmentIdNumber,
      bankAccountDetails,
    });
    if (!updated) {
      ResponseUtil.notFound(res, 'User not found');
      return;
    }
    
    // Log profile update
    await AuditLogService.log({
      userId: getAuthenticatedUserId(req),
      action: 'PROFILE_UPDATED',
      resourceType: 'user',
      resourceId: userId,
      oldValue: oldUser ? { 
        first_name: oldUser.first_name, 
        last_name: oldUser.last_name, 
        bio: oldUser.bio 
      } : null,
      newValue: { 
        first_name: updated.first_name, 
        last_name: updated.last_name, 
        bio: updated.bio 
      },
      ipAddress: extractIpAddress(req),
      userAgent: req.headers['user-agent'] || null,
    });
    
    ResponseUtil.success(res, updated, 'User updated successfully');
  },

  /** DELETE /users/:id */
  async deleteUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.params.id as string;
    const deleted = await UsersService.deactivate(userId);
    if (!deleted) {
      ResponseUtil.notFound(res, 'User not found');
      return;
    }
    
    // Log user deactivation
    await AuditLogService.log({
      userId: req.user!.id,
      action: 'USER_DEACTIVATED',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: extractIpAddress(req),
      userAgent: req.headers['user-agent'] || null,
    });
    
    ResponseUtil.noContent(res);
  },

  /** GET /users/me */
  async getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = await UsersService.findById(getAuthenticatedUserId(req));
    if (!user) {
      ResponseUtil.notFound(res, 'User not found');
      return;
    }
    ResponseUtil.success(res, user, 'Profile retrieved successfully');
  },

  /** PUT /users/me */
  async updateMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    const {
      firstName,
      lastName,
      bio,
      phoneNumber,
      dateOfBirth,
      governmentIdNumber,
      bankAccountDetails,
    } = req.body;
    const userId = getAuthenticatedUserId(req);
    
    // Get old values for audit
    const oldUser = await UsersService.findById(userId);
    
    const updated = await UsersService.update(userId, {
      firstName,
      lastName,
      bio,
      phoneNumber,
      dateOfBirth,
      governmentIdNumber,
      bankAccountDetails,
    });
    if (!updated) {
      ResponseUtil.notFound(res, 'User not found');
      return;
    }
    
    // Log profile update
    await AuditLogService.log({
      userId,
      action: 'PROFILE_UPDATED',
      resourceType: 'user',
      resourceId: userId,
      oldValue: oldUser ? { 
        first_name: oldUser.first_name, 
        last_name: oldUser.last_name, 
        bio: oldUser.bio 
      } : null,
      newValue: { 
        first_name: updated.first_name, 
        last_name: updated.last_name, 
        bio: updated.bio 
      },
      ipAddress: extractIpAddress(req),
      userAgent: req.headers['user-agent'] || null,
    });
    
    ResponseUtil.success(res, updated, 'Profile updated successfully');
  },

  /** POST /users/avatar */
  async uploadAvatar(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { avatarBase64 } = req.body;
    // Derive a stable key for storage (e.g. future S3 integration uses this as the object key)
    const avatarUrl = avatarBase64; // placeholder: replace with URL after uploading to storage
    const updated = await UsersService.updateAvatar(getAuthenticatedUserId(req), avatarUrl);
    if (!updated) {
      ResponseUtil.notFound(res, 'User not found');
      return;
    }
    ResponseUtil.success(res, { avatarUrl: updated.avatar_url }, 'Avatar updated successfully');
  },

  /** GET /users/:id/public */
  async getPublicUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = await UsersService.findPublicById(req.params.id as string);
    if (!user) {
      ResponseUtil.notFound(res, 'User not found');
      return;
    }
    ResponseUtil.success(res, user, 'Public profile retrieved successfully');
  },

  /** DELETE /users/me */
  async requestAccountDeletion(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    const deletionRequest = await accountDeletionService.requestDeletion(userId);

    ResponseUtil.success(
      res,
      deletionRequest,
      'Account deletion scheduled. Your account can be restored within 30 days.',
    );
  },

  /** POST /users/me/cancel-deletion */
  async cancelAccountDeletion(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    const result = await accountDeletionService.cancelDeletion(userId);
    if (!result) {
      ResponseUtil.notFound(res, 'No pending deletion request found');
      return;
    }

    ResponseUtil.success(res, result, 'Account deletion request cancelled');
  },
};
