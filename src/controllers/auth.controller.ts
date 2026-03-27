import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { UsersService } from '../services/users.service';
import {
    registerSchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    refreshTokenSchema
} from '../validators/auth.validator';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { ZodError } from 'zod';
import { AuditLogService, extractIpAddress } from '../services/auditLog.service';

export const AuthController = {
    async register(req: Request, res: Response) {
        try {
            const validatedData = registerSchema.parse(req).body;
            const result = await AuthService.register(validatedData);
            
            // Log registration
            await AuditLogService.log({
                userId: result.userId || null,
                action: 'USER_REGISTERED',
                resourceType: 'auth',
                resourceId: result.userId || null,
                ipAddress: extractIpAddress(req),
                userAgent: req.headers['user-agent'] || null,
                metadata: { email: validatedData.email, role: validatedData.role },
            });
            
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            if (error instanceof ZodError) {
                return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
            }
            return res.status(400).json({ success: false, error: error.message });
        }
    },

    async login(req: Request, res: Response) {
        try {
            const validatedData = loginSchema.parse(req).body;
            const result = await AuthService.login(validatedData);
            
            // Log successful login
            await AuditLogService.log({
                userId: result.userId,
                action: 'LOGIN_SUCCESS',
                resourceType: 'auth',
                resourceId: result.userId,
                ipAddress: extractIpAddress(req),
                userAgent: req.headers['user-agent'] || null,
                metadata: { email: validatedData.email },
            });
            
            return res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            // Log failed login attempt
            const validatedData = loginSchema.safeParse(req);
            if (validatedData.success) {
                await AuditLogService.log({
                    userId: null,
                    action: 'LOGIN_FAILED',
                    resourceType: 'auth',
                    ipAddress: extractIpAddress(req),
                    userAgent: req.headers['user-agent'] || null,
                    metadata: { 
                        email: validatedData.data.body.email,
                        reason: error.message 
                    },
                });
            }
            
            if (error instanceof ZodError) {
                return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
            }
            if (error.message.includes('Invalid email or password')) {
                return res.status(401).json({ success: false, error: error.message });
            }
            return res.status(400).json({ success: false, error: error.message });
        }
    },

    async logout(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (userId) {
                await AuthService.logout(userId);
                
                // Log logout
                await AuditLogService.log({
                    userId,
                    action: 'LOGOUT',
                    resourceType: 'auth',
                    resourceId: userId,
                    ipAddress: extractIpAddress(req),
                    userAgent: req.headers['user-agent'] || null,
                });
            }
            return res.status(200).json({ success: true, message: 'Logged out successfully.' });
        } catch (error: any) {
            return res.status(500).json({ success: false, error: error.message });
        }
    },

    async refresh(req: Request, res: Response) {
        try {
            const validatedData = refreshTokenSchema.parse(req).body;
            const result = await AuthService.refresh(validatedData.refreshToken);
            return res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            if (error instanceof ZodError) {
                return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
            }
            return res.status(401).json({ success: false, error: error.message });
        }
    },

    async forgotPassword(req: Request, res: Response) {
        try {
            const validatedData = forgotPasswordSchema.parse(req).body;
            const token = await AuthService.forgotPassword(validatedData.email);
            // We return the token for testing purposes, but in production this should omit the token 
            // and only rely on the email service to dispatch the reset link.
            return res.status(200).json({
                success: true,
                message: 'If the email exists, a reset link has been generated.',
                data: { token }
            });
        } catch (error: any) {
            if (error instanceof ZodError) {
                return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
            }
            return res.status(400).json({ success: false, error: error.message });
        }
    },

    async resetPassword(req: Request, res: Response) {
        try {
            const validatedData = resetPasswordSchema.parse(req).body;
            const userId = await AuthService.resetPassword(validatedData);
            
            // Log password change
            if (userId) {
                await AuditLogService.log({
                    userId,
                    action: 'PASSWORD_CHANGED',
                    resourceType: 'auth',
                    resourceId: userId,
                    ipAddress: extractIpAddress(req),
                    userAgent: req.headers['user-agent'] || null,
                    metadata: { method: 'reset_token' },
                });
            }
            
            return res.status(200).json({ success: true, message: 'Password reset successfully. You can now login with your new password.' });
        } catch (error: any) {
            if (error instanceof ZodError) {
                return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
            }
            return res.status(400).json({ success: false, error: error.message });
        }
    },

    async getMe(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const user = await UsersService.findPublicById(userId);
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found.' });
            }

            return res.status(200).json({ success: true, data: user });
        } catch (error: any) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }
};
