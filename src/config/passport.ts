import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy, Profile as GitHubProfile } from 'passport-github2';
import pool from './database';
import { logger } from '../utils/logger';
import { EncryptionUtil } from '../utils/encryption.utils';

// Types for OAuth profile
interface OAuthProfile {
    id: string;
    email: string | undefined;
    name: string | undefined;
    avatarUrl: string | undefined;
    provider: 'google' | 'github';
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

function extractGitHubProfile(profile: GitHubProfile): OAuthProfile {
    return {
        id: profile.id,
        email: profile.emails?.[0]?.value,
        name: profile.displayName || profile.username,
        avatarUrl: profile.photos?.[0]?.value,
        provider: 'github',
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

        // Check if user exists by email (if email is provided)
        if (profile.email) {
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

        const userResult = await client.query(insertUserQuery, [
            profile.email || `${profile.provider}_${profile.id}@placeholder.com`,
            passwordHash,
            firstName,
            lastName,
            true, // email_verified
            new Date(), // email_verified_at
            'mentee', // default role
        ]);

        const userId = userResult.rows[0].id;

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
        await client.query('ROLLBACK');
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
                    const oauthProfile = extractGitHubProfile(profile);
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

// Serialize user for session (not used in JWT-based auth, but required by Passport)
passport.serializeUser((user: any, done: any) => {
    done(null, user);
});

passport.deserializeUser((user: any, done: any) => {
    done(null, user);
});

export default passport;
