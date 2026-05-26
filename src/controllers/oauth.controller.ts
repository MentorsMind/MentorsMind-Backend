import { Request, Response } from 'express';
import passport from '../config/passport';
import { env } from '../config/env';
import { TokenService } from '../services/token.service';
import { AuditLogService, extractIpAddress } from '../services/auditLog.service';
import { logger } from '../utils/logger';
import pool from '../config/database';

export const OAuthController = {
    /**
     * GET /api/v1/auth/google
     * Redirect to Google OAuth consent screen
     */
    async googleAuth(req: Request, res: Response): Promise<void> {
        passport.authenticate('google', {
            scope: ['profile', 'email'],
            session: false,
        })(req, res);
    },

    /**
     * GET /api/v1/auth/google/callback
     * Handle Google OAuth callback and issue JWT
     */
    async googleCallback(req: Request, res: Response): Promise<void> {
        passport.authenticate('google', { session: false }, async (err: any, user: any) => {
            if (err) {
                logger.error('Google OAuth callback error', { error: err.message });
                return res.redirect(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/error?provider=google`);
            }

            if (!user) {
                return res.redirect(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/error?provider=google`);
            }

            try {
                const userQuery = `SELECT email, role FROM users WHERE id = $1`;
                const userResult = await pool.query(userQuery, [user.userId]);
                
                if (userResult.rows.length === 0) {
                    return res.redirect(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/error?provider=google`);
                }

                const userData = userResult.rows[0];
                const tokens = await TokenService.issueTokens(user.userId, userData.email, userData.role);

                await AuditLogService.log({
                    userId: user.userId,
                    action: user.isNew ? 'USER_REGISTERED_OAUTH' : 'LOGIN_OAUTH',
                    resourceType: 'auth',
                    resourceId: user.userId,
                    ipAddress: extractIpAddress(req),
                    userAgent: req.headers['user-agent'] || null,
                    metadata: { provider: 'google', isNew: user.isNew },
                });

                const redirectUrl = new URL(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback`);
                redirectUrl.searchParams.set('access_token', tokens.accessToken);
                redirectUrl.searchParams.set('refresh_token', tokens.refreshToken);
                redirectUrl.searchParams.set('provider', 'google');

                return res.redirect(redirectUrl.toString());
            } catch (error) {
                logger.error('Error generating tokens after Google OAuth', { error });
                return res.redirect(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/error?provider=google`);
            }
        })(req, res);
    },

    /**
     * GET /api/v1/auth/github
     * Redirect to GitHub OAuth consent screen
     */
    async githubAuth(req: Request, res: Response): Promise<void> {
        passport.authenticate('github', {
            scope: ['user:email'],
            session: false,
        })(req, res);
    },

    /**
     * GET /api/v1/auth/github/callback
     * Handle GitHub OAuth callback and issue JWT
     */
    async githubCallback(req: Request, res: Response): Promise<void> {
        passport.authenticate('github', { session: false }, async (err: any, user: any) => {
            if (err) {
                logger.error('GitHub OAuth callback error', { error: err.message });
                return res.redirect(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/error?provider=github`);
            }

            if (!user) {
                return res.redirect(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/error?provider=github`);
            }

            try {
                const userQuery = `SELECT email, role FROM users WHERE id = $1`;
                const userResult = await pool.query(userQuery, [user.userId]);
                
                if (userResult.rows.length === 0) {
                    return res.redirect(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/error?provider=github`);
                }

                const userData = userResult.rows[0];
                const tokens = await TokenService.issueTokens(user.userId, userData.email, userData.role);

                await AuditLogService.log({
                    userId: user.userId,
                    action: user.isNew ? 'USER_REGISTERED_OAUTH' : 'LOGIN_OAUTH',
                    resourceType: 'auth',
                    resourceId: user.userId,
                    ipAddress: extractIpAddress(req),
                    userAgent: req.headers['user-agent'] || null,
                    metadata: { provider: 'github', isNew: user.isNew },
                });

                const redirectUrl = new URL(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback`);
                redirectUrl.searchParams.set('access_token', tokens.accessToken);
                redirectUrl.searchParams.set('refresh_token', tokens.refreshToken);
                redirectUrl.searchParams.set('provider', 'github');

                return res.redirect(redirectUrl.toString());
            } catch (error) {
                logger.error('Error generating tokens after GitHub OAuth', { error });
                return res.redirect(`${env.FRONTEND_URL || 'http://localhost:3000'}/auth/error?provider=github`);
            }
        })(req, res);
    },

    /**
     * DELETE /api/v1/auth/oauth/:provider
     * Unlink OAuth provider from user account
     */
    async unlinkProvider(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId;
            const provider = req.params.provider;

            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            if (!['google', 'github'].includes(provider)) {
                return res.status(400).json({ success: false, error: 'Invalid provider' });
            }

            // Check if user has a password (can't unlink if it's the only auth method)
            const userQuery = `SELECT password_hash FROM users WHERE id = $1`;
            const userResult = await require('../config/database').query(userQuery, [userId]);

            if (userResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }

            const user = userResult.rows[0];

            // Check if user has other OAuth accounts
            const oauthQuery = `SELECT COUNT(*) as count FROM oauth_accounts WHERE user_id = $1`;
            const oauthResult = await require('../config/database').query(oauthQuery, [userId]);
            const oauthCount = parseInt(oauthResult.rows[0].count);

            // If user has no password and only one OAuth account, prevent unlinking
            if (!user.password_hash && oauthCount <= 1) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot unlink the only authentication method. Please set a password first.'
                });
            }

            // Delete OAuth account
            const deleteQuery = `DELETE FROM oauth_accounts WHERE user_id = $1 AND provider = $2`;
            const deleteResult = await require('../config/database').query(deleteQuery, [userId, provider]);

            if (deleteResult.rowCount === 0) {
                return res.status(404).json({ success: false, error: 'OAuth account not found' });
            }

            // Log the unlink action
            await AuditLogService.log({
                userId,
                action: 'OAUTH_UNLINKED',
                resourceType: 'auth',
                resourceId: userId,
                ipAddress: extractIpAddress(req),
                userAgent: req.headers['user-agent'] || null,
                metadata: { provider },
            });

            return res.status(200).json({
                success: true,
                message: `${provider} account unlinked successfully`
            });
        } catch (error: any) {
            logger.error('Error unlinking OAuth provider', { error: error.message });
            return res.status(500).json({ success: false, error: 'Failed to unlink OAuth provider' });
        }
    },

    /**
     * GET /api/v1/auth/oauth/providers
     * Get list of linked OAuth providers for current user
     */
    async getLinkedProviders(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.userId;

            if (!userId) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const query = `
        SELECT provider, provider_email, provider_name, created_at 
        FROM oauth_accounts 
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;
            const result = await require('../config/database').query(query, [userId]);

            return res.status(200).json({
                success: true,
                data: result.rows
            });
        } catch (error: any) {
            logger.error('Error getting linked OAuth providers', { error: error.message });
            return res.status(500).json({ success: false, error: 'Failed to get linked providers' });
        }
    },
};
