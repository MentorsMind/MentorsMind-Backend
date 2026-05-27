# Data Encryption at Rest Implementation

**Issue:** #441  
**Description:** Encrypt sensitive data (passwords, API keys, PII) at rest.

## Overview

This implementation provides comprehensive encryption at rest for all sensitive data stored in the MentorsMind backend, using AES-256-GCM encryption with key versioning and rotation capabilities.

## Acceptance Criteria

- ✅ Encrypt passwords with bcrypt (already done)
- ✅ Encrypt API keys with AES-256
- ✅ Encrypt PII fields (SSN, bank account)
- ✅ Implement key rotation
- ✅ Document encryption strategy

## Architecture

### Encryption Algorithm

**Algorithm:** AES-256-GCM (Galois/Counter Mode)

**Why AES-256-GCM:**
- 256-bit key strength (industry standard)
- Authenticated encryption (provides integrity verification)
- Built-in authentication tag prevents tampering
- Widely supported and audited

**Key Components:**
- **IV (Initialization Vector):** 12 bytes (96 bits) - randomly generated for each encryption
- **Auth Tag:** 16 bytes (128 bits) - ensures data integrity
- **Key Derivation:** SHA-256 hash of raw key material

### Encrypted Data Format

```json
{
  "alg": "aes-256-gcm",
  "version": "v1",
  "iv": "base64-encoded-iv",
  "tag": "base64-encoded-auth-tag",
  "ciphertext": "base64-encoded-ciphertext"
}
```

### Key Management

**Key Storage:**
- Keys stored in environment variables or secrets manager
- Multiple key versions supported for rotation
- Current key version tracked in configuration

**Key Versioning:**
- Format: `v1`, `v2`, `v3`, etc.
- Each version has its own key material
- Old keys retained for decryption during rotation
- New data always encrypted with current key version

**Environment Variables:**
- `PII_ENCRYPTION_KEYS` - JSON object mapping versions to keys
- `PII_ENCRYPTION_CURRENT_KEY_VERSION` - Current active key version
- Fallback: `PII_ENCRYPTION_KEY` - Single key (legacy support)

## Implementation Details

### 1. Encryption Utility

**File:** `src/utils/encryption.utils.ts`

**Methods:**
- `encrypt(value)` - Encrypt plaintext with current key version
- `decrypt(value)` - Decrypt ciphertext using appropriate key version
- `rotateEncryptedValue(value)` - Re-encrypt with current key version
- `getCurrentKeyVersion()` - Get current active key version
- `getPayloadVersion(value)` - Extract key version from encrypted payload
- `setKeyResolver(resolver)` - Custom key resolver for secrets manager integration
- `clearCache()` - Clear cached keyset

### 2. Password Encryption

**Algorithm:** bcrypt (already implemented)

**File:** `src/services/auth.service.ts`

**Implementation:**
- Passwords hashed with bcrypt using 10 salt rounds
- Hash stored in `password_hash` column
- Not reversible by design (one-way hash)

### 3. API Key Encryption

**Files:**
- `src/services/webhook.service.ts` - Webhook API keys and secrets
- `src/services/zapier.service.ts` - Zapier integration keys

**Database Schema:**
```sql
-- webhooks table
api_key_encrypted TEXT,
secret_encrypted TEXT,
api_key_encryption_version VARCHAR(32)
```

**Implementation:**
- API keys encrypted before storage
- Secrets encrypted before storage
- Decrypted only when needed for webhook delivery
- Key version tracked for rotation

### 4. PII Field Encryption

**Database Schema:**
```sql
-- users table
phone_number_encrypted TEXT,
date_of_birth_encrypted TEXT,
government_id_number_encrypted TEXT,
bank_account_details_encrypted TEXT,
pii_encryption_version VARCHAR(32)
```

**Migration:** `database/migrations/041_add_encrypted_fields.sql`

**Fields Encrypted:**
- Phone numbers
- Date of birth
- Government ID numbers (SSN, etc.)
- Bank account details

### 5. OAuth Token Encryption

**Files:**
- `src/config/passport.ts` - Google and GitHub OAuth

**Database Schema:**
```sql
-- oauth_accounts table
access_token_encrypted TEXT,
refresh_token_encrypted TEXT,
token_encryption_version VARCHAR(32)
```

**Migration:** `database/migrations/063_encrypt_oauth_tokens.sql`

**Implementation:**
- Access tokens encrypted after OAuth callback
- Refresh tokens encrypted after OAuth callback
- Decrypted when making API calls to OAuth providers
- Key version tracked for rotation

### 6. Key Rotation

**File:** `src/jobs/keyRotation.job.ts`

**Function:** `keyRotationJob.run()`

**Process:**
1. Get current key version
2. Scan tables for encrypted data with old versions
3. Batch process (100 records at a time)
4. Decrypt with old key, encrypt with new key
5. Update encryption version
6. Log rotation statistics

**Tables Rotated:**
- `users` - PII fields
- `webhooks` - API keys and secrets
- `oauth_accounts` - OAuth tokens

**Schedule:** Run periodically (e.g., monthly) via BullMQ

## Database Migrations

### Migration 041: Add Encrypted PII Fields
**File:** `database/migrations/041_add_encrypted_fields.sql`

Adds encrypted columns to users table for PII data.

### Migration 062: Encrypt Webhook API Keys
**File:** `database/migrations/062_encrypt_webhook_api_keys.sql`

Adds encrypted columns to webhooks table for API keys and secrets.

### Migration 063: Encrypt OAuth Tokens
**File:** `database/migrations/063_encrypt_oauth_tokens.sql`

Adds encrypted columns to oauth_accounts table for OAuth tokens.

## Security Considerations

### Key Storage

**Production:**
- Use AWS Secrets Manager or equivalent
- Rotate keys regularly (e.g., every 90 days)
- Never commit keys to version control
- Use strong random key material (32+ bytes)

**Development:**
- Use environment variables
- Never use production keys
- Use separate keys per environment

### Encryption Best Practices

1. **Never log plaintext secrets** - Only log encrypted values or hashes
2. **Use unique IVs** - Random IV for each encryption operation
3. **Verify integrity** - Authenticated encryption prevents tampering
4. **Key separation** - Different keys for different data types
5. **Regular rotation** - Rotate keys periodically to limit exposure

### Data in Transit

- All API endpoints use HTTPS/TLS
- Database connections use SSL/TLS
- Internal service communication should use mTLS

## Deployment Steps

### 1. Set Up Encryption Keys

```bash
# Generate strong encryption keys (32 bytes)
# Use a secure random generator

# For development (environment variable)
export PII_ENCRYPTION_KEY="your-32-byte-random-key-here"

# For production (secrets manager)
# Store in AWS Secrets Manager, HashiCorp Vault, etc.
```

### 2. Run Database Migrations

```bash
npm run migrate:up
```

This will:
- Add encrypted columns to tables
- Create indexes for key rotation
- Add comments for documentation

### 3. Configure Key Rotation Job

Register the key rotation job in your BullMQ worker:

```typescript
import { keyRotationJob } from '../jobs/keyRotation.job';

// Schedule to run monthly
workerQueue.add(
  'key-rotation',
  {},
  {
    repeat: { pattern: '0 0 1 * *' }, // First day of month at midnight
    jobId: 'key-rotation-monthly',
  }
);
```

### 4. Verify Encryption

Test that encryption is working:

```typescript
import { EncryptionUtil } from '../utils/encryption.utils';

const encrypted = await EncryptionUtil.encrypt('sensitive-data');
const decrypted = await EncryptionUtil.decrypt(encrypted);
console.log(decrypted); // Should equal 'sensitive-data'
```

## Monitoring

### Key Metrics

- Number of encrypted records by type
- Key rotation success rate
- Encryption/decryption latency
- Failed decryption attempts

### Queries

**Encrypted records count:**
```sql
SELECT 
  'users' as table_name,
  COUNT(*) FILTER (WHERE phone_number_encrypted IS NOT NULL) as encrypted_count
FROM users
UNION ALL
SELECT 
  'webhooks' as table_name,
  COUNT(*) FILTER (WHERE api_key_encrypted IS NOT NULL) as encrypted_count
FROM webhooks
UNION ALL
SELECT 
  'oauth_accounts' as table_name,
  COUNT(*) FILTER (WHERE access_token_encrypted IS NOT NULL) as encrypted_count
FROM oauth_accounts;
```

**Records needing rotation:**
```sql
SELECT 
  'users' as table_name,
  COUNT(*) FILTER (WHERE COALESCE(pii_encryption_version, '') != 'v1') as needs_rotation
FROM users
UNION ALL
SELECT 
  'webhooks' as table_name,
  COUNT(*) FILTER (WHERE COALESCE(api_key_encryption_version, '') != 'v1') as needs_rotation
FROM webhooks
UNION ALL
SELECT 
  'oauth_accounts' as table_name,
  COUNT(*) FILTER (WHERE COALESCE(token_encryption_version, '') != 'v1') as needs_rotation
FROM oauth_accounts;
```

## Testing

### Unit Tests

**File:** `src/utils/__tests__/encryption.utils.test.ts`

**Coverage:**
- Encrypt/decrypt round-trip
- Key rotation
- Version tracking
- Null/empty value handling

### Integration Tests

**File:** `src/__tests__/services/encryption.integration.test.ts`

**Coverage:**
- Webhook API key encryption
- OAuth token encryption
- PII field encryption
- Key rotation scenarios

## Troubleshooting

### Decryption Fails

**Symptom:** `Error: No decryption key available for version "v2"`

**Solution:**
- Ensure old key version is still in keyset
- Check key configuration in secrets manager
- Verify key version in encrypted payload

### Key Rotation Stuck

**Symptom:** Rotation job running but not completing

**Solution:**
- Check database connection
- Verify batch size is appropriate
- Check logs for specific errors
- Ensure sufficient permissions

### Performance Issues

**Symptom:** Slow encryption/decryption

**Solution:**
- Monitor encryption latency
- Consider caching decrypted values in memory (with TTL)
- Optimize batch size for rotation
- Use connection pooling

## Future Enhancements

- **Envelope Encryption:** Use AWS KMS or Google Cloud KMS for key management
- **Field-Level Encryption:** Encrypt individual JSON fields in metadata columns
- **Database-Level Encryption:** Use PostgreSQL Transparent Data Encryption (TDE)
- **Hardware Security Modules (HSM):** Store keys in HSM for maximum security
- **Audit Logging:** Log all encryption/decryption operations for compliance
- **Automated Key Rotation:** Integrate with secrets manager auto-rotation

## Compliance

This implementation helps meet compliance requirements for:

- **GDPR:** Data protection by design and by default
- **PCI DSS:** Protection of cardholder data
- **HIPAA:** Protection of electronic protected health information
- **SOC 2:** Security and availability controls

## References

- [NIST Cryptographic Standards](https://csrc.nist.gov/projects/cryptographic-standards-and-guidelines)
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [AES-GCM RFC](https://tools.ietf.org/html/rfc5288)
