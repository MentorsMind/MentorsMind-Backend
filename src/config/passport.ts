import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy, Profile as GitHubProfile } from 'passport-github2';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import pool from './database';
import oauthConfig from './oauth.config';
import { Logger } from "../utils/logger.utils";
import { EncryptionUtil } from '../utils/encryption.utils';
const fetch = require('node-fetch');

// Custom error type for OAuth email required
export class EmailRequiredError extends Error {
    constructor() {
        super('Email required');
        this.name = 'EmailRequiredError';
    }
}

// Types for OAuth profile
interface OAuthProfile {
    id: string;
    email: string | undefined;
    name: string | undefined;
    avatarUrl: string | undefined;
    provider: 'google' | 'github' | 'linkedin' | 'microsoft';
}

// Minimal shape for LinkedIn OpenID Connect userinfo response
interface LinkedInUserInfo {
    sub: string;
    email?: string;
    name?: string;
    picture?: string;
}

// Minimal shape for Microsoft Graph /me response
interface MicrosoftUserInfo {
    id: string;
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
}

// Type for GitHub email API response
interface GitHubEmail {
    email: string;
    verified: boolean;
    primary: boolean;
    visibility: string | null;
}

// Helper function to extract profile data
function extractGoogleProfile(profile: GoogleProfile): OAuthProfile {
    return {
        id: profile.id,
        email: profile.emails?.[0]?.value,
        name: profile.displayName,
        avatarUrl: profile.photos?.[0]?.value,
        provider: 'google',
    };
}

async function extractGitHubProfileWithEmail(profile: GitHubProfile, accessToken: string): Promise<OAuthProfile> {
    let email = profile.emails?.[0]?.value;

    // If no email in profile, fetch from GitHub API
    if (!email) {
        try {
            const response = await fetch('https://api.github.com/user/emails', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': 'mentorsmind-backend',
                },
            });
            if (!response.ok) {
                logger.error('Failed to fetch GitHub emails', { status: response.status, statusText: response.statusText });
            } else {
                const emails: GitHubEmail[] = await response.json();
                // Find primary verified email
                const verifiedEmail = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified);
                if (verifiedEmail) {
                    email = verifiedEmail.email;
                }
            }
        } catch (error) {
            logger.error('Error fetching GitHub emails', { error });
        }
    }

    return {
        id: profile.id,
        email,
        name: profile.displayName || profile.username,
        avatarUrl: profile.photos?.[0]?.value,
        provider: 'github',
    };
}

// Fetch LinkedIn userinfo (OpenID Connect) and build a shared OAuthProfile
async function extractLinkedInProfile(accessToken: string): Promise<OAuthProfile> {
    const response = await fetch(oauthConfig.linkedin.userInfoURL, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        logger.error('Failed to fetch LinkedIn userinfo', { status: response.status, statusText: response.statusText });
        throw new Error('Failed to fetch LinkedIn profile');
    }

    const userInfo: LinkedInUserInfo = await response.json();

    return {
        id: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        avatarUrl: userInfo.picture,
        provider: 'linkedin',
    };
}

// Fetch Microsoft Graph /me and build a shared OAuthProfile
async function extractMicrosoftProfile(accessToken: string): Promise<OAuthProfile> {
    const response = await fetch(oauthConfig.microsoft.userInfoURL, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        logger.error('Failed to fetch Microsoft profile', { status: response.status, statusText: response.statusText });
        throw new Error('Failed to fetch Microsoft profile');
    }

    const userInfo: MicrosoftUserInfo = await response.json();

    return {
        id: userInfo.id,
        email: userInfo.mail || userInfo.userPrincipalName,
        name: userInfo.displayName,
        avatarUrl: undefined,
        provider: 'microsoft',
    };
}

// Helper function to find or create user from OAuth profile
async function findOrCreateUser(profile: OAuthProfile): Promise<{ userId: string; isNew: boolean }> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Check if OAuth account already exists
        const oauthQuery = `
      SELECT user_id FROM oauth_accounts 
      WHERE provider = $1 AND provider_account_id = $2
    `;
        const oauthResult = await client.query(oauthQuery, [profile.provider, profile.id]);

        if (oauthResult.rows.length > 0) {
            // OAuth account exists, return existing user
            await client.query('COMMIT');
            return { userId: oauthResult.rows[0].user_id, isNew: false };
        }

        // If no email, throw EmailRequiredError
        if (!profile.email) {
            await client.query('ROLLBACK');
            throw new EmailRequiredError();
        }

        // Check if user exists by email (if email is provided)
        const userQuery = `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`;
        const userResult = await client.query(userQuery, [profile.email]);

        if (userResult.rows.length > 0) {
            // User exists, link OAuth account
            const userId = userResult.rows[0].id;

            const insertOAuthQuery = `
          INSERT INTO oauth_accounts (user_id, provider, provider_account_id, provider_email, provider_name, provider_avatar_url)
          VALUES ($1, $2, $3, $4, $5, $6)
        `;
            await client.query(insertOAuthQuery, [
                userId,
                profile.provider,
                profile.id,
                profile.email,
                profile.name,
                profile.avatarUrl,
            ]);

            // Update user's email_verified status if not already verified
            await client.query(
                `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1 AND email_verified = false`,
                [userId]
            );

            await client.query('COMMIT');
            logger.info(`Linked ${profile.provider} OAuth account to existing user`, { userId, provider: profile.provider });
            return { userId, isNew: false };
        }

        // Create new user
        const insertUserQuery = `
      INSERT INTO users (email, password_hash, first_name, last_name, email_verified, email_verified_at, role)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;

        // Generate a random password hash (user won't use this)
        const bcrypt = require('bcryptjs');
        const randomPassword = require('crypto').randomBytes(32).toString('hex');
        const passwordHash = await bcrypt.hash(randomPassword, 10);

        // Split name into first and last name
        const nameParts = (profile.name || '').split(' ');
        const firstName = nameParts[0] || 'User';
        const lastName = nameParts.slice(1).join(' ') || '';

        const newUserResult = await client.query(insertUserQuery, [
            profile.email,
            passwordHash,
            firstName,
            lastName,
            true, // email_verified
            new Date(), // email_verified_at
            'mentee', // default role
        ]);

        const userId = newUserResult.rows[0].id;

        // Create OAuth account
        const insertOAuthQuery = `
      INSERT INTO oauth_accounts (user_id, provider, provider_account_id, provider_email, provider_name, provider_avatar_url)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
        await client.query(insertOAuthQuery, [
            userId,
            profile.provider,
            profile.id,
            profile.email,
            profile.name,
            profile.avatarUrl,
        ]);

        await client.query('COMMIT');
        logger.info(`Created new user from ${profile.provider} OAuth`, { userId, provider: profile.provider });
        return { userId, isNew: true };

    } catch (error) {
        // Don't rollback twice if already rolled back
        if (!(error instanceof EmailRequiredError)) {
            await client.query('ROLLBACK');
        }
        logger.error('Error in findOrCreateUser', { error, provider: profile.provider });
        throw error;
    } finally {
        client.release();
    }
}

// Configure Google OAuth strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/v1/auth/google/callback',
                scope: ['profile', 'email'],
            },
            async (accessToken: string, refreshToken: string, profile: GoogleProfile, done: any) => {
                try {
                    const oauthProfile = extractGoogleProfile(profile);
                    // Google should always provide an email, check and throw error if not
                    if (!oauthProfile.email) {
                        throw new EmailRequiredError();
                    }
                    const result = await findOrCreateUser(oauthProfile);

                    // Store tokens in oauth_accounts table (encrypted at rest)
                    if (accessToken || refreshToken) {
                        const [encAccess, encRefresh, version] = await Promise.all([
                            EncryptionUtil.encrypt(accessToken),
                            EncryptionUtil.encrypt(refreshToken),
                            EncryptionUtil.getCurrentKeyVersion(),
                        ]);

                        await pool.query(
                            `UPDATE oauth_accounts 
               SET access_token = $1, refresh_token = $2, access_token_encrypted = $3, refresh_token_encrypted = $4, token_encryption_version = $5, token_expires_at = $6, updated_at = NOW()
               WHERE provider = $7 AND provider_account_id = $8`,
                            [accessToken, refreshToken, encAccess, encRefresh, version, profile._json?.exp ? new Date(profile._json.exp * 1000) : null, 'google', profile.id]
                        );
                    }

                    return done(null, { userId: result.userId, isNew: result.isNew });
                } catch (error) {
                    return done(error, null);
                }
            }
        )
    );
    logger.info('Google OAuth strategy configured');
} else {
    logger.warn('Google OAuth credentials not configured');
}

// Configure GitHub OAuth strategy
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(
        new GitHubStrategy(
            {
                clientID: process.env.GITHUB_CLIENT_ID,
                clientSecret: process.env.GITHUB_CLIENT_SECRET,
                callbackURL: process.env.GITHUB_CALLBACK_URL || '/api/v1/auth/github/callback',
                scope: ['user:email'],
            },
            async (accessToken: string, refreshToken: string, profile: GitHubProfile, done: any) => {
                try {
                    const oauthProfile = await extractGitHubProfileWithEmail(profile, accessToken);
                    const result = await findOrCreateUser(oauthProfile);

                    // Store tokens in oauth_accounts table (encrypted at rest)
                    if (accessToken || refreshToken) {
                        const [encAccess, encRefresh, version] = await Promise.all([
                            EncryptionUtil.encrypt(accessToken),
                            EncryptionUtil.encrypt(refreshToken),
                            EncryptionUtil.getCurrentKeyVersion(),
                        ]);

                        await pool.query(
                            `UPDATE oauth_accounts 
               SET access_token = $1, refresh_token = $2, access_token_encrypted = $3, refresh_token_encrypted = $4, token_encryption_version = $5, updated_at = NOW()
               WHERE provider = $6 AND provider_account_id = $7`,
                            [accessToken, refreshToken, encAccess, encRefresh, version, 'github', profile.id]
                        );
                    }

                    return done(null, { userId: result.userId, isNew: result.isNew });
                } catch (error) {
                    return done(error, null);
                }
            }
        )
    );
    logger.info('GitHub OAuth strategy configured');
} else {
    logger.warn('GitHub OAuth credentials not configured');
}

// Configure LinkedIn OAuth strategy (OpenID Connect via generic OAuth2Strategy)
if (oauthConfig.linkedin.enabled) {
    passport.use(
        'linkedin',
        new OAuth2Strategy(
            {
                authorizationURL: oauthConfig.linkedin.authorizationURL as string,
                tokenURL: oauthConfig.linkedin.tokenURL as string,
                clientID: oauthConfig.linkedin.clientId as string,
                clientSecret: oauthConfig.linkedin.clientSecret as string,
                callbackURL: oauthConfig.linkedin.callbackURL,
                scope: oauthConfig.linkedin.scopes,
            },
            async (accessToken: string, refreshToken: string, _profile: any, done: any) => {
                try {
                    const oauthProfile = await extractLinkedInProfile(accessToken);
                    if (!oauthProfile.email) {
                        throw new EmailRequiredError();
                    }
                    const result = await findOrCreateUser(oauthProfile);

                    if (accessToken || refreshToken) {
                        const [encAccess, encRefresh, version] = await Promise.all([
                            EncryptionUtil.encrypt(accessToken),
                            EncryptionUtil.encrypt(refreshToken),
                            EncryptionUtil.getCurrentKeyVersion(),
                        ]);

                        await pool.query(
                            `UPDATE oauth_accounts
               SET access_token = $1, refresh_token = $2, access_token_encrypted = $3, refresh_token_encrypted = $4, token_encryption_version = $5, updated_at = NOW()
               WHERE provider = $6 AND provider_account_id = $7`,
                            [accessToken, refreshToken, encAccess, encRefresh, version, 'linkedin', oauthProfile.id]
                        );
                    }

                    return done(null, { userId: result.userId, isNew: result.isNew });
                } catch (error) {
                    return done(error, null);
                }
            }
        )
    );
    logger.info('LinkedIn OAuth strategy configured');
} else {
    logger.warn('LinkedIn OAuth credentials not configured');
}

// Configure Microsoft OAuth strategy (Azure AD v2 via generic OAuth2Strategy)
if (oauthConfig.microsoft.enabled) {
    passport.use(
        'microsoft',
        new OAuth2Strategy(
            {
                authorizationURL: oauthConfig.microsoft.authorizationURL as string,
                tokenURL: oauthConfig.microsoft.tokenURL as string,
                clientID: oauthConfig.microsoft.clientId as string,
                clientSecret: oauthConfig.microsoft.clientSecret as string,
                callbackURL: oauthConfig.microsoft.callbackURL,
                scope: oauthConfig.microsoft.scopes,
            },
            async (accessToken: string, refreshToken: string, _profile: any, done: any) => {
                try {
                    const oauthProfile = await extractMicrosoftProfile(accessToken);
                    if (!oauthProfile.email) {
                        throw new EmailRequiredError();
                    }
                    const result = await findOrCreateUser(oauthProfile);

                    if (accessToken || refreshToken) {
                        const [encAccess, encRefresh, version] = await Promise.all([
                            EncryptionUtil.encrypt(accessToken),
                            EncryptionUtil.encrypt(refreshToken),
                            EncryptionUtil.getCurrentKeyVersion(),
                        ]);

                        await pool.query(
                            `UPDATE oauth_accounts
               SET access_token = $1, refresh_token = $2, access_token_encrypted = $3, refresh_token_encrypted = $4, token_encryption_version = $5, updated_at = NOW()
               WHERE provider = $6 AND provider_account_id = $7`,
                            [accessToken, refreshToken, encAccess, encRefresh, version, 'microsoft', oauthProfile.id]
                        );
                    }

                    return done(null, { userId: result.userId, isNew: result.isNew });
                } catch (error) {
                    return done(error, null);
                }
            }
        )
    );
    logger.info('Microsoft OAuth strategy configured');
} else {
    logger.warn('Microsoft OAuth credentials not configured');
}

// Serialize user for session (not used in JWT-based auth, but required by Passport)
passport.serializeUser((user: any, done: any) => {
    done(null, user);
});

passport.deserializeUser((user: any, done: any) => {
    done(null, user);
});

export default passport;
