# API Deprecation Implementation Guide

This guide provides step-by-step instructions for implementing the API deprecation process in your application.

## Quick Start

### 1. Initialize Deprecation System

In your main application file (`src/app.ts` or `src/bootstrap.ts`):

```typescript
import { initializeDeprecationRegistry } from './config/deprecation-registry';
import deprecationMaintenanceJob from './jobs/deprecation-maintenance.job';

// Initialize deprecation registry
initializeDeprecationRegistry();

// Start maintenance jobs
deprecationMaintenanceJob.initialize();
```

### 2. Register Deprecated Endpoints

In `src/config/deprecation-registry.ts`, add your deprecated endpoints:

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

### 3. Apply Middleware to Routes

In your route files:

```typescript
import { deprecationMiddleware } from '../middleware/deprecation.middleware';

// Apply to deprecated endpoint
router.get('/api/v1/users/:id', deprecationMiddleware, userController.getUser);

// Or apply to entire router
router.use(deprecationMiddleware);
```

### 4. Set Up Admin Routes

In your main app file:

```typescript
import deprecationRoutes from './routes/admin/deprecation.routes';

app.use('/admin', deprecationRoutes);
```

## Detailed Implementation

### Step 1: Create Migration Guide

Create a migration guide document for each deprecated endpoint:

```markdown
# Migration Guide: v1 to v2 Users API

## Overview
The v1 Users API is being deprecated in favor of the v2 API.

## Timeline
- **Deprecated**: January 1, 2024
- **Sunset**: July 1, 2024

## Changes
- Endpoint: `GET /api/v1/users/:id` → `GET /api/v2/users/:id`
- Response structure updated with new fields

## Migration Steps
1. Update endpoint URL
2. Update response parsing
3. Test in staging
4. Deploy to production

## Support
Contact: api-support@mentorminds.com
```

### Step 2: Register Endpoint

```typescript
// In src/config/deprecation-registry.ts
deprecationManager.registerDeprecation(
  createDeprecationConfig('GET /api/v1/users/:id', {
    replacementEndpoint: 'GET /api/v2/users/:id',
    migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2-users',
    reason: 'Improved performance and data structure',
    sunsetMonths: 6,
  })
);
```

### Step 3: Apply Middleware

```typescript
// In your route file
import { deprecationMiddleware } from '../middleware/deprecation.middleware';

router.get(
  '/api/v1/users/:id',
  deprecationMiddleware,
  userController.getUser
);
```

### Step 4: Notify Users

```typescript
import deprecationNotificationService from '../services/deprecation-notification.service';

// Send notifications
const recipients = [
  { userId: '1', email: 'user@example.com', name: 'John Doe' },
  // ... more users
];

const notification = {
  endpoint: 'GET /api/v1/users/:id',
  sunsetDate: new Date('2024-07-01'),
  replacementEndpoint: 'GET /api/v2/users/:id',
  migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2-users',
  daysUntilSunset: 180,
};

await deprecationNotificationService.notifyUsers(recipients, notification);
```

### Step 5: Monitor Progress

Use admin endpoints to track migration:

```bash
# Get all deprecated endpoints
curl http://localhost:5000/admin/deprecations

# Get upcoming sunsets
curl http://localhost:5000/admin/deprecations/upcoming

# Get migration progress
curl http://localhost:5000/admin/deprecations/report/migration-progress
```

## Middleware Options

### Basic Deprecation Middleware

Adds deprecation headers to responses:

```typescript
router.get('/api/v1/users/:id', deprecationMiddleware, handler);
```

### Sunset Warning Middleware

Logs warnings for endpoints about to sunset:

```typescript
router.get('/api/v1/users/:id', sunsetWarningMiddleware, handler);
```

### Deprecation Tracking Middleware

Tracks deprecated endpoint usage:

```typescript
router.get('/api/v1/users/:id', deprecationTrackingMiddleware, handler);
```

### Strict Deprecation Middleware

Returns 410 Gone for endpoints within 7 days of sunset:

```typescript
router.get('/api/v1/users/:id', strictDeprecationMiddleware, handler);
```

### Deprecation Info Middleware

Adds deprecation info to request object:

```typescript
router.get('/api/v1/users/:id', deprecationInfoMiddleware, (req, res) => {
  if ((req as any).deprecation) {
    console.log('Endpoint is deprecated:', (req as any).deprecation);
  }
  // ... handler logic
});
```

## Admin API Endpoints

### Get All Deprecated Endpoints

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

### Get Upcoming Sunsets

```bash
GET /admin/deprecations/upcoming
```

### Get Sunset Endpoints

```bash
GET /admin/deprecations/sunset
```

### Get Specific Endpoint

```bash
GET /admin/deprecations/GET%20%2Fapi%2Fv1%2Fusers%2F%3Aid
```

### Register New Deprecation

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

### Remove Deprecation

```bash
DELETE /admin/deprecations/GET%20%2Fapi%2Fv1%2Fusers%2F%3Aid
```

Only allowed after sunset date.

### Get Migration Progress

```bash
GET /admin/deprecations/report/migration-progress
```

### Get Deprecation Timeline

```bash
GET /admin/deprecations/report/timeline
```

## Scheduled Jobs

The deprecation system includes automated jobs:

### Daily Metrics Job (2 AM UTC)
- Logs deprecation metrics
- Tracks deprecated endpoint count
- Monitors sunset dates

### Weekly Notification Job (Monday 9 AM UTC)
- Sends notifications for upcoming sunsets
- Targets endpoints within 30 days of sunset

### Final Warning Job (Daily 10 AM UTC)
- Sends final warnings for endpoints within 7 days of sunset
- Escalates notification frequency

### Sunset Cleanup Job (Daily 3 AM UTC)
- Cleans up sunset endpoints
- Archives endpoint configuration
- Logs removal events

## Client-Side Integration

### Detect Deprecation Headers

```javascript
fetch('/api/v1/users/123')
  .then(response => {
    if (response.headers.get('Deprecation') === 'true') {
      const sunsetDate = response.headers.get('Sunset');
      const migrationGuide = response.headers.get('X-API-Migration-Guide');
      
      console.warn(`Endpoint deprecated. Sunset: ${sunsetDate}`);
      console.warn(`Migration guide: ${migrationGuide}`);
    }
    return response.json();
  });
```

### Handle 410 Gone

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

### SDK Integration

```typescript
// In your SDK
class APIClient {
  async request(endpoint: string, options: any) {
    const response = await fetch(endpoint, options);
    
    // Check for deprecation
    if (response.headers.get('Deprecation') === 'true') {
      this.handleDeprecation({
        endpoint,
        sunsetDate: response.headers.get('Sunset'),
        replacementEndpoint: response.headers.get('Link'),
        migrationGuide: response.headers.get('X-API-Migration-Guide'),
      });
    }
    
    // Handle 410 Gone
    if (response.status === 410) {
      throw new EndpointRemovedError(
        `Endpoint ${endpoint} has been removed`,
        response.json()
      );
    }
    
    return response.json();
  }
  
  private handleDeprecation(info: any) {
    // Log warning, emit event, etc.
    console.warn('Deprecated endpoint used:', info);
  }
}
```

## Testing

### Unit Tests

```typescript
import { describe, it, expect } from 'vitest';
import deprecationManager from '../utils/deprecation.utils';

describe('Deprecation', () => {
  it('should register deprecated endpoint', () => {
    const config = createDeprecationConfig('GET /api/v1/users/:id', {
      sunsetMonths: 6,
    });
    
    deprecationManager.registerDeprecation(config);
    expect(deprecationManager.isDeprecated('GET /api/v1/users/:id')).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe('Deprecation Middleware', () => {
  it('should add deprecation headers', async () => {
    const response = await request(app)
      .get('/api/v1/users/123')
      .expect(200);
    
    expect(response.headers['deprecation']).toBe('true');
    expect(response.headers['sunset']).toBeDefined();
  });
  
  it('should return 410 for sunset endpoints', async () => {
    const response = await request(app)
      .get('/api/v1/users/123')
      .expect(410);
    
    expect(response.body.error).toBe('Gone');
  });
});
```

## Troubleshooting

### Issue: Deprecation headers not appearing

**Solution:**
1. Verify middleware is applied to route
2. Check deprecation registry initialization
3. Ensure endpoint name matches exactly

### Issue: Notifications not sending

**Solution:**
1. Check email service configuration
2. Verify recipient list is populated
3. Check job logs for errors

### Issue: Clients not migrating

**Solution:**
1. Increase notification frequency
2. Provide code examples
3. Offer migration assistance
4. Consider extending sunset date

## Best Practices

1. **Plan Ahead**: Announce deprecations 6+ months in advance
2. **Provide Alternatives**: Always have a replacement endpoint
3. **Document Thoroughly**: Create clear migration guides
4. **Communicate Clearly**: Use multiple notification channels
5. **Monitor Usage**: Track migration progress
6. **Be Flexible**: Extend sunset dates if needed
7. **Support Users**: Provide migration assistance

## References

- [API Deprecation Documentation](./API_DEPRECATION.md)
- [RFC 8594 - Deprecation HTTP Header](https://tools.ietf.org/html/rfc8594)
- [RFC 7234 - HTTP Caching](https://tools.ietf.org/html/rfc7234)
