# API Key Management

Complete guide for managing API keys in the MentorsMind platform.

## Table of Contents

- [Overview](#overview)
- [Security Model](#security-model)
- [Available Scopes](#available-scopes)
- [API Endpoints](#api-endpoints)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Key Rotation](#key-rotation)
- [Best Practices](#best-practices)
- [Integration Examples](#integration-examples)

## Overview

API keys allow external systems (Zapier, custom integrations, webhooks) to authenticate with the MentorsMind platform programmatically. API keys are:

- **Scoped**: Each key has specific permissions (read/write access to resources)
- **Rate-limited**: Per-key request limits (default: 1,000 req/hour)
- **Audited**: All usage is logged for security and compliance
- **Revocable**: Can be revoked instantly with 30-second cache invalidation
- **Rotatable**: Keys can be rotated with a grace period for seamless migration

## Security Model

### Key Storage

- **Never stored in plaintext**: API keys are hashed with SHA-256 before storage
- **Shown once**: The plain key is only returned at creation time
- **Prefix for identification**: First 10 characters shown in UI (e.g., `mm_1a2b3c4d`)

### Authentication Flow

1. Client sends request with `Authorization: ApiKey <key>` header
2. Server hashes the key with SHA-256
3. Hash is looked up in `integration_api_keys` table
4. Key is validated (active, not expired, not revoked)
5. Redis cache stores invalid/revoked keys for 30 seconds
6. Rate limit is checked per key
7. Request is authorized and scopes are checked
8. All usage is logged to `audit_logs` table

### Cache Invalidation

Revoked keys are rejected within 30 seconds due to Redis cache TTL. This provides:
- Fast rejection of invalid keys
- Reduced database load
- Quick security response time

## Available Scopes

API keys must have one or more of the following scopes:

| Scope | Description | Use Case |
|-------|-------------|----------|
| `bookings:read` | Read booking information | View scheduled sessions |
| `bookings:write` | Create/update bookings | Schedule new sessions |
| `sessions:read` | Read session data | Access session details |
| `sessions:write` | Update sessions | Complete sessions, add notes |
| `users:read` | Read user profiles | View mentor/learner info |
| `mentors:read` | Read mentor data | Search mentors |
| `payments:read` | Read payment history | View transaction records |
| `reviews:read` | Read reviews | Access feedback |
| `webhooks:write` | Send data to webhooks | Trigger webhook deliveries |
| `webhooks:manage` | Manage webhook subscriptions | CRUD webhook configs |
| `messaging:write` | Send messages | Post to conversations |
| `*` | All permissions | Full access (use with caution) |

## API Endpoints

### Create API Key

```http
POST /api/v1/api-keys
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "name": "Zapier Integration",
  "scopes": ["bookings:read", "sessions:read"],
  "rate_limit": 1000,
  "description": "Used for Zapier booking notifications",
  "expires_at": "2025-12-31T23:59:59Z"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Zapier Integration",
    "key": "mm_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p",
    "key_prefix": "mm_1a2b3c4",
    "scopes": ["bookings:read", "sessions:read"],
    "rate_limit": 1000,
    "is_active": true,
    "description": "Used for Zapier booking notifications",
    "expires_at": "2025-12-31T23:59:59Z",
    "created_at": "2025-01-15T10:30:00Z"
  },
  "message": "Store this key securely — it will not be shown again."
}
```

⚠️ **Important**: Save the `key` value immediately. It cannot be retrieved again.

### List API Keys

```http
GET /api/v1/api-keys
Authorization: Bearer <jwt-token>
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Zapier Integration",
      "key_prefix": "mm_1a2b3c4",
      "scopes": ["bookings:read", "sessions:read"],
      "rate_limit": 1000,
      "is_active": true,
      "last_used_at": "2025-01-16T14:22:00Z",
      "created_at": "2025-01-15T10:30:00Z"
    }
  ]
}
```

### Get Available Scopes

```http
GET /api/v1/api-keys/scopes
Authorization: Bearer <jwt-token>
```

**Response:**

```json
{
  "success": true,
  "data": [
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
}
```

### Revoke API Key

```http
DELETE /api/v1/api-keys/:id
Authorization: Bearer <jwt-token>
```

**Response:**

```json
{
  "success": true,
  "message": "API key revoked"
}
```

Keys are rejected within 30 seconds after revocation.

### Rotate API Key

```http
POST /api/v1/api-keys/:id/rotate
Authorization: Bearer <jwt-token>
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Zapier Integration",
    "key": "mm_9x8y7z6w5v4u3t2s1r0q9p8o7n6m5l4k",
    "key_prefix": "mm_9x8y7z6",
    "scopes": ["bookings:read", "sessions:read"],
    "rate_limit": 1000,
    "is_active": true,
    "created_at": "2025-01-15T10:30:00Z"
  },
  "message": "API key rotated successfully. The old key will remain valid for 24 hours. Store the new key securely — it will not be shown again."
}
```

The old key remains valid for 24 hours to allow seamless migration.

### Get Usage Statistics

```http
GET /api/v1/api-keys/:id/usage
Authorization: Bearer <jwt-token>
```

**Response:**

```json
{
  "success": true,
  "data": {
    "totalRequests": 15420,
    "last24Hours": 127,
    "last7Days": 892,
    "last30Days": 3654,
    "topEndpoints": [
      {
        "endpoint": "/api/v1/bookings",
        "count": 8420
      },
      {
        "endpoint": "/api/v1/sessions",
        "count": 5230
      }
    ],
    "recentActivity": [
      {
        "timestamp": "2025-01-16T14:22:00Z",
        "endpoint": "/api/v1/bookings",
        "method": "GET"
      }
    ]
  }
}
```

## Authentication

### Using API Keys in Requests

Include the API key in the `Authorization` header:

```http
GET /api/v1/bookings
Authorization: ApiKey mm_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
```

### Alternative: Bearer Format

Some tools prefer Bearer format:

```http
GET /api/v1/bookings
Authorization: Bearer mm_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
```

Both formats are supported on API key-protected routes.

### Mixed Authentication Routes

Some routes support both JWT and API key authentication:

```javascript
// Route accepts either JWT or API key
router.get('/bookings', authenticateJwtOrApiKey, getBookings);
```

The middleware tries JWT first, then falls back to API key.

## Rate Limiting

### Per-Key Limits

Each API key has its own rate limit (default: 1,000 requests/hour). Rate limits are:

- **Tracked in Redis**: Using sorted sets for sliding window
- **Independent**: Each key has its own quota
- **Configurable**: Set custom limits per key
- **Response headers**: Include rate limit info

**Rate Limit Headers:**

```http
X-RateLimit-Limit: 1000
X-RateLimit-Window: 3600
```

**Rate Limit Exceeded Response:**

```json
{
  "success": false,
  "error": "API key rate limit exceeded. Limit: 1000 requests per hour.",
  "rateLimit": 1000,
  "retryAfter": 3600
}
```

### Monitoring Rate Limits

Check usage statistics regularly:

```bash
curl -H "Authorization: Bearer <jwt>" \
  https://api.mentorsmind.com/api/v1/api-keys/<id>/usage
```

## Key Rotation

### Why Rotate Keys?

- **Security best practice**: Regular rotation reduces risk
- **Compromise response**: Rotate immediately if key is leaked
- **Team changes**: Rotate when team members leave
- **Compliance**: Some regulations require periodic rotation

### Rotation Process

1. **Generate new key**: `POST /api/v1/api-keys/:id/rotate`
2. **Grace period**: Old key valid for 24 hours
3. **Update integrations**: Update services with new key
4. **Verify**: Test all integrations with new key
5. **Complete**: Old key expires after 24 hours

### Zero-Downtime Rotation

```bash
# Step 1: Rotate the key
NEW_KEY=$(curl -X POST \
  -H "Authorization: Bearer $JWT" \
  https://api.mentorsmind.com/api/v1/api-keys/$KEY_ID/rotate \
  | jq -r '.data.key')

# Step 2: Update environment (e.g., Heroku, Kubernetes)
heroku config:set API_KEY=$NEW_KEY

# Step 3: Verify new key works
curl -H "Authorization: ApiKey $NEW_KEY" \
  https://api.mentorsmind.com/api/v1/bookings

# Old key still works during grace period
# After 24 hours, only new key is valid
```

## Best Practices

### Security

1. **Never commit keys to source control**
   - Use environment variables
   - Add `.env` files to `.gitignore`
   - Use secret management tools (AWS Secrets Manager, HashiCorp Vault)

2. **Use least-privilege scopes**
   - Only grant permissions needed
   - Avoid `*` scope unless absolutely necessary
   - Create separate keys for different purposes

3. **Rotate keys regularly**
   - Every 90 days minimum
   - Immediately on suspected compromise
   - After team member departures

4. **Monitor usage**
   - Check usage statistics weekly
   - Set up alerts for unusual activity
   - Review audit logs regularly

5. **Set expiration dates**
   - Use `expires_at` for temporary integrations
   - Review and renew periodically
   - Revoke unused keys

### Operational

1. **Name keys descriptively**
   ```json
   {
     "name": "Production Zapier - Booking Notifications",
     "description": "Used by Zapier to send booking notifications to Slack"
   }
   ```

2. **Document integrations**
   - Track which services use which keys
   - Document key purposes
   - Maintain key inventory

3. **Use separate keys per environment**
   - Development: `mm_dev_...`
   - Staging: `mm_staging_...`
   - Production: `mm_prod_...`

4. **Set appropriate rate limits**
   - Estimate actual usage
   - Add 20-30% buffer
   - Start conservative, increase if needed

5. **Test before deploying**
   - Use test keys in development
   - Verify scopes work as expected
   - Test rate limiting behavior

### Error Handling

Implement proper error handling in your integrations:

```javascript
async function callAPI(endpoint) {
  try {
    const response = await fetch(`https://api.mentorsmind.com${endpoint}`, {
      headers: {
        'Authorization': `ApiKey ${process.env.API_KEY}`
      }
    });

    if (response.status === 401) {
      // Key is invalid or revoked
      throw new Error('API key is invalid or revoked');
    }

    if (response.status === 403) {
      // Insufficient permissions
      const data = await response.json();
      throw new Error(`Missing permission: ${data.requiredPermission}`);
    }

    if (response.status === 429) {
      // Rate limit exceeded
      const retryAfter = response.headers.get('Retry-After');
      throw new Error(`Rate limit exceeded. Retry after ${retryAfter}s`);
    }

    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    // Implement retry logic, alerting, etc.
    throw error;
  }
}
```

## Integration Examples

### Zapier Integration

```javascript
// In Zapier custom app authentication
const options = {
  url: 'https://api.mentorsmind.com/api/v1/bookings',
  method: 'GET',
  headers: {
    'Authorization': `ApiKey ${bundle.authData.api_key}`
  }
};

return z.request(options).then((response) => {
  response.throwForStatus();
  return response.json;
});
```

### Node.js Client

```javascript
const axios = require('axios');

const client = axios.create({
  baseURL: 'https://api.mentorsmind.com/api/v1',
  headers: {
    'Authorization': `ApiKey ${process.env.MENTORSMIND_API_KEY}`
  }
});

// List bookings
const bookings = await client.get('/bookings');

// Create booking
const booking = await client.post('/bookings', {
  mentorId: 'mentor_123',
  scheduledStart: '2025-02-01T10:00:00Z',
  duration: 60
});
```

### Python Client

```python
import os
import requests

class MentorsMindClient:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = 'https://api.mentorsmind.com/api/v1'
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'ApiKey {api_key}'
        })
    
    def get_bookings(self):
        response = self.session.get(f'{self.base_url}/bookings')
        response.raise_for_status()
        return response.json()
    
    def create_booking(self, mentor_id, scheduled_start, duration):
        response = self.session.post(f'{self.base_url}/bookings', json={
            'mentorId': mentor_id,
            'scheduledStart': scheduled_start,
            'duration': duration
        })
        response.raise_for_status()
        return response.json()

# Usage
client = MentorsMindClient(os.environ['MENTORSMIND_API_KEY'])
bookings = client.get_bookings()
```

### Webhook Configuration

When registering webhooks, you can use API keys for authentication:

```bash
curl -X POST https://api.mentorsmind.com/api/v1/webhooks \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://myapp.com/webhooks/mentorsmind",
    "event_types": ["booking.created", "session.completed"],
    "description": "Production webhook for booking events"
  }'
```

The webhook will receive an API key that must be included when sending data:

```http
POST https://api.mentorsmind.com/api/v1/webhooks/incoming
Authorization: ApiKey <webhook-api-key>
Content-Type: application/json

{
  "event": "booking.created",
  "data": { ... }
}
```

## Audit Trail

All API key operations are logged:

- Key creation
- Key usage (every request)
- Key revocation
- Key rotation
- Permission denials
- Rate limit exceeded

Access audit logs via the admin panel or data export feature.

## Support

For questions or issues:

- Email: support@mentorsmind.com
- Documentation: https://docs.mentorsmind.com
- Status page: https://status.mentorsmind.com

## Changelog

- **v1.0** (Jan 2025): Initial API key system
  - Create, list, revoke operations
  - Scope-based permissions
  - Per-key rate limiting
  - Key rotation with grace period
  - Usage statistics
