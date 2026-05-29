/**
 * Error Tracking Usage Examples
 * 
 * This file demonstrates how to use the error tracking utility
 * in various scenarios throughout the application.
 */

import {
  logError,
  logWarning,
  logInfo,
  setUser,
  clearUser,
  addBreadcrumb,
} from '../utils/error.utils';

// Type definitions for examples
type Request = any;
type Response = any;
type NextFunction = any;

// ============================================================================
// Example 1: Basic Error Logging
// ============================================================================

export function basicErrorExample() {
  try {
    // Some operation that might fail
    throw new Error('Something went wrong');
  } catch (error) {
    // Log with medium severity (default)
    logError(error as Error, 'medium');
  }
}

// ============================================================================
// Example 2: Error with Context
// ============================================================================

export async function errorWithContextExample(userId: string, bookingId: string) {
  try {
    // Attempt to process booking
    await processBooking(bookingId);
  } catch (error) {
    // Log with context for better debugging
    logError(error as Error, 'high', {
      userId,
      bookingId,
      operation: 'processBooking',
      timestamp: new Date().toISOString(),
    });
  }
}

// ============================================================================
// Example 3: Different Severity Levels
// ============================================================================

export function severityLevelsExample() {
  // Low severity - informational, not sent to external services
  logError('Minor issue occurred', 'low', { component: 'cache' });

  // Medium severity - warnings that should be tracked
  logError('API rate limit approaching', 'medium', { currentRate: 95 });

  // High severity - errors that need attention
  logError(new Error('Payment processing failed'), 'high', {
    paymentId: 'pay_123',
  });

  // Critical severity - requires immediate action
  logError(new Error('Database connection lost'), 'critical', {
    database: 'primary',
    connectionPool: 'exhausted',
  });
}

// ============================================================================
// Example 4: Express Middleware Integration
// ============================================================================

export function errorHandlingMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Log the error with request context
  logError(err, 'high', {
    method: req.method,
    url: req.url,
    userId: (req as any).user?.id,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Send response
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}

// ============================================================================
// Example 5: User Context Tracking
// ============================================================================

export function authenticationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const user = (req as any).user;

  if (user) {
    // Set user context for error tracking
    setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  }

  next();
}

export function logoutHandler(req: Request, res: Response) {
  // Clear user context on logout
  clearUser();

  res.json({ message: 'Logged out successfully' });
}

// ============================================================================
// Example 6: Breadcrumbs for Debugging
// ============================================================================

export async function paymentFlowWithBreadcrumbs(paymentData: any) {
  try {
    // Track user action
    addBreadcrumb('User initiated payment', 'payment', {
      amount: paymentData.amount,
      currency: paymentData.currency,
    });

    // Validate payment data
    const validatedData = validatePaymentData(paymentData);
    addBreadcrumb('Payment data validated', 'payment', {
      paymentMethod: validatedData.method,
    });

    // Process payment
    const result = await processPayment(validatedData);
    addBreadcrumb('Payment processed successfully', 'payment', {
      transactionId: result.id,
      status: result.status,
    });

    return result;
  } catch (error) {
    // Error will include all breadcrumbs for debugging
    logError(error as Error, 'critical', {
      paymentAmount: paymentData.amount,
      userId: paymentData.userId,
    });
    throw error;
  }
}

// ============================================================================
// Example 7: Service Layer Error Handling
// ============================================================================

export class BookingService {
  async createBooking(bookingData: any) {
    addBreadcrumb('Creating booking', 'booking', {
      mentorId: bookingData.mentorId,
      sessionDate: bookingData.sessionDate,
    });

    try {
      // Validate booking
      const validated = await this.validateBooking(bookingData);

      // Check availability
      const isAvailable = await this.checkAvailability(validated);
      if (!isAvailable) {
        throw new Error('Time slot not available');
      }

      // Create booking
      const booking = await this.saveBooking(validated);

      addBreadcrumb('Booking created successfully', 'booking', {
        bookingId: booking.id,
      });

      return booking;
    } catch (error) {
      logError(error as Error, 'high', {
        service: 'BookingService',
        method: 'createBooking',
        bookingData: {
          mentorId: bookingData.mentorId,
          sessionDate: bookingData.sessionDate,
          // Don't log sensitive data
        },
      });
      throw error;
    }
  }

  private async validateBooking(data: any) {
    // Implementation
    return data;
  }

  private async checkAvailability(data: any) {
    // Implementation
    return true;
  }

  private async saveBooking(data: any) {
    // Implementation
    return { id: '123', ...data };
  }
}

// ============================================================================
// Example 8: Async Error Handling
// ============================================================================

export async function asyncOperationExample() {
  try {
    const result = await Promise.all([
      fetchUserData(),
      fetchBookingData(),
      fetchPaymentData(),
    ]);

    return result;
  } catch (error) {
    logError(error as Error, 'high', {
      operation: 'parallelDataFetch',
      operations: ['user', 'booking', 'payment'],
    });
    throw error;
  }
}

// ============================================================================
// Example 9: Warning and Info Logging
// ============================================================================

export function warningAndInfoExample() {
  // Log a warning
  logWarning('Cache miss rate is high', {
    missRate: 0.75,
    threshold: 0.5,
  });

  // Log informational message
  logInfo('User completed onboarding', {
    userId: 'user_123',
    completionTime: '2m 30s',
  });
}

// ============================================================================
// Example 10: Database Error Handling
// ============================================================================

export async function databaseOperationExample(query: string, params: any[]) {
  try {
    addBreadcrumb('Executing database query', 'database', {
      queryType: query.split(' ')[0], // SELECT, INSERT, etc.
    });

    const result = await executeQuery(query, params);

    return result;
  } catch (error) {
    const dbError = error as any;

    // Determine severity based on error type
    const severity = dbError.code === 'ECONNREFUSED' ? 'critical' : 'high';

    logError(dbError, severity, {
      errorCode: dbError.code,
      queryType: query.split(' ')[0],
      // Don't log the full query or params (might contain sensitive data)
    });

    throw error;
  }
}

// ============================================================================
// Example 11: API Integration Error Handling
// ============================================================================

export async function externalApiCallExample(endpoint: string, data: any) {
  try {
    addBreadcrumb('Calling external API', 'api', {
      endpoint,
      method: 'POST',
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status}`);
    }

    const result = await response.json();

    addBreadcrumb('API call successful', 'api', {
      endpoint,
      status: response.status,
    });

    return result;
  } catch (error) {
    logError(error as Error, 'high', {
      endpoint,
      operation: 'externalApiCall',
      // API tokens are automatically sanitized
    });
    throw error;
  }
}

// ============================================================================
// Example 12: Validation Error Handling
// ============================================================================

export function validationErrorExample(data: any) {
  try {
    if (!data.email) {
      throw new Error('Email is required');
    }

    if (!data.email.includes('@')) {
      throw new Error('Invalid email format');
    }

    return true;
  } catch (error) {
    // Validation errors are typically low severity
    logError(error as Error, 'low', {
      validationType: 'email',
      providedValue: data.email ? '[REDACTED]' : 'undefined',
    });
    throw error;
  }
}

// ============================================================================
// Helper Functions (for examples)
// ============================================================================

async function processBooking(bookingId: string) {
  // Mock implementation
  return { id: bookingId, status: 'confirmed' };
}

async function processPayment(data: any) {
  // Mock implementation
  return { id: 'pay_123', status: 'completed' };
}

function validatePaymentData(data: any) {
  // Mock implementation
  return data;
}

async function fetchUserData() {
  // Mock implementation
  return { id: 'user_123' };
}

async function fetchBookingData() {
  // Mock implementation
  return { id: 'booking_123' };
}

async function fetchPaymentData() {
  // Mock implementation
  return { id: 'payment_123' };
}

async function executeQuery(query: string, params: any[]) {
  // Mock implementation
  return [];
}
