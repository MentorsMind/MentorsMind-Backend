# API Deprecation Process

This document describes the API deprecation process for MentorMinds, including how to deprecate endpoints, manage the deprecation lifecycle, and migrate users to new endpoints.

## Overview

The deprecation process ensures:
- Clear communication to API consumers about endpoint changes
- A 6-month transition period for migration
- Proper HTTP headers following RFC standards
- Tracking and monitoring of deprecated endpoints
- Automated enforcement of sunset dates

## Key Principles

1. **6-Month Transition Period**: All deprecated endpoints remain functional for at least 6 months
2. **Clear Communication**: Multiple notification channels (headers, documentation, emails)
3. **Replacement Path**: Always provide a replacement endpoint or clear migration guide
4. **Gradual Enforcement**: Warnings first, then 410 Gone responses after sunset
5. **Tracking**: Monitor usage to understand migration progress

## HTTP Headers

### Deprecation Header (RFC 8594)

```
Deprecation: true
```

Indicates the endpoint is deprecated.

### Sunset Header (RFC 8594)

```
Sunset: Wed, 21 Nov 2024 08:00:00 GMT
```

Specifies the exact date and time when the endpoint will be removed.

### Link Header

```
Link: <https://api.mentorminds.com/api/v2/users/:id>; rel="successor-version"
```

Points to the replacement endpoint.

### Warning Header (RFC 7234)

```
Warning: 299 - "API endpoint deprecated. Will be removed in 180 days (2024-11-21T08:00:00Z)"
```

Provides human-readable deprecation information.

### Custom Headers

```
X-API-Migration-Guide: https://docs.mentorminds.com/migration/v1-to-v2-users
X-API-Warn: Deprecated endpoint. Use GET /api/v2/users/:id instead
```

Additional context for API consumers.

## Deprecation Lifecycle

### Phase 1: Announcement (Day 1)

1. Register endpoint in deprecation registry
2. Add deprecation headers to responses
3. Publish migration guide
4. Notify users via email/dashboard

### Phase 2: Active Deprecation (Days 1-180)

- Endpoint remains fully functional
- All responses include deprecation headers
- Monitor usage and migration progress
- Provide support for migration questions

### Phase 3: Final Warning (Days 151-180)

- Increase notification frequency
- Highlight in API documentation
- Offer migration assistance

### Phase 4: Sunset (Day 181+)

- Endpoint returns 410 Gone
- Redirect to replacement endpoint
- Remove from API documentation

## Implementation Guide

### 1. Register a Deprecated Endpoint

In `src/config/deprecation-registry.ts`:

```typescript
deprecationManager.registerDeprecation(
  createDeprecationConfig('GET /api/v1/users/:id', {
    replacementEndpoint: 'GET /api/v2/users/:id',
    migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2-users',
    reason: 'Improved performance and data structure',
    sunsetMonths: 6,
  })
);
```

### 2. Apply Deprecation Middleware

In your route file:

```typescript
import { deprecationMiddleware } from '../middleware/deprecation.middleware';

router.get('/api/v1/users/:id', deprecationMiddleware, userController.getUser);
```

### 3. Check Deprecation Status

```typescript
const isDeprecated = deprecationManager.isDeprecated('GET /api/v1/users/:id');
const shouldBeRemoved = deprecationManager.shouldBeRemoved('GET /api/v1/users/:id');
```

## API Endpoints

### Admin Deprecation Management

#### Get All Deprecated Endpoints

```bash
GET /admin/deprecations
```

Response:
```json
{
  "total": 5,
  "deprecated": 3,
  "sunset": 2,
  "endpoints": [
    {
      "endpoint": "GET /api/v1/users/:id",
      "status": "deprecated",
      "daysUntilSunset": 120,
      "replacementEndpoint": "GET /api/v2/users/:id"
    }
  ]
}
```

#### Get Upcoming Sunsets

```bash
GET /admin/deprecations/upcoming
```

Returns endpoints that will sunset within 30 days.

#### Get Sunset Endpoints

```bash
GET /admin/deprecations/sunset
```

Returns endpoints that have already been removed.

#### Get Specific Endpoint Details

```bash
GET /admin/deprecations/:endpoint
```

#### Register New Deprecation

```bash
POST /admin/deprecations
Content-Type: application/json

{
  "endpoint": "GET /api/v1/bookings",
  "replacementEndpoint": "GET /api/v2/bookings",
  "migrationGuide": "https://docs.mentorminds.com/migration/v1-to-v2-bookings",
  "reason": "Enhanced filtering and performance",
  "sunsetMonths": 6
}
```

#### Remove Deprecation

```bash
DELETE /admin/deprecations/:endpoint
```

Only allowed after sunset date.

#### Migration Progress Report

```bash
GET /admin/deprecations/report/migration-progress
```

#### Deprecation Timeline

```bash
GET /admin/deprecations/report/timeline
```

## Client-Side Handling

### Detecting Deprecated Endpoints

Check for deprecation headers:

```javascript
fetch('/api/v1/users/123')
  .then(response => {
    if (response.headers.get('Deprecation') === 'true') {
      const sunsetDate = response.headers.get('Sunset');
      const migrationGuide = response.headers.get('X-API-Migration-Guide');
      console.warn(`This endpoint is deprecated. Sunset: ${sunsetDate}`);
      console.warn(`Migration guide: ${migrationGuide}`);
    }
    return response.json();
  });
```

### Handling 410 Gone

```javascript
fetch('/api/v1/users/123')
  .then(response => {
    if (response.status === 410) {
      const data = response.json();
      console.error(`Endpoint removed. Use: ${data.replacementEndpoint}`);
      // Redirect to replacement endpoint
      return fetch(data.replacementEndpoint);
    }
    return response.json();
  });
```

## Migration Guide Template

Create a migration guide for each deprecated endpoint:

```markdown
# Migration Guide: v1 to v2 Users API

## Overview
The v1 Users API is being deprecated in favor of the v2 API with improved performance and data structure.

## Timeline
- **Deprecated**: January 1, 2024
- **Sunset**: July 1, 2024

## Changes

### Endpoint
- **Old**: `GET /api/v1/users/:id`
- **New**: `GET /api/v2/users/:id`

### Response Format
```json
// v1
{
  "id": "123",
  "name": "John Doe",
  "email": "john@example.com"
}

// v2
{
  "id": "123",
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com"
  },
  "metadata": {
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-15T00:00:00Z"
  }
}
```

## Migration Steps

1. Update endpoint URL from `/api/v1/users/:id` to `/api/v2/users/:id`
2. Update response parsing to handle new structure
3. Test thoroughly in staging environment
4. Deploy to production

## Support
For questions or issues, contact: api-support@mentorminds.com
```

## Monitoring and Analytics

### Track Deprecated Endpoint Usage

```typescript
// In your analytics system
analytics.track('deprecated_endpoint_accessed', {
  endpoint: 'GET /api/v1/users/:id',
  userId: req.user?.id,
  timestamp: new Date(),
  replacementEndpoint: 'GET /api/v2/users/:id',
});
```

### Monitor Migration Progress

Use the admin endpoints to track:
- Number of active users still using deprecated endpoints
- Migration timeline
- Endpoints approaching sunset

## Best Practices

1. **Plan Ahead**: Announce deprecations well in advance
2. **Provide Alternatives**: Always have a replacement endpoint ready
3. **Document Thoroughly**: Create clear migration guides
4. **Communicate Clearly**: Use multiple channels (email, dashboard, headers)
5. **Monitor Usage**: Track which clients are still using deprecated endpoints
6. **Be Flexible**: Extend sunset dates if migration is slow
7. **Support Users**: Provide migration assistance and examples

## Common Scenarios

### Scenario 1: Simple Endpoint Replacement

```typescript
// Old endpoint
GET /api/v1/users/:id

// New endpoint
GET /api/v2/users/:id

// Migration: Just update the URL
```

### Scenario 2: Endpoint Consolidation

```typescript
// Old endpoints
GET /api/v1/bookings
GET /api/v1/bookings/:id

// New endpoint
GET /api/v2/bookings?id=:id

// Migration: Combine into single endpoint with query params
```

### Scenario 3: Endpoint Removal (No Replacement)

```typescript
// Old endpoint
GET /api/v1/legacy-feature

// Migration: Remove client-side calls entirely
// Provide alternative feature or documentation
```

## Troubleshooting

### Issue: Clients Not Migrating

**Solution:**
- Increase notification frequency
- Provide code examples and SDKs
- Offer migration assistance
- Consider extending sunset date

### Issue: Unexpected Usage Spike

**Solution:**
- Investigate cause
- Provide additional support
- Consider extending sunset date
- Monitor for automated clients

### Issue: Breaking Changes in Replacement

**Solution:**
- Ensure replacement endpoint is fully compatible
- Provide detailed migration guide
- Offer gradual migration path
- Consider intermediate version

## References

- [RFC 8594 - Deprecation HTTP Header Field](https://tools.ietf.org/html/rfc8594)
- [RFC 7234 - HTTP Caching](https://tools.ietf.org/html/rfc7234)
- [API Versioning Guide](./API_VERSIONING.md)

## Support

For questions about the deprecation process:
- Email: api-support@mentorminds.com
- Slack: #api-support
- Documentation: https://docs.mentorminds.com/api
