# Error Tracking Implementation

This document describes the error tracking implementation for MentorMinds, including integration with Sentry and DataDog for comprehensive error monitoring and logging.

## Overview

The error tracking utility (`src/utils/error.utils.ts`) provides:

- Centralized error logging and reporting
- Integration with Sentry for error tracking
- Integration with DataDog for log management
- Automatic sanitization of sensitive data (API tokens, passwords, etc.)
- Severity-based error handling
- User context tracking
- Breadcrumb support for debugging

## Configuration

### Environment Variables

Add the following to your `.env` file:

```bash
# Sentry Configuration
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id

# DataDog Configuration
DATADOG_CLIENT_TOKEN=your-datadog-client-token
DATADOG_SITE=datadoghq.com  # or datadoghq.eu, us3.datadoghq.com, etc.

# Environment
NODE_ENV=production  # development | test | production
```

### Getting Credentials

#### Sentry
1. Sign up at [sentry.io](https://sentry.io)
2. Create a new project
3. Go to Settings > Projects > [Your Project] > Client Keys (DSN)
4. Copy the DSN and add it to your `.env` file

#### DataDog
1. Sign up at [datadoghq.com](https://www.datadoghq.com)
2. Go to Organization Settings > API Keys
3. Create a new Client Token
4. Copy the token and add it to your `.env` file

## Installation

Install the required dependencies:

```bash
npm install @sentry/node @datadog/browser-logs
```

## Usage

### Basic Error Logging

```typescript
import { logError, logWarning, logInfo } from './utils/error.utils';

// Log an error with severity
try {
  // Your code
} catch (error) {
  logError(error, 'high', {
    userId: user.id,
    action: 'payment_processing',
  });
}

// Log a warning
logWarning('API rate limit approaching', {
  currentRate: 95,
  limit: 100,
});

// Log info
logInfo('User logged in', {
  userId: user.id,
  method: 'oauth',
});
```

### Severity Levels

The utility supports four severity levels:

- `low`: Informational messages, not sent to external services
- `medium`: Warnings that should be tracked (default)
- `high`: Errors that need attention
- `critical`: Critical errors requiring immediate action

```typescript
logError(error, 'critical', context);  // Sent to Sentry/DataDog
logError(error, 'high', context);      // Sent to Sentry/DataDog
logError(error, 'medium', context);    // Sent to Sentry/DataDog
logError(error, 'low', context);       // Console only
```

### User Context

Track which user encountered an error:

```typescript
import { setUser, clearUser } from './utils/error.utils';

// Set user context (after login)
setUser({
  id: user.id,
  email: user.email,
  username: user.username,
});

// Clear user context (after logout)
clearUser();
```

### Breadcrumbs

Add breadcrumbs to track user actions leading to an error:

```typescript
import { addBreadcrumb } from './utils/error.utils';

// Track user actions
addBreadcrumb('User clicked checkout button', 'ui', {
  cartTotal: 99.99,
  itemCount: 3,
});

addBreadcrumb('API call to payment service', 'network', {
  endpoint: '/api/payments',
  method: 'POST',
});

// When an error occurs, breadcrumbs are automatically included
```

## Data Sanitization

The utility automatically sanitizes sensitive data before sending to external services:

### Automatically Redacted Patterns

- Authorization headers: `Authorization: Bearer token`
- API keys: `api_key=abc123`, `apiKey: xyz789`
- Tokens: `token=abc123`, `access_token=xyz789`
- Passwords: `password=secret123`
- JWT tokens: `jwt=eyJhbGci...`
- Secrets: `secret=abc123`

### Automatically Redacted Headers

- `authorization`
- `x-api-key`
- `x-auth-token`
- `cookie`
- `set-cookie`

### Automatically Redacted Object Keys

Any object key containing these terms (case-insensitive):
- `password`
- `token`
- `secret`
- `key`
- `authorization`

### Example

```typescript
// Original error context
const context = {
  user: {
    username: 'john',
    password: 'secret123',  // Will be redacted
  },
  headers: {
    authorization: 'Bearer abc123',  // Will be redacted
    'content-type': 'application/json',  // Preserved
  },
  apiKey: 'xyz789',  // Will be redacted
};

logError(error, 'high', context);

// Sent to Sentry/DataDog:
// {
//   user: {
//     username: 'john',
//     password: '[REDACTED]',
//   },
//   headers: {
//     authorization: '[REDACTED]',
//     'content-type': 'application/json',
//   },
//   apiKey: '[REDACTED]',
// }
```

## Integration Examples

### Express Middleware

```typescript
import { logError, setUser } from './utils/error.utils';

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logError(err, 'high', {
    method: req.method,
    url: req.url,
    userId: req.user?.id,
    ip: req.ip,
  });

  res.status(500).json({ error: 'Internal server error' });
});

// Authentication middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.user) {
    setUser({
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
    });
  }
  next();
});
```

### Async Error Handling

```typescript
import { logError, addBreadcrumb } from './utils/error.utils';

async function processPayment(paymentData: PaymentData) {
  try {
    addBreadcrumb('Starting payment processing', 'payment', {
      amount: paymentData.amount,
      currency: paymentData.currency,
    });

    const result = await paymentService.process(paymentData);

    addBreadcrumb('Payment processed successfully', 'payment', {
      transactionId: result.id,
    });

    return result;
  } catch (error) {
    logError(error, 'critical', {
      paymentAmount: paymentData.amount,
      paymentMethod: paymentData.method,
      userId: paymentData.userId,
    });
    throw error;
  }
}
```

### React Error Boundary

```typescript
import React from 'react';
import { logError } from './utils/error.utils';

class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logError(error, 'high', {
      componentStack: errorInfo.componentStack,
      errorBoundary: this.constructor.name,
    });
  }

  render() {
    return this.props.children;
  }
}
```

## Testing

Run the test suite:

```bash
npm test src/utils/__tests__/error.utils.test.ts
```

The tests verify:
- Initialization of Sentry and DataDog
- Error logging with different severity levels
- Data sanitization (tokens, passwords, headers)
- User context management
- Breadcrumb tracking

## Best Practices

1. **Use appropriate severity levels**: Reserve `critical` for errors requiring immediate attention
2. **Include context**: Always provide relevant context to help debug issues
3. **Set user context**: Call `setUser()` after authentication to track which users encounter errors
4. **Add breadcrumbs**: Track user actions leading to errors for better debugging
5. **Don't log sensitive data**: The utility sanitizes common patterns, but avoid logging sensitive data when possible
6. **Test in development**: Set `NODE_ENV=development` to see console logs without sending to external services

## Monitoring Dashboards

### Sentry
- View errors at: `https://sentry.io/organizations/[org]/issues/`
- Set up alerts for critical errors
- Review error trends and patterns

### DataDog
- View logs at: `https://app.datadoghq.com/logs`
- Create custom dashboards for error metrics
- Set up monitors for error rate thresholds

## Troubleshooting

### Errors not appearing in Sentry/DataDog

1. Verify environment variables are set correctly
2. Check that DSN/token is valid
3. Ensure severity is `medium` or higher
4. Check network connectivity to external services
5. Review console logs for initialization messages

### Too many errors being logged

1. Adjust severity levels (use `low` for non-critical issues)
2. Implement error deduplication in your code
3. Configure Sentry sample rates in `error.utils.ts`

### Sensitive data still appearing

1. Review the sanitization patterns in `error.utils.ts`
2. Add custom patterns to `SENSITIVE_PATTERNS` array
3. Add custom headers to `SENSITIVE_HEADERS` array
4. Avoid logging sensitive data in error messages

## Future Enhancements

- [ ] Add support for custom error types
- [ ] Implement error rate limiting
- [ ] Add performance monitoring integration
- [ ] Create custom error dashboards
- [ ] Add error grouping and deduplication
- [ ] Implement error notification webhooks
