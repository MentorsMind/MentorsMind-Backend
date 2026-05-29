/**
 * Error Tracking Utility
 * 
 * Handles error logging and reporting to external monitoring services
 * (Sentry, DataDog) with automatic sanitization of sensitive data.
 */

// Optional imports - will be undefined if packages not installed
let Sentry: any;
let datadogLogs: any;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sentry = require('@sentry/node');
} catch {
  // Sentry not installed
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const datadog = require('@datadog/browser-logs');
  datadogLogs = datadog.datadogLogs;
} catch {
  // DataDog not installed
}

interface ErrorContext {
  [key: string]: any;
}

interface ErrorTrackingConfig {
  sentryDsn?: string;
  datadogClientToken?: string;
  datadogSite?: string;
  environment: string;
  enableConsoleLogging: boolean;
}

// Sensitive patterns to strip from error data
const SENSITIVE_PATTERNS = [
  /authorization:\s*bearer\s+[\w-]+/gi,
  /api[_-]?key[:\s=]+[\w-]+/gi,
  /token[:\s=]+[\w-]+/gi,
  /password[:\s=]+[^\s&]+/gi,
  /secret[:\s=]+[\w-]+/gi,
  /access[_-]?token[:\s=]+[\w-]+/gi,
  /refresh[_-]?token[:\s=]+[\w-]+/gi,
  /jwt[:\s=]+[\w.-]+/gi,
  /bearer\s+[\w.-]+/gi,
];

// Headers that should be redacted
const SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
];

class ErrorTracker {
  private config: ErrorTrackingConfig;
  private initialized = false;

  constructor() {
    this.config = {
      sentryDsn: process.env.SENTRY_DSN,
      datadogClientToken: process.env.DATADOG_CLIENT_TOKEN,
      datadogSite: process.env.DATADOG_SITE || 'datadoghq.com',
      environment: process.env.NODE_ENV || 'development',
      enableConsoleLogging: process.env.NODE_ENV !== 'production',
    };
  }

  /**
   * Initialize error tracking services
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    // Initialize Sentry
    if (this.config.sentryDsn && Sentry) {
      Sentry.init({
        dsn: this.config.sentryDsn,
        environment: this.config.environment,
        tracesSampleRate: this.config.environment === 'production' ? 0.1 : 1.0,
        beforeSend: (event: any) => this.sanitizeEvent(event),
        integrations: [
          new Sentry.Integrations.Http({ tracing: true }),
          new Sentry.Integrations.OnUncaughtException(),
          new Sentry.Integrations.OnUnhandledRejection(),
        ],
      });
      console.log('✓ Sentry initialized');
    }

    // Initialize DataDog
    if (this.config.datadogClientToken && datadogLogs) {
      try {
        const ddConfig: any = {
          clientToken: this.config.datadogClientToken,
          site: this.config.datadogSite,
          env: this.config.environment,
          forwardErrorsToLogs: true,
          sessionSampleRate: 100,
        };
        datadogLogs.init(ddConfig);
        console.log('✓ DataDog initialized');
      } catch (error) {
        console.warn('DataDog initialization failed:', error);
      }
    }

    this.initialized = true;
  }

  /**
   * Sanitize Sentry event to remove sensitive data
   */
  private sanitizeEvent(event: any): any | null {
    // Sanitize request data
    if (event.request) {
      event.request = this.sanitizeRequest(event.request);
    }

    // Sanitize breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
        ...breadcrumb,
        data: this.sanitizeObject(breadcrumb.data || {}),
      }));
    }

    // Sanitize extra context
    if (event.extra) {
      event.extra = this.sanitizeObject(event.extra);
    }

    // Sanitize exception values
    if (event.exception?.values) {
      event.exception.values = event.exception.values.map((exception) => ({
        ...exception,
        value: this.sanitizeString(exception.value || ''),
      }));
    }

    return event;
  }

  /**
   * Sanitize DataDog log entry
   */
  private sanitizeDatadogLog(log: any): any {
    if (log.message) {
      log.message = this.sanitizeString(log.message);
    }

    if (log.context) {
      log.context = this.sanitizeObject(log.context);
    }

    return log;
  }

  /**
   * Sanitize request object
   */
  private sanitizeRequest(request: any): any {
    const sanitized = { ...request };

    // Sanitize headers
    if (sanitized.headers) {
      sanitized.headers = { ...sanitized.headers };
      SENSITIVE_HEADERS.forEach((header) => {
        const lowerHeader = header.toLowerCase();
        if (sanitized.headers[lowerHeader]) {
          sanitized.headers[lowerHeader] = '[REDACTED]';
        }
      });
    }

    // Sanitize query string
    if (sanitized.query_string) {
      sanitized.query_string = this.sanitizeString(sanitized.query_string);
    }

    // Sanitize cookies
    if (sanitized.cookies) {
      sanitized.cookies = '[REDACTED]';
    }

    // Sanitize data/body
    if (sanitized.data) {
      sanitized.data = this.sanitizeObject(sanitized.data);
    }

    return sanitized;
  }

  /**
   * Sanitize a string by removing sensitive patterns
   */
  private sanitizeString(str: string): string {
    let sanitized = str;
    SENSITIVE_PATTERNS.forEach((pattern) => {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    });
    return sanitized;
  }

  /**
   * Recursively sanitize an object
   */
  private sanitizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Redact sensitive keys
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('key') ||
        lowerKey.includes('authorization')
      ) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        sanitized[key] = this.sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Log an error with context
   */
  logError(
    error: Error | string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    context?: ErrorContext
  ): void {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    const sanitizedContext = context ? this.sanitizeObject(context) : {};

    // Console logging (development)
    if (this.config.enableConsoleLogging) {
      console.error(`[${severity.toUpperCase()}]`, errorObj.message, {
        stack: errorObj.stack,
        context: sanitizedContext,
      });
    }

    // Send to external services only for medium+ severity
    if (severity === 'medium' || severity === 'high' || severity === 'critical') {
      this.sendToExternalServices(errorObj, severity, sanitizedContext);
    }
  }

  /**
   * Send error to external tracking services
   */
  private sendToExternalServices(
    error: Error,
    severity: string,
    context: ErrorContext
  ): void {
    // Send to Sentry
    if (this.config.sentryDsn && Sentry) {
      Sentry.withScope((scope: any) => {
        scope.setLevel(this.mapSeverityToSentryLevel(severity));
        scope.setContext('additional', context);
        Sentry.captureException(error);
      });
    }

    // Send to DataDog
    if (this.config.datadogClientToken && datadogLogs) {
      datadogLogs.logger.error(error.message, {
        error: {
          stack: error.stack,
          message: error.message,
          name: error.name,
        },
        severity,
        ...context,
      });
    }
  }

  /**
   * Map severity to Sentry level
   */
  private mapSeverityToSentryLevel(severity: string): string {
    const mapping: Record<string, string> = {
      low: 'info',
      medium: 'warning',
      high: 'error',
      critical: 'fatal',
    };
    return mapping[severity] || 'error';
  }

  /**
   * Log a warning
   */
  logWarning(message: string, context?: ErrorContext): void {
    this.logError(new Error(message), 'low', context);
  }

  /**
   * Log an info message
   */
  logInfo(message: string, context?: ErrorContext): void {
    if (this.config.enableConsoleLogging) {
      console.info(`[INFO] ${message}`, context);
    }

    if (this.config.datadogClientToken && datadogLogs) {
      datadogLogs.logger.info(message, this.sanitizeObject(context || {}));
    }
  }

  /**
   * Set user context for error tracking
   */
  setUser(user: { id: string; email?: string; username?: string }): void {
    if (this.config.sentryDsn && Sentry) {
      Sentry.setUser({
        id: user.id,
        email: user.email,
        username: user.username,
      });
    }

    if (this.config.datadogClientToken && datadogLogs) {
      datadogLogs.setUser({
        id: user.id,
        email: user.email,
        name: user.username,
      });
    }
  }

  /**
   * Clear user context
   */
  clearUser(): void {
    if (this.config.sentryDsn && Sentry) {
      Sentry.setUser(null);
    }

    if (this.config.datadogClientToken && datadogLogs) {
      datadogLogs.clearUser();
    }
  }

  /**
   * Add breadcrumb for debugging
   */
  addBreadcrumb(message: string, category: string, data?: ErrorContext): void {
    const sanitizedData = data ? this.sanitizeObject(data) : undefined;

    if (this.config.sentryDsn && Sentry) {
      Sentry.addBreadcrumb({
        message,
        category,
        data: sanitizedData,
        level: 'info',
      });
    }

    if (this.config.datadogClientToken && datadogLogs) {
      datadogLogs.logger.info(`[Breadcrumb] ${category}: ${message}`, sanitizedData);
    }
  }
}

// Singleton instance
const errorTracker = new ErrorTracker();

// Auto-initialize
errorTracker.initialize();

// Export convenience functions
export const logError = (
  error: Error | string,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  context?: ErrorContext
) => errorTracker.logError(error, severity, context);

export const logWarning = (message: string, context?: ErrorContext) =>
  errorTracker.logWarning(message, context);

export const logInfo = (message: string, context?: ErrorContext) =>
  errorTracker.logInfo(message, context);

export const setUser = (user: { id: string; email?: string; username?: string }) =>
  errorTracker.setUser(user);

export const clearUser = () => errorTracker.clearUser();

export const addBreadcrumb = (message: string, category: string, data?: ErrorContext) =>
  errorTracker.addBreadcrumb(message, category, data);

export default errorTracker;
