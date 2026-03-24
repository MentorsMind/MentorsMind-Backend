import { Request, Response, NextFunction } from 'express';
import { versioningMiddleware } from '../versioning.middleware';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(path: string, headers: Record<string, string> = {}): Partial<Request> {
  return { path, headers } as any;
}

function makeRes(): { headers: Record<string, string>; setHeader: jest.Mock; next: NextFunction } {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    setHeader: jest.fn((key: string, value: string) => {
      headers[key] = value;
    }),
  } as any;
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('versioningMiddleware', () => {
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
  });

  it('sets X-API-Version header on every response', () => {
    const req = makeReq('/api/v1/users');
    const res = makeRes();
    versioningMiddleware(req as Request, res as unknown as Response, next as NextFunction);
    expect(res.headers['X-API-Version']).toBe('v1');
    expect(next).toHaveBeenCalled();
  });

  it('resolves version from URL path', () => {
    const req = makeReq('/api/v1/bookings');
    const res = makeRes();
    versioningMiddleware(req as Request, res as unknown as Response, next as NextFunction);
    expect(res.headers['X-API-Version']).toBe('v1');
  });

  it('resolves version from Accept-Version header when no URL version', () => {
    const req = makeReq('/health', { 'accept-version': 'v1' });
    const res = makeRes();
    versioningMiddleware(req as Request, res as unknown as Response, next as NextFunction);
    expect(res.headers['X-API-Version']).toBe('v1');
  });

  it('normalises Accept-Version without leading v', () => {
    const req = makeReq('/health', { 'accept-version': '1' });
    const res = makeRes();
    versioningMiddleware(req as Request, res as unknown as Response, next as NextFunction);
    expect(res.headers['X-API-Version']).toBe('v1');
  });

  it('URL version takes priority over Accept-Version header', () => {
    const req = makeReq('/api/v1/users', { 'accept-version': 'v2' });
    const res = makeRes();
    versioningMiddleware(req as Request, res as unknown as Response, next as NextFunction);
    expect(res.headers['X-API-Version']).toBe('v1');
  });

  it('sets X-Supported-Versions header', () => {
    const req = makeReq('/api/v1/users');
    const res = makeRes();
    versioningMiddleware(req as Request, res as unknown as Response, next as NextFunction);
    expect(res.headers['X-Supported-Versions']).toContain('v1');
  });

  it('does NOT set Deprecation header for non-deprecated versions', () => {
    const req = makeReq('/api/v1/users');
    const res = makeRes();
    versioningMiddleware(req as Request, res as unknown as Response, next as NextFunction);
    expect(res.headers['Deprecation']).toBeUndefined();
    expect(res.headers['Sunset']).toBeUndefined();
  });

  it('sets Deprecation and Sunset headers for deprecated versions', () => {
    // Temporarily mark v1 as deprecated for this test
    const { API_VERSIONS } = require('../../config/api-versions.config');
    const original = { ...API_VERSIONS.v1 };
    API_VERSIONS.v1.deprecatedAt = '2026-06-01T00:00:00Z';
    API_VERSIONS.v1.sunsetAt = '2026-09-01T00:00:00Z';
    API_VERSIONS.v1.deprecationMessage = 'Please migrate to v2.';

    const req = makeReq('/api/v1/users');
    const res = makeRes();
    versioningMiddleware(req as Request, res as unknown as Response, next as NextFunction);

    expect(res.headers['Deprecation']).toBe('2026-06-01T00:00:00Z');
    expect(res.headers['Sunset']).toBe('2026-09-01T00:00:00Z');
    expect(res.headers['X-Deprecation-Message']).toBe('Please migrate to v2.');

    // Restore
    Object.assign(API_VERSIONS.v1, original);
    delete API_VERSIONS.v1.deprecatedAt;
    delete API_VERSIONS.v1.sunsetAt;
    delete API_VERSIONS.v1.deprecationMessage;
  });

  it('calls next() for unknown versions (let router 404)', () => {
    const req = makeReq('/api/v99/users');
    const res = makeRes();
    versioningMiddleware(req as Request, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });
});
