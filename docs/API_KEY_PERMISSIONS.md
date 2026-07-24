# API Key Permissions Catalog

Complete reference for API key scopes and their allowed operations.

## Permission Model

API keys use **scope-based permissions**. Each key has one or more scopes that define what resources it can access and what operations it can perform.

## Scope Format

Scopes follow the pattern: `resource:action`

- `resource`: The entity type (bookings, sessions, users, etc.)
- `action`: The operation (read, write, manage)

## Available Scopes

### Bookings

#### `bookings:read`
**Description**: Read-only access to booking information

**Allowed Operations**:
- List bookings
- Get booking details
- View booking status
- Access booking history

**Example Endpoints**:
```
GET /api/v1/bookings
GET /api/v1/bookings/:id
GET /api/v1/bookings?status=confirmed
```

**Use Cases**:
- Analytics dashboards
- Reporting tools
- Calendar synchronization (read-only)
- Notification systems

---

#### `bookings:write`
**Description**: Create and modify bookings

**Allowed Operations**:
- Create new bookings
- Update existing bookings
- Cancel bookings
- Reschedule bookings

**Example Endpoints**:
```
POST /api/v1/bookings
PUT /api/v1/bookings/:id
DELETE /api/v1/bookings/:id
PATCH /api/v1/bookings/:id/reschedule
```

**Use Cases**:
- Scheduling automation
- Booking widgets
- Third-party booking systems
- Calendar integration (bidirectional)

⚠️ **Note**: Requires `bookings:read` scope implicitly for read operations

---

### Sessions

#### `sessions:read`
**Description**: Read-only access to session data

**Allowed Operations**:
- List sessions
- Get session details
- View session recordings (if available)
- Access session notes
- View session feedback

**Example Endpoints**:
```
GET /api/v1/sessions
GET /api/v1/sessions/:id
GET /api/v1/sessions/:id/recording
GET /api/v1/sessions/:id/notes
```

**Use Cases**:
- Learning management systems
- Progress tracking
- Quality assurance
- Training analytics

---

#### `sessions:write`
**Description**: Modify session data

**Allowed Operations**:
- Complete sessions
- Add session notes
- Update session status
- Submit session feedback

**Example Endpoints**:
```
PATCH /api/v1/sessions/:id/complete
POST /api/v1/sessions/:id/notes
PUT /api/v1/sessions/:id/feedback
```

**Use Cases**:
- Automated session management
- Note-taking integrations
- Feedback collection tools
- Session workflow automation

---

### Users

#### `users:read`
**Description**: Read-only access to user profiles

**Allowed Operations**:
- Get user profile information
- View user availability
- Access public user data
- List users (filtered)

**Example Endpoints**:
```
GET /api/v1/users/:id
GET /api/v1/users/:id/availability
GET /api/v1/users/search
```

**Use Cases**:
- User directories
- Profile widgets
- Availability checkers
- User search tools

⚠️ **Privacy Note**: Only returns publicly available information. Sensitive data (email, phone) requires additional authentication.

---

### Mentors

#### `mentors:read`
**Description**: Read-only access to mentor-specific data

**Allowed Operations**:
- List mentors
- Get mentor profiles
- View mentor expertise
- Access mentor availability
- View mentor ratings

**Example Endpoints**:
```
GET /api/v1/mentors
GET /api/v1/mentors/:id
GET /api/v1/mentors/search?expertise=javascript
GET /api/v1/mentors/:id/availability
GET /api/v1/mentors/:id/reviews
```

**Use Cases**:
- Mentor marketplaces
- Recommendation engines
- Search and discovery tools
- Matching algorithms

---

### Payments

#### `payments:read`
**Description**: Read-only access to payment records

**Allowed Operations**:
- View payment history
- Get transaction details
- Access payment status
- View invoices

**Example Endpoints**:
```
GET /api/v1/payments
GET /api/v1/payments/:id
GET /api/v1/payments/:id/invoice
GET /api/v1/payments/transactions
```

**Use Cases**:
- Accounting systems
- Financial reporting
- Revenue analytics
- Invoice management

⚠️ **Security Note**: Only returns payments for the API key owner. Admin access requires separate authentication.

---

### Reviews

#### `reviews:read`
**Description**: Read-only access to reviews and ratings

**Allowed Operations**:
- List reviews
- Get review details
- View ratings
- Access review statistics

**Example Endpoints**:
```
GET /api/v1/reviews
GET /api/v1/reviews/:id
GET /api/v1/reviews?mentorId=:id
GET /api/v1/reviews/stats
```

**Use Cases**:
- Review aggregation
- Quality monitoring
- Reputation systems
- Social proof widgets

---

### Webhooks

#### `webhooks:write`
**Description**: Send data to registered webhook endpoints

**Allowed Operations**:
- Trigger webhook deliveries
- Send test payloads
- Deliver event data

**Example Endpoints**:
```
POST /api/v1/webhooks/incoming
POST /api/v1/webhooks/:id/test
```

**Use Cases**:
- Event broadcasting
- Integration platforms (Zapier, Make)
- Custom webhook consumers
- Real-time data sync

---

#### `webhooks:manage`
**Description**: Full webhook management capabilities

**Allowed Operations**:
- Create webhook subscriptions
- Update webhook configurations
- Delete webhooks
- View webhook deliveries
- Rotate webhook API keys
- All operations from `webhooks:write`

**Example Endpoints**:
```
POST /api/v1/webhooks
PUT /api/v1/webhooks/:id
DELETE /api/v1/webhooks/:id
GET /api/v1/webhooks/:id/deliveries
POST /api/v1/webhooks/:id/rotate-api-key
```

**Use Cases**:
- Integration management platforms
- Webhook configuration UIs
- Automated webhook provisioning
- Webhook monitoring tools

---

### Messaging

#### `messaging:write`
**Description**: Send messages to conversations

**Allowed Operations**:
- Send messages
- Create message threads
- Post to conversations

**Example Endpoints**:
```
POST /api/v1/conversations/:id/messages
POST /api/v1/messages
```

**Use Cases**:
- Chatbots
- Automated notifications
- Integration messaging
- Support automation

⚠️ **Note**: Can only send messages to conversations where the key owner is a participant.

---

### Wildcard

#### `*` (All Permissions)
**Description**: Full access to all resources and operations

**Allowed Operations**: All operations across all resources

⚠️ **Use With Extreme Caution**: This scope grants complete API access. Only use for:
- System-to-system integrations
- Internal administrative tools
- Trusted partner integrations

**Security Recommendations**:
- Avoid using this scope unless absolutely necessary
- Use specific scopes whenever possible
- Regularly audit keys with `*` scope
- Implement additional security measures (IP whitelisting, etc.)
- Rotate frequently (every 30 days)

---

## Scope Combinations

### Common Patterns

#### Read-Only Integration
```json
{
  "scopes": [
    "bookings:read",
    "sessions:read",
    "mentors:read"
  ]
}
```
**Use Case**: Analytics dashboard, reporting tool

---

#### Booking Management
```json
{
  "scopes": [
    "bookings:read",
    "bookings:write",
    "users:read"
  ]
}
```
**Use Case**: Calendar sync, scheduling automation

---

#### Zapier Integration
```json
{
  "scopes": [
    "bookings:read",
    "sessions:read",
    "webhooks:write",
    "messaging:write"
  ]
}
```
**Use Case**: Event-driven automation, notifications

---

#### Webhook Management
```json
{
  "scopes": [
    "webhooks:manage",
    "bookings:read",
    "sessions:read"
  ]
}
```
**Use Case**: Integration platform, webhook UI

---

#### Session Automation
```json
{
  "scopes": [
    "sessions:read",
    "sessions:write",
    "bookings:read"
  ]
}
```
**Use Case**: Session workflow automation, note-taking apps

---

## Permission Checking

### How Permissions Are Verified

1. **Request arrives** with `Authorization: ApiKey <key>` header
2. **Key is authenticated** and scopes are loaded
3. **Endpoint requires permission** (e.g., `bookings:read`)
4. **Middleware checks** if key has required scope
5. **Request is authorized** if scope matches or `*` is present
6. **403 Forbidden** returned if permission is missing

### Permission Denial Response

```json
{
  "success": false,
  "error": "Insufficient permissions. Required: bookings:write",
  "requiredPermission": "bookings:write"
}
```

### Checking Permissions in Code

```javascript
// Apply permission check to route
router.post('/bookings', 
  authenticateApiKey,
  requireApiKeyPermission('bookings:write'),
  createBooking
);

// Or check multiple permissions
router.post('/bookings/:id/complete',
  authenticateApiKey,
  requireApiKeyPermission('sessions:write'),
  completeSession
);
```

---

## Scope Expansion

### Implicit Permissions

Some scopes implicitly grant read access:

- `bookings:write` → includes `bookings:read` for read operations
- `sessions:write` → includes `sessions:read` for read operations
- `webhooks:manage` → includes `webhooks:write` for write operations

⚠️ **Note**: Always explicitly declare scopes for clarity and security.

---

## Best Practices

### 1. Principle of Least Privilege

Grant only the minimum scopes required:

❌ **Bad**: Request `*` scope for a read-only dashboard
```json
{ "scopes": ["*"] }
```

✅ **Good**: Request only needed scopes
```json
{ "scopes": ["bookings:read", "sessions:read"] }
```

---

### 2. Scope Granularity

Be specific about what you need:

❌ **Bad**: Request write access when only reading
```json
{ "scopes": ["bookings:write"] }
```

✅ **Good**: Request appropriate access level
```json
{ "scopes": ["bookings:read"] }
```

---

### 3. Regular Scope Audits

- Review key scopes quarterly
- Remove unused scopes
- Downgrade permissions when possible
- Document why each scope is needed

---

### 4. Separate Keys by Purpose

Create different keys for different integrations:

```javascript
// Production Zapier - booking automation
{
  name: "Production Zapier - Bookings",
  scopes: ["bookings:read", "bookings:write", "webhooks:write"]
}

// Analytics Dashboard - read-only
{
  name: "Analytics Dashboard",
  scopes: ["bookings:read", "sessions:read", "payments:read"]
}

// Support Chatbot - messaging only
{
  name: "Support Chatbot",
  scopes: ["messaging:write", "users:read"]
}
```

---

## Migration Guide

### Adding New Scopes

If you need additional permissions:

1. **Review available scopes**: Check if scope exists
2. **Create new key** with updated scopes (recommended)
3. **Or rotate existing key** with new scopes
4. **Test thoroughly** before production deployment
5. **Document the change** in your integration docs

### Example Migration

```bash
# Current key has: ["bookings:read"]
# Need to add: ["sessions:read"]

# Option 1: Create new key
curl -X POST /api/v1/api-keys \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "name": "Analytics Dashboard v2",
    "scopes": ["bookings:read", "sessions:read"]
  }'

# Option 2: Rotate with new scopes (not directly supported)
# You'll need to revoke old key and create new one
```

⚠️ **Note**: Scope modification on existing keys is not supported. Create a new key instead.

---

## Future Scopes

Planned additions (not yet available):

- `learners:read` - Read learner-specific data
- `analytics:read` - Access analytics endpoints
- `reports:read` - Generate and download reports
- `admin:write` - Administrative operations (highly restricted)

---

## Support

Questions about permissions? Contact:

- **Email**: api-support@mentorsmind.com
- **Docs**: https://docs.mentorsmind.com/api-keys
- **Slack**: #api-integrations

---

## Changelog

- **v1.0** (Jan 2025): Initial scope catalog
  - 11 standard scopes
  - Wildcard `*` scope
  - Permission checking system
