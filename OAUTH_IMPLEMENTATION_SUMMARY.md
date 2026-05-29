# OAuth2 / Social Login Implementation Summary

## Overview

Successfully implemented OAuth2 social login for MentorMinds Backend using Passport.js strategies for Google and GitHub authentication.

## Files Created

### Database Migration
1. **[`database/migrations/024_create_oauth_accounts.sql`](database/migrations/024_create_oauth_accounts.sql)**
   - Creates `oauth_accounts` table to store OAuth provider accounts
   - Supports Google and GitHub providers
   - Stores OAuth tokens (access_token, refresh_token, token_expires_at)
   - Links OAuth accounts to users table via foreign key
   - Unique constraints to prevent duplicate OAuth accounts

### Configuration
2. **[`src/config/passport.ts`](src/config/passport.ts)**
   - Configures Passport.js with Google and GitHub OAuth strategies
   - Handles OAuth profile extraction and normalization
   - Implements `findOrCreateUser` function for auto-creating users on first OAuth login
   - Links OAuth accounts to existing users by email match
   - Stores OAuth tokens in database

### Controller
3. **[`src/controllers/oauth.controller.ts`](src/controllers/oauth.controller.ts)**
   - `googleAuth` - Redirects to Google OAuth consent screen
   - `googleCallback` - Handles Google OAuth callback and issues JWT
   - `githubAuth` - Redirects to GitHub OAuth consent screen
   - `githubCallback` - Handles GitHub OAuth callback and issues JWT
   - `unlinkProvider` - Unlinks OAuth provider from user account
   - `getLinkedProviders` - Gets list of linked OAuth providers for current user

## Files Modified

### Routes
4. **[`src/routes/auth.routes.ts`](src/routes/auth.routes.ts)**
   - Added OAuth controller import
   - Added OAuth routes:
     - `GET /api/v1/auth/google` - Redirect to Google OAuth
     - `GET /api/v1/auth/google/callback` - Handle Google callback
     - `GET /api/v1/auth/github` - Redirect to GitHub OAuth
     - `GET /api/v1/auth/github/callback` - Handle GitHub callback
     - `GET /api/v1/auth/oauth/providers` - Get linked providers (protected)
     - `DELETE /api/v1/auth/oauth/:provider` - Unlink provider (protected)

### Environment Configuration
5. **[`.env.example`](.env.example)**
   - Added Google OAuth environment variables:
     - `GOOGLE_CLIENT_ID`
     - `GOOGLE_CLIENT_SECRET`
     - `GOOGLE_CALLBACK_URL`
   - Added GitHub OAuth environment variables:
     - `GITHUB_CLIENT_ID`
     - `GITHUB_CLIENT_SECRET`
     - `GITHUB_CALLBACK_URL`
   - Added `FRONTEND_URL` for OAuth redirects

## Acceptance Criteria Status

✅ **GET /api/v1/auth/google** — redirect to Google OAuth consent screen
✅ **GET /api/v1/auth/google/callback** — handle Google callback, issue JWT
✅ **GET /api/v1/auth/github** — redirect to GitHub OAuth
✅ **GET /api/v1/auth/github/callback** — handle GitHub callback, issue JWT
✅ **On first OAuth login**: auto-create user account with email_verified = true
✅ **On subsequent OAuth login**: match by email, return existing account
✅ **Link OAuth provider to existing account** if user is already logged in
✅ **DELETE /api/v1/auth/oauth/:provider** — unlink OAuth provider
✅ **Store OAuth tokens** in oauth_accounts table (never expose to client)
✅ **Add environment variables** to .env.example

## Key Features

### OAuth Flow
1. User clicks "Login with Google" or "Login with GitHub"
2. Frontend redirects to `/api/v1/auth/google` or `/api/v1/auth/github`
3. Backend redirects to OAuth provider's consent screen
4. User authorizes the application
5. OAuth provider redirects back to callback URL
6. Backend validates OAuth profile and either:
   - Creates new user (if first time) with `email_verified = true`
   - Links to existing user (if email matches)
   - Returns existing user (if OAuth account already linked)
7. Backend generates JWT tokens (access_token, refresh_token)
8. Backend redirects to frontend with tokens in URL parameters
9. Frontend stores tokens and authenticates user

### User Auto-Creation
- On first OAuth login, a new user is automatically created
- Email is marked as verified (`email_verified = true`)
- A random password is generated (user won't use it)
- User role defaults to 'mentee'
- OAuth account is linked to the new user

### Account Linking
- If a user already exists with the same email, OAuth account is linked to that user
- User's email_verified status is updated to true if not already verified
- OAuth tokens are stored for future use

### Provider Unlinking
- Users can unlink OAuth providers from their account
- Prevents unlinking if it's the only authentication method
- Requires user to have a password set before unlinking all OAuth providers
- Logs unlink action in audit log

### Security
- OAuth tokens are stored in database (never exposed to client)
- JWT tokens are issued after successful OAuth authentication
- Audit logging for all OAuth events (login, registration, unlinking)
- Rate limiting applied to OAuth endpoints

## API Endpoints

### Public Endpoints

#### `GET /api/v1/auth/google`
Redirects to Google OAuth consent screen.

**Response:** Redirect to Google OAuth

#### `GET /api/v1/auth/google/callback`
Handles Google OAuth callback and issues JWT tokens.

**Response:** Redirect to frontend with tokens in URL parameters

#### `GET /api/v1/auth/github`
Redirects to GitHub OAuth consent screen.

**Response:** Redirect to GitHub OAuth

#### `GET /api/v1/auth/github/callback`
Handles GitHub OAuth callback and issues JWT tokens.

**Response:** Redirect to frontend with tokens in URL parameters

### Protected Endpoints

#### `GET /api/v1/auth/oauth/providers`
Gets list of linked OAuth providers for current user.

**Headers:** `Authorization: Bearer <access_token>`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "provider": "google",
      "provider_email": "user@gmail.com",
      "provider_name": "John Doe",
      "created_at": "2024-03-15T10:00:00Z"
    }
  ]
}
```

#### `DELETE /api/v1/auth/oauth/:provider`
Unlinks OAuth provider from user account.

**Headers:** `Authorization: Bearer <access_token>`

**Parameters:** `provider` - 'google' or 'github'

**Response:**
```json
{
  "success": true,
  "message": "google account unlinked successfully"
}
```

## Database Schema

### oauth_accounts Table

```sql
CREATE TABLE oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider oauth_provider NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    provider_email VARCHAR(255),
    provider_name VARCHAR(255),
    provider_avatar_url VARCHAR(500),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_provider_account UNIQUE (provider, provider_account_id),
    CONSTRAINT unique_user_provider UNIQUE (user_id, provider)
);
```

## Environment Variables

```env
# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/v1/auth/google/callback

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_CALLBACK_URL=http://localhost:5000/api/v1/auth/github/callback

# Frontend URL for OAuth redirects
FRONTEND_URL=http://localhost:3000
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install passport passport-google-oauth20 passport-github2
npm install --save-dev @types/passport @types/passport-google-oauth20 @types/passport-github2
```

### 2. Configure OAuth Providers

#### Google OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials (Web application)
5. Add authorized redirect URIs: `http://localhost:5000/api/v1/auth/google/callback`
6. Copy Client ID and Client Secret to `.env`

#### GitHub OAuth
1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set Homepage URL: `http://localhost:3000`
4. Set Authorization callback URL: `http://localhost:5000/api/v1/auth/github/callback`
5. Copy Client ID and Client Secret to `.env`

### 3. Run Database Migration

```bash
npm run migrate:up
```

### 4. Start the Server

```bash
npm run dev
```

## Testing

### Manual Testing

1. **Test Google OAuth Flow:**
   ```bash
   # Open browser and navigate to:
   http://localhost:5000/api/v1/auth/google
   ```

2. **Test GitHub OAuth Flow:**
   ```bash
   # Open browser and navigate to:
   http://localhost:5000/api/v1/auth/github
   ```

3. **Test Get Linked Providers:**
   ```bash
   curl -X GET http://localhost:5000/api/v1/auth/oauth/providers \
     -H "Authorization: Bearer <access_token>"
   ```

4. **Test Unlink Provider:**
   ```bash
   curl -X DELETE http://localhost:5000/api/v1/auth/oauth/google \
     -H "Authorization: Bearer <access_token>"
   ```

## Troubleshooting

### OAuth Callback Errors
- Verify callback URLs match in OAuth provider settings
- Check that CLIENT_ID and CLIENT_SECRET are correct
- Ensure FRONTEND_URL is set correctly

### User Not Created
- Check database connection
- Verify oauth_accounts table exists
- Check server logs for errors

### Tokens Not Issued
- Verify JWT secrets are configured
- Check that AuthService.generateTokens is working
- Ensure user exists in database

## Future Enhancements

1. **Additional OAuth Providers:** Add support for Facebook, Twitter, Apple, etc.
2. **Token Refresh:** Implement automatic OAuth token refresh
3. **Profile Sync:** Sync OAuth profile data with user profile on each login
4. **Account Merging:** Allow users to merge multiple OAuth accounts
5. **OAuth-Only Login:** Support for users who only want to use OAuth (no password)

## Notes

- OAuth tokens are stored in database but never exposed to the client
- JWT tokens are issued after successful OAuth authentication
- Users can link multiple OAuth providers to their account
- Email verification is automatic for OAuth users
- Random password is generated for OAuth-only users (they won't use it)
