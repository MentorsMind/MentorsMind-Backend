# Error Tracking Migration Guide

This guide helps you migrate from console-only error logging to integrated error tracking with Sentry and DataDog.

## Prerequisites

- Node.js 16+ installed
- Access to Sentry and/or DataDog accounts
- Environment variables configured

## Installation Steps

### 1. Install Dependencies

The Sentry package is already installed. Add DataDog:

```bash
npm install @datadog/browser-logs
```

Or for frontend projects:

```bash
npm install @datadog/browser-logs
# or
yarn add @datadog/browser-logs
```

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# Sentry (already configured)
SENTRY_DSN=https://your-key@o123456.ingest.sentry.io/123456

# DataDog (new)
DATADOG_CLIENT_TOKEN=pub1234567890abcdef1234567890abcd
DATADOG_SITE=datadoghq.com

# Environment
NODE_ENV=production
```

### 3. Update Existing Error Handling

#### Before (Console Only)

```typescript
// Old approach
try {
  await riskyOperation();
} catch (error) {
  console.error('Operation failed:', error);
}
```

#### After (With Error Tracking)

```typescript
import { logError } from './utils/error.utils';

try {
  await riskyOperation();
} catch (error) {
  logError(error, 'high', {
    operation: 'riskyOperation',
    userId: user.id,
  });
}
```

### 4. Replace Console Statements

Use this search and replace pattern:

#### Find console.error statements

```bash
# Search for console.error in your codebase
grep -r "console.error" src/
```

#### Replace with logError

```typescript
// Before
console.error('Payment failed:', error);

// After
import { logError } from './utils/error.utils';
logError(error, 'high', { context: 'payment' });
```

#### Find console.warn statements

```typescript
// Before
console.warn('Rate limit approaching');

// After
import { logWarning } from './utils/error.utils';
logWarning('Rate limit approaching', { currentRate: 95 });
```

## Migration Checklist

### Phase 1: Setup (Day 1)

- [ ] Install `@datadog/browser-logs` package
- [ ] Add environment variables to `.env` and `.env.example`
- [ ] Verify Sentry DSN is configured
- [ ] Obtain DataDog client token
- [ ] Test error utility initialization

### Phase 2: Core Integration (Days 2-3)

- [ ] Import error utility in main application file
- [ ] Add error boundary/middleware for global error handling
- [ ] Set up user context tracking in authentication flow
- [ ] Test error reporting in development environment

### Phase 3: Code Migration (Days 4-7)

- [ ] Identify all `console.error` statements
- [ ] Replace with `logError` calls
- [ ] Identify all `console.warn` statements
- [ ] Replace with `logWarning` calls
- [ ] Add appropriate severity levels
- [ ] Include relevant context data

### Phase 4: Testing (Days 8-9)

- [ ] Run test suite to verify no regressions
- [ ] Test error reporting in staging environment
- [ ] Verify errors appear in Sentry dashboard
- [ ] Verify logs appear in DataDog dashboard
- [ ] Test data sanitization (check no tokens/passwords logged)

### Phase 5: Monitoring Setup (Day 10)

- [ ] Create Sentry alerts for critical errors
- [ ] Set up DataDog monitors for error rates
- [ ] Configure notification channels (Slack, email, etc.)
- [ ] Create error dashboards
- [ ] Document monitoring procedures

## Code Examples

### Express Application

```typescript
// src/app.ts
import express from 'express';
import errorTracker, { logError, setUser } from './utils/error.utils';

const app = express();

// Initialize error tracking
errorTracker.initialize();

// Authentication middleware - set user context
app.use((req, res, next) => {
  if (req.user) {
    setUser({
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
    });
  }
  next();
});

// Your routes here
app.use('/api', apiRoutes);

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logError(err, 'high', {
    method: req.method,
    url: req.url,
    userId: req.user?.id,
    ip: req.ip,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

export default app;
```

### Service Layer

```typescript
// src/services/payment.service.ts
import { logError, addBreadcrumb } from '../utils/error.utils';

export class PaymentService {
  async processPayment(paymentData: PaymentData) {
    addBreadcrumb('Starting payment processing', 'payment', {
      amount: paymentData.amount,
      currency: paymentData.currency,
    });

    try {
      const result = await this.stellarService.createPayment(paymentData);
      
      addBreadcrumb('Payment processed successfully', 'payment', {
        transactionId: result.id,
      });

      return result;
    } catch (error) {
      logError(error, 'critical', {
        paymentAmount: paymentData.amount,
        userId: paymentData.userId,
        service: 'PaymentService',
      });
      throw error;
    }
  }
}
```

### Controller Layer

```typescript
// src/controllers/booking.controller.ts
import { Request, Response } from 'express';
import { logError, addBreadcrumb } from '../utils/error.utils';

export class BookingController {
  async createBooking(req: Request, res: Response) {
    try {
      addBreadcrumb('Creating booking', 'booking', {
        mentorId: req.body.mentorId,
        sessionDate: req.body.sessionDate,
      });

      const booking = await this.bookingService.create(req.body);
      
      res.status(201).json(booking);
    } catch (error) {
      logError(error, 'high', {
        userId: req.user.id,
        action: 'createBooking',
        requestBody: req.body,
      });

      res.status(500).json({ error: 'Failed to create booking' });
    }
  }
}
```

## Testing Your Implementation

### 1. Test Error Logging

```typescript
// Test file: src/utils/__tests__/error-tracking.integration.test.ts
import { logError, logWarning, logInfo } from '../error.utils';

describe('Error Tracking Integration', () => {
  it('should log errors without throwing', () => {
    expect(() => {
      logError(new Error('Test error'), 'medium');
    }).not.toThrow();
  });

  it('should handle string errors', () => {
    expect(() => {
      logError('String error message', 'high');
    }).not.toThrow();
  });
});
```

### 2. Verify Sentry Integration

1. Trigger a test error in your application
2. Check Sentry dashboard at `https://sentry.io/organizations/[org]/issues/`
3. Verify error appears with correct context and stack trace
4. Confirm sensitive data is redacted

### 3. Verify DataDog Integration

1. Trigger a test error in your application
2. Check DataDog logs at `https://app.datadoghq.com/logs`
3. Search for your error message
4. Verify log includes context and severity
5. Confirm sensitive data is redacted

## Rollback Plan

If you need to rollback:

1. Remove error tracking imports:
```bash
git diff HEAD~1 HEAD -- "*.ts" | grep "import.*error.utils" | wc -l
```

2. Revert to console logging:
```bash
git revert <commit-hash>
```

3. Remove environment variables from `.env`

4. Optionally uninstall packages:
```bash
npm uninstall @datadog/browser-logs
```

## Common Issues

### Issue: Errors not appearing in Sentry

**Solution:**
- Verify `SENTRY_DSN` is set correctly
- Check network connectivity
- Ensure severity is `medium` or higher
- Check Sentry project settings

### Issue: Too many errors being logged

**Solution:**
- Adjust severity levels (use `low` for non-critical)
- Implement error deduplication
- Configure Sentry sample rates

### Issue: Sensitive data in error logs

**Solution:**
- Review sanitization patterns in `error.utils.ts`
- Add custom patterns to `SENSITIVE_PATTERNS`
- Avoid logging sensitive data in error messages

### Issue: Performance impact

**Solution:**
- Use async error reporting (already implemented)
- Adjust Sentry sample rates
- Implement error batching for high-volume applications

## Performance Considerations

The error tracking utility is designed for minimal performance impact:

- Async error reporting (non-blocking)
- Automatic sanitization (runs before sending)
- Configurable sample rates
- Development mode skips external services

Expected overhead:
- < 1ms for console logging
- < 5ms for external service reporting
- < 10ms for complex sanitization

## Support

For issues or questions:

1. Check the [ERROR_TRACKING.md](./ERROR_TRACKING.md) documentation
2. Review test files in `src/utils/__tests__/`
3. Contact the development team
4. Check Sentry/DataDog documentation

## Next Steps

After migration:

1. Monitor error rates in dashboards
2. Set up alerts for critical errors
3. Review and categorize common errors
4. Implement fixes for recurring issues
5. Optimize error handling based on insights
