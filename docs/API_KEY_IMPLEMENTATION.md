# API Key System Implementation

Complete technical reference for the API key authentication system implementation.

## Architecture Overview

The API key system provides secure, scoped, and rate-limited authentication for external integrations. It consists of:

1. **Middleware Layer**: Authentication and permission checking
2. **Service Layer**: Business logic for key management
3. **Model Layer**: Database operations
4. **Controller Layer**: HTTP request handling
5. **Routes Layer**: Endpoint definitions

## Components

### 1. Middleware (`api-key.middleware.ts`)

#### `authenticateApiKey`
Main authentication middleware that:
- Extracts API key from `Authorization: ApiKey <key>` header
- Hashes key with SHA-256
- Looks up key in database
- Validates key (active, not expired)
- Checks rate limit (Redis sorted sets)
- Logs usage to audit logs
- Attaches key info to `req.apiKey`

**Usage:**
```typescript
router.get('/protected', authenticateApiKey, handler);
```

#### `requireApiKeyPermission(permission: string)`
Permission checking middleware that:
- Verifies API key has required scope
- Supports wildcard `*` scope
- Logs permission denials
- Returns 403 if permission missing

**Usage:**
```typescript
router.post('/bookings', 
  authenticateApiKey,
  requireApiKeyPermission('bookings:write'),
  createBooking
);
```

#### `authenticateJwtOrApiKey`
Dual authentication middleware that:
- Tries JWT authentication first
- Falls back to API key authentication
- Useful for endpoints accessible by both users and integrations

**Usage:**
```typescript
router.get('/bookings', authenticateJwtOrApiKey, getBookings);
```

#### `invalidateApiKeyCache(keyHash: string)`
Cache invalidation helper:
- Marks key as revoked in Redis
- 30-second TTL for cache invalidation
- Called after revocation or rotation

---

### 2. Service (`api-key.service.ts`)

#### `create(userId, payload)`
Creates a new API key:
- Generates random 48-character key with `mm_` prefix
- Validates scopes against VALID_SCOPES
- Calls `ApiKeyModel.create()`
- Logs creation to audit logs
- Returns plain key (shown once)

**Example:**
```typescript
const result = await ApiKeyService.create(userId, {
  name: "Production API",
  scopes: ["bookings:read", "sessions:read"],
  rateLimit: 1000,
  description: "Main production integration",
  expiresAt: new Date("2025-12-31")
});

console.log(result.plainKey); // mm_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
```

#### `list(userId)`
Lists all API keys for a user:
- Returns key metadata (no plain keys)
- Includes usage statistics
- Ordered by creation date

#### `revoke(id, userId)`
Revokes an API key:
- Sets `is_active = FALSE`
- Invalidates cache (30s TTL)
- Logs revocation
- Keys rejected within 30 seconds

#### `rotate(id, userId)`
Rotates an API key:
- Generates new key
- Stores old key in `rotated_api_keys` with 24h grace period
- Updates key hash atomically
- Returns new plain key
- Logs rotation

**Grace Period:**
- Old key valid for 24 hours
- Allows seamless migration
- Both keys work during grace period

#### `getUsageStats(id, userId)`
Returns usage statistics:
- Total requests
- Last 24 hours / 7 days / 30 days
- Top endpoints by request count
- Recent activity log

**Example Response:**
```typescript
{
  totalRequests: 15420,
  last24Hours: 127,
  last7Days: 892,
  last30Days: 3654,
  topEndpoints: [
    { endpoint: "/api/v1/bookings", count: 8420 },
    { endpoint: "/api/v1/sessions", count: 5230 }
  ],
  recentActivity: [...]
}
```

#### `listScopes()`
Returns array of valid scopes:
```typescript
[
  "bookings:read",
  "bookings:write",
  "sessions:read",
  "sessions:write",
  "users:read",
  "mentors:read",
  "payments:read",
  "reviews:read",
  "webhooks:write",
  "webhooks:manage",
  "messaging:write",
  "*"
]
```

---

### 3. Model (`api-key.model.ts`)

#### `create(payload)`
Database insertion:
- Generates random key with crypto.randomBytes
- Hashes with SHA-256
- Stores prefix for UI display
- Returns both plain key and metadata

**Schema:**
```sql
INSERT INTO integration_api_keys (
  owner_user_id, name, provider, key_hash, scopes,
  rate_limit, description, expires_at, metadata
) VALUES (...)
```

#### `findByUser(userId)`
Query all keys for a user:
- Joins metadata for key prefix
- Filters by provider='public'
- Orders by created_at DESC

#### `findById(id, userId)`
Get single key by ID:
- Verifies ownership
- Returns key metadata

#### `revoke(id, userId)`
Soft delete (deactivation):
- Sets `is_active = FALSE`
- Updates `updated_at`
- Returns boolean success

#### `rotate(id, userId, gracePeriodHours = 24)`
Atomic key rotation:
- Uses transaction (BEGIN/COMMIT)
- Stores old hash in `rotated_api_keys`
- Updates `key_hash` and `metadata.key_prefix`
- Rolls back on error

**Grace Period:**
```sql
INSERT INTO rotated_api_keys (original_key_id, key_hash, expires_at)
VALUES ($1, $2, NOW() + INTERVAL '24 hours')
ON CONFLICT (original_key_id) DO UPDATE SET ...
```

#### `authenticate(rawKey)`
Authentication lookup:
- Hashes provided key
- Checks `integration_api_keys` table
- Falls back to `rotated_api_keys` if not found
- Validates expiration
- Updates `last_used_at`
- Returns key context or null

**Lookup Order:**
1. Active keys (`integration_api_keys` where `is_active = TRUE`)
2. Rotated keys (`rotated_api_keys` where `expires_at > NOW()`)
3. Return null if not found

---

### 4. Controller (`api-key.controller.ts`)

REST API handlers:

#### `POST /api/v1/api-keys` → `create()`
Creates new key, returns plain key in response

#### `GET /api/v1/api-keys` → `list()`
Lists all keys for authenticated user

#### `DELETE /api/v1/api-keys/:id` → `revoke()`
Revokes key by ID

#### `POST /api/v1/api-keys/:id/rotate` → `rotate()`
Rotates key, returns new plain key

#### `GET /api/v1/api-keys/:id/usage` → `usage()`
Returns usage statistics

#### `GET /api/v1/api-keys/scopes` → `listScopes()`
Returns available scopes

---

### 5. Routes (`api-keys.routes.ts`)

Route definitions with validation:

```typescript
router.use(authenticate); // All routes require JWT

router.get("/scopes", asyncHandler(ApiKeyController.listScopes));
router.post("/", validate(createApiKeySchema), asyncHandler(ApiKeyController.create));
router.get("/", asyncHandler(ApiKeyController.list));
router.delete("/:id", validate(apiKeyIdParamSchema), asyncHandler(ApiKeyController.revoke));
router.post("/:id/rotate", validate(apiKeyIdParamSchema), asyncHandler(ApiKeyController.rotate));
router.get("/:id/usage", validate(apiKeyIdParamSchema), asyncHandler(ApiKeyController.usage));
```

---

## Security Features

### 1. Hashed Storage
- Keys never stored in plaintext
- SHA-256 hashing before database insert
- Plain key shown only once at creation

### 2. Cache Invalidation
- Revoked keys cached in Redis for 30 seconds
- Fast rejection of invalid keys
- Reduces database load

### 3. Rate Limiting
- Per-key limits (default 1000 req/hour)
- Redis sorted sets for sliding window
- Configurable per key
- Rate limit headers in response

### 4. Scope-Based Permissions
- Granular access control
- Principle of least privilege
- Wildcard `*` for admin keys
- Permission denied logging

### 5. Audit Logging
- All operations logged to `audit_logs`
- Key creation, usage, revocation, rotation
- IP address and user agent tracking
- Permission denials logged

### 6. Key Rotation
- Zero-downtime rotation
- 24-hour grace period
- Old key in separate table
- Atomic database updates

### 7. Expiration
- Optional expiration dates
- Automatic validation on authentication
- Expired keys rejected immediately

---

## Database Schema

### `integration_api_keys`
```sql
CREATE TABLE integration_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'public',
  key_hash VARCHAR(128) NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL,
  rate_limit INTEGER NOT NULL DEFAULT 1000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  last_used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_integration_api_keys_provider_active 
  ON integration_api_keys(provider, is_active);

CREATE INDEX idx_integration_api_keys_owner_provider 
  ON integration_api_keys(owner_user_id, provider);
```

### `rotated_api_keys`
```sql
CREATE TABLE rotated_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_key_id UUID REFERENCES integration_api_keys(id) ON DELETE CASCADE,
  key_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(original_key_id)
);

CREATE INDEX idx_rotated_api_keys_hash ON rotated_api_keys(key_hash);
```

---

## Integration Examples

### Applying API Key Auth to Routes

#### Option 1: API Key Only
```typescript
router.get('/integrations/data',
  authenticateApiKey,
  requireApiKeyPermission('data:read'),
  getData
);
```

#### Option 2: JWT or API Key
```typescript
router.get('/bookings',
  authenticateJwtOrApiKey,
  getBookings
);
```

#### Option 3: Multiple Permissions
```typescript
router.post('/bookings/:id/complete',
  authenticateApiKey,
  requireApiKeyPermission('bookings:write'),
  requireApiKeyPermission('sessions:write'),
  completeBooking
);
```

---

### Zapier Integration Update

The Zapier routes now use the centralized API key middleware:

```typescript
// Old implementation (custom auth)
async function authenticateZapier(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  const context = await ZapierService.authenticateApiKey(apiKey);
  if (!context) return res.status(401).json(...);
  req.zapier = context;
  next();
}

// New implementation (centralized)
router.use("/zapier", authenticateApiKey, setupZapierContext);
router.post("/zapier/subscribe", 
  requireApiKeyPermission("webhooks:manage"),
  asyncHandler(ZapierController.subscribe)
);
```

Benefits:
- Consistent authentication across all integrations
- Centralized rate limiting
- Unified audit logging
- Scope-based permissions

---

### Webhook Integration Update

The webhook incoming endpoint now uses API key auth:

```typescript
// Old implementation (custom webhook auth)
router.post('/incoming', webhookAuth, WebhooksController.receive);

// New implementation (API key auth)
router.post('/incoming', 
  authenticateApiKey,
  requireApiKeyPermission('webhooks:write'),
  WebhooksController.receive
);
```

---

## Testing

### Manual Testing

#### 1. Create API Key
```bash
curl -X POST https://api.mentorsmind.com/api/v1/api-keys \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Key",
    "scopes": ["bookings:read"],
    "rate_limit": 100
  }'
```

#### 2. Use API Key
```bash
API_KEY="mm_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p"

curl https://api.mentorsmind.com/api/v1/bookings \
  -H "Authorization: ApiKey $API_KEY"
```

#### 3. Test Permission Denial
```bash
# Key has bookings:read, try bookings:write
curl -X POST https://api.mentorsmind.com/api/v1/bookings \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "mentorId": "..." }'

# Expected: 403 Forbidden
```

#### 4. Test Rate Limiting
```bash
# Rapid fire requests to exceed limit
for i in {1..150}; do
  curl https://api.mentorsmind.com/api/v1/bookings \
    -H "Authorization: ApiKey $API_KEY"
done

# Expected: 429 after limit reached
```

#### 5. Rotate Key
```bash
curl -X POST https://api.mentorsmind.com/api/v1/api-keys/$KEY_ID/rotate \
  -H "Authorization: Bearer $JWT_TOKEN"

# Save new key, test both old and new work
```

#### 6. Revoke Key
```bash
curl -X DELETE https://api.mentorsmind.com/api/v1/api-keys/$KEY_ID \
  -H "Authorization: Bearer $JWT_TOKEN"

# Wait 30 seconds for cache invalidation
sleep 30

# Test key is rejected
curl https://api.mentorsmind.com/api/v1/bookings \
  -H "Authorization: ApiKey $API_KEY"

# Expected: 401 Unauthorized
```

---

## Monitoring

### Metrics to Track

1. **API Key Usage**
   - Requests per key per hour
   - Peak usage times
   - Unused keys

2. **Rate Limits**
   - Keys hitting limits
   - Limit adjustment needs
   - Abuse patterns

3. **Permission Denials**
   - Most denied permissions
   - Keys needing scope updates
   - Potential security issues

4. **Key Lifecycle**
   - Creation rate
   - Revocation rate
   - Rotation frequency
   - Average key age

### Querying Audit Logs

```sql
-- Most used endpoints by API key
SELECT 
  resource_id as key_id,
  metadata->>'endpoint' as endpoint,
  COUNT(*) as request_count
FROM audit_logs
WHERE resource_type = 'api_key' 
  AND action = 'API_KEY_USED'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY resource_id, metadata->>'endpoint'
ORDER BY request_count DESC;

-- Permission denials
SELECT 
  resource_id as key_id,
  metadata->>'requiredPermission' as permission,
  COUNT(*) as denial_count
FROM audit_logs
WHERE resource_type = 'api_key' 
  AND action = 'API_KEY_PERMISSION_DENIED'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY resource_id, metadata->>'requiredPermission'
ORDER BY denial_count DESC;

-- Rate limit violations
SELECT 
  resource_id as key_id,
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as violations
FROM audit_logs
WHERE resource_type = 'api_key' 
  AND action = 'API_KEY_RATE_LIMIT_EXCEEDED'
  AND created_at >= NOW() - INTERVAL '24 hours'
GROUP BY resource_id, hour
ORDER BY violations DESC;
```

---

## Troubleshooting

### Key Not Working

1. **Check if key is active**:
   ```sql
   SELECT is_active, expires_at FROM integration_api_keys WHERE key_hash = '...';
   ```

2. **Check cache invalidation**:
   - Wait 30 seconds after revocation
   - Check Redis: `GET api_key:invalid:$HASH`

3. **Verify scopes**:
   ```sql
   SELECT scopes FROM integration_api_keys WHERE key_hash = '...';
   ```

4. **Check rate limit**:
   ```
   ZCARD api_key_rate_limit:$KEY_ID
   ```

### Permission Denied

1. **Check required permission**: Look at error message
2. **Check key scopes**: Compare required vs. available
3. **Create new key**: With correct scopes if needed

### Rate Limit Issues

1. **Check current usage**: `GET /api-keys/:id/usage`
2. **Increase limit**: Revoke and create new key with higher limit
3. **Optimize calls**: Reduce unnecessary API calls

---

## Future Enhancements

1. **IP Whitelisting**: Restrict keys to specific IPs
2. **Webhook Callbacks**: Notify on key events
3. **Usage Alerts**: Email when limit reached
4. **Key Policies**: Auto-rotate, auto-expire rules
5. **Scope Templates**: Predefined scope sets
6. **Key Approval**: Require admin approval for certain scopes

---

## Changelog

- **v1.0** (Jan 2025): Initial implementation
  - Complete CRUD operations
  - Scope-based permissions
  - Rate limiting per key
  - Key rotation with grace period
  - Usage statistics
  - Audit logging
  - Redis caching
  - Zapier integration
  - Webhook integration
