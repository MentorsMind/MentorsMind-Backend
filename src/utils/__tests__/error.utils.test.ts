/**
 * Tests for Error Tracking Utility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { datadogLogs } from '@datadog/browser-logs';
import errorTracker, {
  logError,
  logWarning,
  logInfo,
  setUser,
  clearUser,
  addBreadcrumb,
} from '../error.utils';

// Mock Sentry
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((callback) => callback({ setLevel: vi.fn(), setContext: vi.fn() })),
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
  Integrations: {
    Http: vi.fn(),
    OnUncaughtException: vi.fn(),
    OnUnhandledRejection: vi.fn(),
  },
}));

// Mock DataDog
vi.mock('@datadog/browser-logs', () => ({
  datadogLogs: {
    init: vi.fn(),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    setUser: vi.fn(),
    clearUser: vi.fn(),
  },
}));

describe('Error Tracking Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize Sentry when DSN is provided', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      errorTracker.initialize();
      expect(Sentry.init).toHaveBeenCalled();
    });

    it('should initialize DataDog when client token is provided', () => {
      process.env.DATADOG_CLIENT_TOKEN = 'test-token';
      errorTracker.initialize();
      expect(datadogLogs.init).toHaveBeenCalled();
    });
  });

  describe('logError', () => {
    it('should log error with string message', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      logError('Test error message', 'medium');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log error with Error object', () => {
      const error = new Error('Test error');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      logError(error, 'high');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should send high severity errors to external services', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      const error = new Error('Critical error');
      logError(error, 'critical');
      expect(Sentry.captureException).toHaveBeenCalled();
    });

    it('should not send low severity errors to external services', () => {
      const error = new Error('Low priority error');
      logError(error, 'low');
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });

  describe('Sanitization', () => {
    it('should redact API tokens from error messages', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      const errorMessage = 'Failed with token: abc123xyz';
      logError(errorMessage, 'medium');
      
      const loggedMessage = consoleSpy.mock.calls[0][1];
      expect(loggedMessage).not.toContain('abc123xyz');
      consoleSpy.mockRestore();
    });

    it('should redact authorization headers from context', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      const context = {
        headers: {
          authorization: 'Bearer secret-token',
        },
      };
      
      logError('Test error', 'medium', context);
      const loggedContext = consoleSpy.mock.calls[0][2].context;
      expect(loggedContext.headers.authorization).toBe('[REDACTED]');
      consoleSpy.mockRestore();
    });

    it('should redact password fields from context', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      const context = {
        user: {
          username: 'testuser',
          password: 'secret123',
        },
      };
      
      logError('Test error', 'medium', context);
      const loggedContext = consoleSpy.mock.calls[0][2].context;
      expect(loggedContext.user.password).toBe('[REDACTED]');
      expect(loggedContext.user.username).toBe('testuser');
      consoleSpy.mockRestore();
    });

    it('should redact JWT tokens from strings', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      const errorMessage = 'Auth failed: jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
      logError(errorMessage, 'medium');
      
      const loggedMessage = consoleSpy.mock.calls[0][1];
      expect(loggedMessage).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      consoleSpy.mockRestore();
    });

    it('should handle nested objects with sensitive data', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      const context = {
        request: {
          body: {
            user: {
              apiKey: 'secret-key-123',
              name: 'John Doe',
            },
          },
        },
      };
      
      logError('Test error', 'medium', context);
      const loggedContext = consoleSpy.mock.calls[0][2].context;
      expect(loggedContext.request.body.user.apiKey).toBe('[REDACTED]');
      expect(loggedContext.request.body.user.name).toBe('John Doe');
      consoleSpy.mockRestore();
    });
  });

  describe('logWarning', () => {
    it('should log warning messages', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      logWarning('This is a warning');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('logInfo', () => {
    it('should log info messages', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation();
      logInfo('This is info');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('User Context', () => {
    it('should set user context in Sentry', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      const user = { id: '123', email: 'test@example.com', username: 'testuser' };
      setUser(user);
      expect(Sentry.setUser).toHaveBeenCalledWith(user);
    });

    it('should set user context in DataDog', () => {
      process.env.DATADOG_CLIENT_TOKEN = 'test-token';
      const user = { id: '123', email: 'test@example.com', username: 'testuser' };
      setUser(user);
      expect(datadogLogs.setUser).toHaveBeenCalled();
    });

    it('should clear user context', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      clearUser();
      expect(Sentry.setUser).toHaveBeenCalledWith(null);
    });
  });

  describe('Breadcrumbs', () => {
    it('should add breadcrumb to Sentry', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      addBreadcrumb('User clicked button', 'ui', { buttonId: 'submit' });
      expect(Sentry.addBreadcrumb).toHaveBeenCalled();
    });

    it('should sanitize breadcrumb data', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      const data = { apiKey: 'secret-123', action: 'click' };
      addBreadcrumb('API call', 'network', data);
      
      const call = (Sentry.addBreadcrumb as any).mock.calls[0][0];
      expect(call.data.apiKey).toBe('[REDACTED]');
      expect(call.data.action).toBe('click');
    });
  });

  describe('Severity Mapping', () => {
    it('should map low severity to info level', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      logError('Low priority', 'low');
      // Low severity should not trigger external services
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should map critical severity to fatal level', () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      logError('Critical error', 'critical');
      expect(Sentry.captureException).toHaveBeenCalled();
    });
  });
});
