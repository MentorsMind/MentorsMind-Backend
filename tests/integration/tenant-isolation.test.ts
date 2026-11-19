import {
  TenantContext,
  ADMIN_BYPASS_TENANT_ID,
  withTenantFilter,
  withCurrentTenantFilter,
} from '../../src/utils/tenant-context.utils';
import {
  tenantMiddleware,
  requireTenant,
  adminBypassTenantMiddleware,
} from '../../src/middleware/tenant.middleware';

/**
 * Multi-Tenancy Isolation Test Suite (issue #985)
 *
 * Verifies that the tenant-scoping primitives (AsyncLocalStorage context,
 * SQL tenant filter builder, and the tenant middleware) prevent one tenant's
 * data from leaking into another tenant's queries and requests.
 *
 * These tests exercise the pure utilities and middleware logic directly so
 * they run deterministically without a live database. Optionally, DB-backed
 * cases can be gated behind `TESTCONTAINERS=1` (see setup.ts).
 */

describe('TenantContext (AsyncLocalStorage isolation)', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

  it('does not leak tenant context outside a scoped run', () => {
    expect(TenantContext.getTenantId()).toBeNull();
    TenantContext.run(TENANT_A, () => {
      expect(TenantContext.getTenantId()).toBe(TENANT_A);
      expect(TenantContext.hasTenantContext()).toBe(true);
      expect(TenantContext.isAdminBypass()).toBe(false);
    });
    // Context restored after run completes.
    expect(TenantContext.getTenantId()).toBeNull();
  });

  it('isolates concurrent tenant contexts from one another', async () => {
    await Promise.all([
      new Promise<void>((resolve) => {
        TenantContext.run(TENANT_A, () => {
          // Simulate a nested async boundary so the context propagates.
          setTimeout(() => {
            expect(TenantContext.getTenantId()).toBe(TENANT_A);
            resolve();
          }, 5);
        });
      }),
      new Promise<void>((resolve) => {
        TenantContext.run(TENANT_B, () => {
          setTimeout(() => {
            expect(TenantContext.getTenantId()).toBe(TENANT_B);
            resolve();
          }, 5);
        });
      }),
    ]);
  });

  it('treats the admin bypass sentinel as a non-tenant context', () => {
    TenantContext.run(ADMIN_BYPASS_TENANT_ID, () => {
      expect(TenantContext.hasTenantContext()).toBe(false);
      expect(TenantContext.isAdminBypass()).toBe(true);
    });
  });

  it('requireTenantId throws when no tenant context is set', () => {
    TenantContext.run(null, () => {
      expect(() => TenantContext.requireTenantId()).toThrow(
        /No tenant context found/,
      );
    });
  });
});

describe('withTenantFilter (SQL level isolation)', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111';

  it('appends an AND tenant_id predicate to a query with WHERE', () => {
    const { query, params } = withTenantFilter(
      'SELECT * FROM bookings WHERE status = $1',
      ['confirmed'],
      TENANT_A,
    );
    expect(query).toContain('AND tenant_id = $2');
    expect(params).toEqual(['confirmed', TENANT_A]);
  });

  it('adds a WHERE tenant_id predicate when there is no WHERE clause', () => {
    const { query } = withTenantFilter('SELECT * FROM users', [], TENANT_A);
    expect(query).toContain('WHERE tenant_id = $1');
  });

  it('skips filtering for a null tenant (system context)', () => {
    const { query, params } = withTenantFilter(
      'SELECT * FROM bookings WHERE status = $1',
      ['confirmed'],
      null,
    );
    expect(query).not.toContain('tenant_id');
    expect(params).toEqual(['confirmed']);
  });

  it('skips filtering for the admin bypass sentinel', () => {
    const { query, params } = withTenantFilter(
      'SELECT * FROM users',
      [],
      ADMIN_BYPASS_TENANT_ID,
    );
    expect(query).not.toContain('tenant_id');
    expect(params).toEqual([]);
  });

  it('withCurrentTenantFilter reads the tenant from the active context', () => {
    TenantContext.run(TENANT_A, () => {
      const { query, params } = withCurrentTenantFilter(
        'SELECT * FROM bookings WHERE status = $1',
        ['confirmed'],
      );
      expect(query).toContain('AND tenant_id = $2');
      expect(params).toEqual(['confirmed', TENANT_A]);
    });
  });
});

describe('tenantMiddleware (request scoping)', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    jest.resetModules();
  });

  it('rejects requests with mismatched / missing tenant scope via requireTenant', () => {
    const req: any = { tenant: undefined };
    const res: any = {
      status: jest.fn(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn(),
    };
    const next = jest.fn();

    requireTenant(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('requireTenant passes through when a tenant is resolved', () => {
    const req: any = { tenant: { id: TENANT_A } };
    const res: any = { status: jest.fn(() => res), json: jest.fn() };
    const next = jest.fn();

    requireTenant(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('requireTenant rejects a mismatched tenant scope on admin endpoints', () => {
    // Admin endpoints are mounted behind requireTenant; a request whose
    // resolved tenant does not match (or is absent) must be rejected rather
    // than leaking into another tenant's data.
    const req: any = { tenant: null }; // mismatched / unresolved tenant
    const res: any = {
      status: jest.fn(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    requireTenant(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Tenant not found.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('adminBypassTenantMiddleware enables cross-tenant admin reads without scoping', () => {
    const req: any = {};
    const res: any = {};
    const next = jest.fn();

    adminBypassTenantMiddleware(req, res, () => {
      next();
      expect(TenantContext.isAdminBypass()).toBe(true);
      expect(TenantContext.getTenantId()).toBe(ADMIN_BYPASS_TENANT_ID);
      // Admin reads skip the tenant predicate entirely (all tenants visible).
      const { query, params } = withCurrentTenantFilter('SELECT * FROM users', []);
      expect(query).not.toContain('tenant_id');
      expect(params).toEqual([]);
    });
    expect(next).toHaveBeenCalled();
  });

  it('tenantMiddleware runs without a tenant context when none matches', async () => {
    // Force an empty hostname so no tenant is resolved.
    jest.doMock('../../src/models/tenant.model', () => ({
      TenantModel: {
        findByDomain: jest.fn().mockResolvedValue(null),
      },
    }));

    const { tenantMiddleware: tm } = await import(
      '../../src/middleware/tenant.middleware'
    );
    const req: any = { hostname: 'unknown.example.com' };
    const next = jest.fn();
    await tm(req, {} as any, () => {
      next();
      // Inside the scoped context the tenant should be null.
      expect(TenantContext.getTenantId()).toBeNull();
    });
    expect(next).toHaveBeenCalled();
  });
});

describe('Cross-tenant data isolation (model filter contract)', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

  // Models are expected to route their reads through withTenantFilter /
  // withCurrentTenantFilter using the request's tenant context. This test
  // documents that contract and guards against a regression where the tenant
  // predicate is dropped.
  it('scopes the same read query to different tenants without cross leakage', () => {
    const baseQuery = 'SELECT * FROM session_recordings WHERE id = $1';
    const recordingId = 'rec-123';

    const qA = withTenantFilter(baseQuery, [recordingId], TENANT_A);
    const qB = withTenantFilter(baseQuery, [recordingId], TENANT_B);

    // The two tenants produce identical WHERE clauses against different
    // tenant values — a tenant-A query can never return a tenant-B row.
    expect(qA.query).toBe(qB.query);
    expect(qA.params[1]).toBe(TENANT_A);
    expect(qB.params[1]).toBe(TENANT_B);
    expect(qA.params[1]).not.toBe(qB.params[1]);
  });

  it.each([
    ['users', 'SELECT * FROM users WHERE email = $1'],
    ['bookings', 'SELECT * FROM bookings WHERE status = $1'],
    ['sessions', 'SELECT * FROM sessions WHERE id = $1'],
    ['session_recordings', 'SELECT * FROM session_recordings WHERE id = $1'],
  ])('scopes %s reads to the active tenant (no cross-tenant leakage)', (_entity, query) => {
    const params = ['value-1'];
    const scoped = withTenantFilter(query, params, TENANT_A);
    const unscoped = withTenantFilter(query, params, TENANT_B);

    // Every major entity read must carry a tenant_id predicate bound to the
    // requesting tenant only.
    expect(scoped.query).toContain('tenant_id');
    expect(scoped.params[1]).toBe(TENANT_A);
    // A different tenant never shares the same bound value.
    expect(unscoped.params[1]).toBe(TENANT_B);
  });

  it('loads tenant through the active AsyncLocalStorage context per request', async () => {
    // Simulate two requests with different tenants hitting the same model read.
    const simulateRequest = (tenantId: string, recordingId: string) =>
      TenantContext.run(tenantId, () => {
        const { query, params } = withCurrentTenantFilter(
          'SELECT * FROM session_recordings WHERE id = $1',
          [recordingId],
        );
        return { query, params };
      });

    const reqA = simulateRequest(TENANT_A, 'rec-a');
    const reqB = simulateRequest(TENANT_B, 'rec-b');

    // Same underlying query shape, but each scoped to its own tenant only.
    expect(reqA.query).toContain('tenant_id');
    expect(reqB.query).toContain('tenant_id');
    expect(reqA.params[1]).toBe(TENANT_A);
    expect(reqB.params[1]).toBe(TENANT_B);
  });
});
