# Security

## JWT Key Rotation

MentorMinds uses **RSA-256 (asymmetric)** signing for access tokens, enabling
zero-downtime key rotation and a public JWKS endpoint for third-party
verification.

### Architecture

| Concept | Detail |
|---|---|
| Algorithm | RS256 (RSA-256) |
| Key size | 2048-bit RSA |
| Key storage | Redis (`jwks:current`, `jwks:previous`) with in-memory fallback |
| Active slots | `current` (signing) + `previous` (verification only, 24 h window) |
| `kid` claim | Included in every JWT header for O(1) key lookup |
| Refresh tokens | Still HMAC-256 — opaque rotation tokens, not third-party verified |

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/.well-known/jwks.json` | Public | Returns active public keys as a JWKS document |
| `POST` | `/api/v1/admin/auth/rotate-keys` | Admin JWT | Rotates the signing key pair |

### JWKS Document

```
GET /api/v1/.well-known/jwks.json
```

Returns a standard [RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517)
JSON Web Key Set. Both the current and previous public keys are included during
the 24-hour rotation window so clients can verify tokens signed with either key.

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "<uuid>",
      "n": "<base64url modulus>",
      "e": "AQAB"
    }
  ]
}
```

The response carries `Cache-Control: public, max-age=300` so CDNs and API
clients can cache it for up to 5 minutes.

### Rotation Procedure

1. **Trigger rotation** (admin only):

   ```
   POST /api/v1/admin/auth/rotate-keys
   Authorization: Bearer <admin-token>
   ```

   Response:
   ```json
   {
     "success": true,
     "data": {
       "newKid": "<new-uuid>",
       "previousKid": "<old-uuid>",
       "message": "Key rotation complete. Previous key valid for 24 hours."
     }
   }
   ```

2. **What happens internally**:
   - The current key pair is stamped with `rotatedAt` and moved to the
     `previous` slot in Redis.
   - A new RSA-2048 key pair is generated and stored as `current`.
   - All new tokens are signed with the new key.
   - Tokens signed with the previous key remain valid for **24 hours**.

3. **After 24 hours**:
   - The previous key is no longer included in the JWKS document.
   - Tokens carrying the old `kid` are rejected with `401 Signing key has
     expired`.
   - Users with old tokens must log in again to receive a new token.

4. **Audit log**: Every rotation is recorded in the audit log with action
   `JWT_KEY_ROTATED`, including the admin's user ID, IP address, and both
   `newKid` / `previousKid` values.

### Key Storage

Keys are stored as JSON in Redis under the keys `jwks:current` and
`jwks:previous`. The previous key has a 25-hour TTL (24 h validity + 1 h
grace). If Redis is unavailable the service falls back to in-memory storage —
note that in-memory keys are lost on restart, so Redis is strongly recommended
for production.

For production deployments using AWS Secrets Manager or HashiCorp Vault, the
RSA private keys are stored in the secrets manager and loaded at startup via
`src/config/secrets.ts`. Set `SECRETS_PROVIDER=aws` or `SECRETS_PROVIDER=vault`
and configure the corresponding environment variables (see `.env.example`).

### Recommended Rotation Schedule

- **Routine**: every 90 days
- **Incident response** (suspected key compromise): immediately
- **After a security audit finding**: within 24 hours

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SECRETS_PROVIDER` | No (default: `env`) | `env` \| `aws` \| `vault` |
| `REDIS_URL` | Recommended | Redis connection URL for distributed key storage |
| `AWS_SECRET_ID` | If `SECRETS_PROVIDER=aws` | AWS Secrets Manager secret ID |
| `VAULT_ADDR` | If `SECRETS_PROVIDER=vault` | HashiCorp Vault address |
| `VAULT_TOKEN` | If `SECRETS_PROVIDER=vault` | Vault token |
| `VAULT_SECRET_PATH` | If `SECRETS_PROVIDER=vault` | Path to the secret |

### Legacy HMAC Tokens

During migration from HMAC-256 to RSA-256, the middleware accepts both:

- Tokens with `alg: RS256` and a `kid` header → verified with the RSA public key
- Tokens without a `kid` (legacy) → verified with `JWT_SECRET` (HMAC-256)

Once all active sessions have been refreshed (access tokens expire in 15
minutes), the HMAC fallback can be removed.
