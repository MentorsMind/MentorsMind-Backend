import request from 'supertest';
import { describe, it, expect, afterAll, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mocks – these run before any imports so the app loads mocked modules.
// ---------------------------------------------------------------------------

const mockQuery = jest.fn();
const mockConnect = jest.fn();
let mockPassportError: any = null;
let mockPassportUser: any = null;

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: {
    query: (...args: any[]) => mockQuery(...args),
    connect: (...args: any[]) => mockConnect(...args),
    on: jest.fn(),
  },
}));

jest.mock('../../../src/config/passport', () => {
  class MockEmailRequiredError extends Error {
    constructor() {
      super('Email required');
      this.name = 'EmailRequiredError';
    }
  }

  const mockAuthenticate = jest.fn(
    (_strategy: string, _options: any, cb?: any) => {
      return (_req: any, _res: any) => {
        if (cb) {
          cb(mockPassportError, mockPassportUser);
        }
      };
    },
  );

  return {
    __esModule: true,
    default: {
      authenticate: mockAuthenticate,
      serializeUser: jest.fn(),
      deserializeUser: jest.fn(),
    },
    EmailRequiredError: MockEmailRequiredError,
  };
});

// Stub TokenService.issueTokens to return deterministic tokens
const mockIssueTokens = jest.fn();
jest.mock('../../../src/services/token.service', () => ({
  TokenService: {
    issueTokens: (...args: any[]) => mockIssueTokens(...args),
  },
}));

// Stub AuditLogService.log to avoid DB writes
jest.mock('../../../src/services/auditLog.service', () => ({
  AuditLogService: {
    log: jest.fn().mockResolvedValue(undefined),
  },
  extractIpAddress: jest.fn().mockReturnValue('127.0.0.1'),
}));

// Suppress logger output during tests
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports – modules now use the mocks above.
// ---------------------------------------------------------------------------
import app from '../../../src/app';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const FRONTEND_URL = 'http://localhost:3000';

function setupExistingUser() {
  mockPassportError = null;
  mockPassportUser = { userId: 'existing-user-uuid', isNew: false };

  mockQuery.mockResolvedValue({
    rows: [
      {
        email: 'existing@example.com',
        role: 'mentee',
        user_tier: 'free',
      },
    ],
    rowCount: 1,
  });

  mockIssueTokens.mockResolvedValue({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  });
}

function setupNewUser() {
  mockPassportError = null;
  mockPassportUser = { userId: 'new-user-uuid', isNew: true };

  mockQuery.mockResolvedValue({
    rows: [
      {
        email: 'newuser@example.com',
        role: 'mentee',
        user_tier: 'free',
      },
    ],
    rowCount: 1,
  });

  mockIssueTokens.mockResolvedValue({
    accessToken: 'mock-access-token-new',
    refreshToken: 'mock-refresh-token-new',
  });
}

function setupPassportError(errorMessage: string) {
  mockPassportError = new Error(errorMessage);
  mockPassportUser = null;
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
}

function setupEmptyUser() {
  mockPassportError = null;
  mockPassportUser = null;
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
}

function setupEmailRequiredError() {
  // Use require to get the same EmailRequiredError class the controller uses
  const passportMock = require('../../../src/config/passport');
  mockPassportError = new passportMock.EmailRequiredError();
  mockPassportUser = null;
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuth callback flow', () => {
  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/v1/auth/google/callback', () => {
    it('redirects to callback URL with access_token and refresh_token for existing user', async () => {
      setupExistingUser();

      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/callback`);
      expect(location).toContain('access_token=mock-access-token');
      expect(location).toContain('refresh_token=mock-refresh-token');
      expect(location).toContain('provider=google');

      // Verify TokenService was called with correct args
      expect(mockIssueTokens).toHaveBeenCalledWith(
        'existing-user-uuid',
        'existing@example.com',
        'mentee',
        'free',
      );
    });

    it('redirects to callback URL with tokens when a new user is created', async () => {
      setupNewUser();

      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/callback`);
      expect(location).toContain('access_token=mock-access-token-new');
      expect(location).toContain('refresh_token=mock-refresh-token-new');
      expect(location).toContain('provider=google');
    });

    it('redirects to error page when passport returns an error', async () => {
      setupPassportError('OAuth verification failed');

      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/error`);
      expect(location).toContain('provider=google');
      expect(location).not.toContain('access_token');
    });

    it('redirects to error page with email_required when EmailRequiredError is thrown', async () => {
      setupEmailRequiredError();

      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/error`);
      expect(location).toContain('provider=google');
      expect(location).toContain('error=email_required');
    });

    it('redirects to error page when user is not returned by Passport', async () => {
      setupEmptyUser();

      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/error`);
      expect(location).toContain('provider=google');
    });

    it('redirects to error page when user is not found in the database', async () => {
      mockPassportError = null;
      mockPassportUser = { userId: 'unknown-user', isNew: false };
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/error`);
      expect(location).toContain('provider=google');
    });
  });

  describe('GET /api/v1/auth/github/callback', () => {
    it('redirects to callback URL with tokens for existing user', async () => {
      setupExistingUser();

      const res = await request(app)
        .get('/api/v1/auth/github/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/callback`);
      expect(location).toContain('access_token=mock-access-token');
      expect(location).toContain('refresh_token=mock-refresh-token');
      expect(location).toContain('provider=github');
    });

    it('redirects to error page when passport returns an error', async () => {
      setupPassportError('GitHub auth failed');

      const res = await request(app)
        .get('/api/v1/auth/github/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/error`);
      expect(location).toContain('provider=github');
    });

    it('redirects to error page with email_required for GitHub', async () => {
      setupEmailRequiredError();

      const res = await request(app)
        .get('/api/v1/auth/github/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/error`);
      expect(location).toContain('provider=github');
      expect(location).toContain('error=email_required');
    });
  });

  describe('GET /api/v1/auth/linkedin/callback', () => {
    it('redirects to callback URL with tokens for existing user', async () => {
      setupExistingUser();

      const res = await request(app)
        .get('/api/v1/auth/linkedin/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/callback`);
      expect(location).toContain('access_token=mock-access-token');
      expect(location).toContain('refresh_token=mock-refresh-token');
      expect(location).toContain('provider=linkedin');
    });
  });

  describe('GET /api/v1/auth/microsoft/callback', () => {
    it('redirects to callback URL with tokens for existing user', async () => {
      setupExistingUser();

      const res = await request(app)
        .get('/api/v1/auth/microsoft/callback')
        .expect(302);

      const location = res.headers.location;
      expect(location).toContain(`${FRONTEND_URL}/auth/callback`);
      expect(location).toContain('access_token=mock-access-token');
      expect(location).toContain('refresh_token=mock-refresh-token');
      expect(location).toContain('provider=microsoft');
    });
  });
});