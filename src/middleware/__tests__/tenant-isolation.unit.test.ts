/**
 * Cross-Tenant Security Integration Tests
 *
 * These tests prove that multi-tenant data isolation works at the
 * application layer (via AsyncLocalStorage TenantContext) by verifying
 * that all tenant-scoped model methods append the correct tenant_id
 * predicate to their SQL queries.
 *
 * They are pure unit tests — no database connection is required.
 * The `db` and `pool` modules are mocked so we can inspect the SQL
 * strings and parameters that would be sent to PostgreSQL.
 *
 * Key properties verified:
 *  1. Queries executed inside a tenant context include AND tenant_id = $N
 *  2. Queries executed without a tenant context do NOT add a predicate
 *  3. Queries in an ADMIN_BYPASS context do NOT add a predicate
 *  4. INSERTs stamp the tenant_id column with the current context value
 *  5. withTenantFilter / withCurrentTenantFilter pure-function behaviour
 *  6. TenantContext isolation — contexts from different tenants never bleed
 */

import {
  TenantContext,
  withTenantFilter,
  withCurrentTenantFilter,
  ADMIN_BYPASS_TENANT_ID,
} from '../../utils/tenant-context.utils';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// We mock the database modules BEFORE importing any model so the models pick
// up the mock implementations rather than real pg connections.

const mockDbQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockPoolQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

jest.mock('../../config/database', () => ({
  // `__esModule` makes the mock behave like the real module: `config/database`
  // has a `default` export, so `import pool from` is emitted as
  // `__importDefault(require(...)).default`. Without the flag the interop helper
  // wraps the whole mock object and `pool.query` is undefined.
  __esModule: true,
  db: { query: (...args: any[]) => mockDbQuery(...args) },
  pool: { query: (...args: any[]) => mockPoolQuery(...args) },
  default: { query: (...args: any[]) => mockPoolQuery(...args) },
  TenantPoolManager: {
    connect: jest.fn(),
    withClient: jest.fn(),
  },
}));

// Import models AFTER the mocks are set up
import { BookingModel } from '../../models/booking.model';
import { SessionModel } from '../../models/session.model';
import { DisputeModel } from '../../models/dispute.model';
import { WalletModel } from '../../models/wallet.model';
import { TransactionModel } from '../../models/transaction.model';
import { PaymentModel } from '../../models/payment.model';

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOOKING_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SESSION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DISPUTE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the most recent SQL string that was sent to either mock. */
function lastSql(): string {
  const dbCall = mockDbQuery.mock.calls[mockDbQuery.mock.calls.length - 1];
  const poolCall = mockPoolQuery.mock.calls[mockPoolQuery.mock.calls.length - 1];
  // Return whichever was called most recently
  const dbIdx = mockDbQuery.mock.calls.length;
  const poolIdx = mockPoolQuery.mock.calls.length;
  const calls = [...mockDbQuery.mock.calls, ...mockPoolQuery.mock.calls];
  return (calls[calls.length - 1]?.[0] as string) ?? '';
}

/** Returns all parameter arrays from the most recent query call. */
function lastParams(): unknown[] {
  const allCalls = [
    ...mockDbQuery.mock.calls.map((c) => c[1] ?? []),
    ...mockPoolQuery.mock.calls.map((c) => c[1] ?? []),
  ];
  return (allCalls[allCalls.length - 1] as unknown[]) ?? [];
}

beforeEach(() => {
  mockDbQuery.mockClear();
  mockPoolQuery.mockClear();
  mockDbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// =============================================================================
// 1. withTenantFilter — pure function tests
// =============================================================================

describe('withTenantFilter — pure function', () => {
  it('appends AND tenant_id = $N when a tenantId is given and WHERE clause exists', () => {
    const { query, params } = withTenantFilter(
      'SELECT * FROM bookings WHERE id = $1',
      ['some-id'],
      TENANT_A,
    );
    expect(query).toContain('AND tenant_id = $2');
    expect(params).toContain(TENANT_A);
  });

  it('adds WHERE tenant_id = $N when the base query has no WHERE clause', () => {
    const { query, params } = withTenantFilter(
      'SELECT * FROM bookings',
      [],
      TENANT_A,
    );
    expect(query).toContain('WHERE tenant_id = $1');
    expect(params[0]).toBe(TENANT_A);
  });

  it('does NOT add a tenant predicate when tenantId is null', () => {
    const { query, params } = withTenantFilter(
      'SELECT * FROM bookings WHERE id = $1',
      ['some-id'],
      null,
    );
    expect(query).not.toContain('tenant_id');
    expect(params).not.toContain(null);
  });

  it('does NOT add a tenant predicate for ADMIN_BYPASS_TENANT_ID', () => {
    const { query, params } = withTenantFilter(
      'SELECT * FROM bookings WHERE id = $1',
      ['some-id'],
      ADMIN_BYPASS_TENANT_ID,
    );
    expect(query).not.toContain('tenant_id');
  });

  it('increments parameter index correctly with existing params', () => {
    const { query, params } = withTenantFilter(
      'SELECT * FROM bookings WHERE status = $1 AND currency = $2',
      ['confirmed', 'XLM'],
      TENANT_A,
    );
    expect(query).toContain('AND tenant_id = $3');
    expect(params[2]).toBe(TENANT_A);
    expect(params[0]).toBe('confirmed');
    expect(params[1]).toBe('XLM');
  });

  it('respects a custom column name', () => {
    const { query } = withTenantFilter(
      'SELECT * FROM t WHERE id = $1',
      ['x'],
      TENANT_A,
      'org_id',
    );
    expect(query).toContain('AND org_id = $2');
  });
});

// =============================================================================
// 2. withCurrentTenantFilter — reads from AsyncLocalStorage
// =============================================================================

describe('withCurrentTenantFilter — context-aware', () => {
  it('returns the tenant predicate when a tenant context is set', () => {
    let result!: ReturnType<typeof withCurrentTenantFilter>;
    TenantContext.run(TENANT_A, () => {
      result = withCurrentTenantFilter(
        'SELECT * FROM bookings WHERE id = $1',
        ['x'],
      );
    });
    expect(result.query).toContain('AND tenant_id = $2');
    expect(result.params).toContain(TENANT_A);
  });

  it('returns the original query when no context is set', () => {
    // Run outside any context (TenantContext.getTenantId() returns null)
    const result = withCurrentTenantFilter(
      'SELECT * FROM bookings WHERE id = $1',
      ['x'],
    );
    expect(result.query).toBe('SELECT * FROM bookings WHERE id = $1');
    expect(result.params).toEqual(['x']);
  });

  it('returns the original query in an admin bypass context', () => {
    let result!: ReturnType<typeof withCurrentTenantFilter>;
    TenantContext.run(ADMIN_BYPASS_TENANT_ID, () => {
      result = withCurrentTenantFilter(
        'SELECT * FROM bookings WHERE id = $1',
        ['x'],
      );
    });
    expect(result.query).toBe('SELECT * FROM bookings WHERE id = $1');
  });
});

// =============================================================================
// 3. TenantContext — isolation guarantees
// =============================================================================

describe('TenantContext — isolation', () => {
  it('provides a tenant ID within a run() scope', () => {
    let captured: string | null = null;
    TenantContext.run(TENANT_A, () => {
      captured = TenantContext.getTenantId();
    });
    expect(captured).toBe(TENANT_A);
  });

  it('returns null outside any run() scope', () => {
    // Make sure we're outside any context
    expect(TenantContext.getTenantId()).toBeNull();
  });

  it('nested contexts do not bleed into the outer scope', () => {
    const outer: string[] = [];
    const inner: string[] = [];

    TenantContext.run(TENANT_A, () => {
      outer.push(TenantContext.getTenantId() ?? 'null');

      TenantContext.run(TENANT_B, () => {
        inner.push(TenantContext.getTenantId() ?? 'null');
      });

      // After inner context, outer should still be TENANT_A
      outer.push(TenantContext.getTenantId() ?? 'null');
    });

    expect(inner).toEqual([TENANT_B]);
    expect(outer).toEqual([TENANT_A, TENANT_A]);
  });

  it('contexts from concurrent async operations do not bleed', async () => {
    const results: string[] = [];

    await Promise.all([
      new Promise<void>((resolve) =>
        TenantContext.run(TENANT_A, async () => {
          await new Promise((r) => setTimeout(r, 10));
          results.push(`A:${TenantContext.getTenantId()}`);
          resolve();
        }),
      ),
      new Promise<void>((resolve) =>
        TenantContext.run(TENANT_B, async () => {
          await new Promise((r) => setTimeout(r, 5));
          results.push(`B:${TenantContext.getTenantId()}`);
          resolve();
        }),
      ),
    ]);

    // Both contexts should have resolved correctly despite interleaving
    expect(results).toContain(`A:${TENANT_A}`);
    expect(results).toContain(`B:${TENANT_B}`);
    // And neither bled into the other
    expect(results).not.toContain(`A:${TENANT_B}`);
    expect(results).not.toContain(`B:${TENANT_A}`);
  });

  it('hasTenantContext() returns true only when a real tenant is set', () => {
    let withinContext = false;
    let withinBypass = false;
    let outsideContext = TenantContext.hasTenantContext();

    TenantContext.run(TENANT_A, () => {
      withinContext = TenantContext.hasTenantContext();
    });

    TenantContext.run(ADMIN_BYPASS_TENANT_ID, () => {
      withinBypass = TenantContext.hasTenantContext();
    });

    expect(withinContext).toBe(true);
    expect(withinBypass).toBe(false); // bypass is not a "real" tenant context
    expect(outsideContext).toBe(false);
  });

  it('isAdminBypass() is true only for the sentinel', () => {
    let bypass = false;
    let normal = true;

    TenantContext.run(ADMIN_BYPASS_TENANT_ID, () => {
      bypass = TenantContext.isAdminBypass();
    });

    TenantContext.run(TENANT_A, () => {
      normal = TenantContext.isAdminBypass();
    });

    expect(bypass).toBe(true);
    expect(normal).toBe(false);
  });

  it('requireTenantId() throws when outside a context', () => {
    expect(() => TenantContext.requireTenantId()).toThrow(
      /No tenant context found/,
    );
  });

  it('requireTenantId() returns the ID when inside a context', () => {
    let id = '';
    TenantContext.run(TENANT_A, () => {
      id = TenantContext.requireTenantId();
    });
    expect(id).toBe(TENANT_A);
  });
});

// =============================================================================
// 4. BookingModel — cross-tenant access prevention
// =============================================================================

describe('BookingModel — tenant isolation', () => {
  it('findById sends tenant_id predicate in tenant context', async () => {
    await TenantContext.run(TENANT_A, () => BookingModel.findById(BOOKING_ID));

    const sql = lastSql();
    const params = lastParams();

    expect(sql).toContain('tenant_id');
    expect(params).toContain(TENANT_A);
  });

  it('findById does NOT send tenant_id predicate without a context', async () => {
    await BookingModel.findById(BOOKING_ID);

    const sql = lastSql();
    expect(sql).not.toContain('tenant_id');
  });

  it('findByUserId applies tenant filter in context', async () => {
    await TenantContext.run(TENANT_A, () =>
      BookingModel.findByUserId(USER_ID),
    );

    // Both the data query and the count query should contain the tenant filter
    const allSqls = [
      ...mockDbQuery.mock.calls.map((c) => c[0] as string),
      ...mockPoolQuery.mock.calls.map((c) => c[0] as string),
    ];
    const withTenant = allSqls.filter((s) => s.includes('tenant_id'));
    expect(withTenant.length).toBeGreaterThanOrEqual(1);
  });

  it('create stamps tenant_id from the current context', async () => {
    await TenantContext.run(TENANT_A, () =>
      BookingModel.create({
        menteeId: USER_ID,
        mentorId: 'mentor-id',
        scheduledAt: new Date(),
        durationMinutes: 60,
        topic: 'Testing',
        amount: '50.00',
        currency: 'XLM',
      }),
    );

    const sql = lastSql();
    const params = lastParams();
    expect(sql).toContain('tenant_id');
    expect(params).toContain(TENANT_A);
  });

  it('Tenant A cannot see Tenant B bookings (different tenant params)', async () => {
    // Simulate two sequential requests for different tenants
    let paramsForA: unknown[] = [];
    let paramsForB: unknown[] = [];

    await TenantContext.run(TENANT_A, async () => {
      await BookingModel.findById(BOOKING_ID);
      paramsForA = [...lastParams()];
    });

    await TenantContext.run(TENANT_B, async () => {
      await BookingModel.findById(BOOKING_ID);
      paramsForB = [...lastParams()];
    });

    // Each request sends its own tenant_id — they differ
    expect(paramsForA).toContain(TENANT_A);
    expect(paramsForA).not.toContain(TENANT_B);

    expect(paramsForB).toContain(TENANT_B);
    expect(paramsForB).not.toContain(TENANT_A);
  });
});

// =============================================================================
// 5. SessionModel — cross-tenant access prevention
// =============================================================================

describe('SessionModel — tenant isolation', () => {
  it('findById appends tenant filter', async () => {
    await TenantContext.run(TENANT_A, () => SessionModel.findById(SESSION_ID));
    const sql = lastSql();
    expect(sql).toContain('tenant_id');
    expect(lastParams()).toContain(TENANT_A);
  });

  it('findByUserId applies tenant filter', async () => {
    await TenantContext.run(TENANT_A, () =>
      SessionModel.findByUserId(USER_ID),
    );
    const sql = lastSql();
    expect(sql).toContain('tenant_id');
  });

  it('create stamps tenant_id', async () => {
    await TenantContext.run(TENANT_A, () =>
      SessionModel.create({
        mentorId: 'mentor-id',
        menteeId: 'mentee-id',
        title: 'Test session',
        scheduledAt: new Date(),
        durationMinutes: 60,
      }),
    );
    const sql = lastSql();
    const params = lastParams();
    expect(sql).toContain('tenant_id');
    expect(params).toContain(TENANT_A);
  });

  it('updateStatus is tenant-scoped', async () => {
    await TenantContext.run(TENANT_A, () =>
      SessionModel.updateStatus(SESSION_ID, 'completed'),
    );
    const sql = lastSql();
    expect(sql).toContain('tenant_id');
    expect(lastParams()).toContain(TENANT_A);
  });
});

// =============================================================================
// 6. DisputeModel — cross-tenant access prevention
// =============================================================================

describe('DisputeModel — tenant isolation', () => {
  it('findById appends tenant filter', async () => {
    await TenantContext.run(TENANT_A, () =>
      DisputeModel.findById(DISPUTE_ID),
    );
    const sql = lastSql();
    expect(sql).toContain('tenant_id');
  });

  it('findByUserId is tenant-scoped', async () => {
    await TenantContext.run(TENANT_A, () =>
      DisputeModel.findByUserId(USER_ID),
    );
    expect(lastSql()).toContain('tenant_id');
  });

  it('create stamps tenant_id', async () => {
    await TenantContext.run(TENANT_A, () =>
      DisputeModel.create({
        session_id: SESSION_ID,
        filed_by_id: USER_ID,
        respondent_id: 'other-user',
        type: 'payment',
        reason: 'Test reason',
      }),
    );
    const sql = lastSql();
    const params = lastParams();
    expect(sql).toContain('tenant_id');
    expect(params).toContain(TENANT_A);
  });
});

// =============================================================================
// 7. WalletModel — cross-tenant access prevention
// =============================================================================

describe('WalletModel — tenant isolation', () => {
  it('findByUserId is tenant-scoped', async () => {
    await TenantContext.run(TENANT_A, () =>
      WalletModel.findByUserId(USER_ID),
    );
    expect(lastSql()).toContain('tenant_id');
    expect(lastParams()).toContain(TENANT_A);
  });

  it('findByUserIds is tenant-scoped', async () => {
    await TenantContext.run(TENANT_A, () =>
      WalletModel.findByUserIds([USER_ID]),
    );
    expect(lastSql()).toContain('tenant_id');
  });

  it('create stamps tenant_id', async () => {
    await TenantContext.run(TENANT_A, () =>
      WalletModel.create(USER_ID, 'GSTELLARKEY'),
    );
    const sql = lastSql();
    expect(sql).toContain('tenant_id');
    expect(lastParams()).toContain(TENANT_A);
  });

  it('updateStatus is tenant-scoped', async () => {
    await TenantContext.run(TENANT_A, () =>
      WalletModel.updateStatus(USER_ID, 'suspended'),
    );
    expect(lastSql()).toContain('tenant_id');
  });
});

// =============================================================================
// 8. TransactionModel — cross-tenant access prevention
// =============================================================================

describe('TransactionModel — tenant isolation', () => {
  it('findAll is tenant-scoped', async () => {
    await TenantContext.run(TENANT_A, () => TransactionModel.findAll());
    expect(lastSql()).toContain('tenant_id');
    expect(lastParams()).toContain(TENANT_A);
  });

  it('count is tenant-scoped', async () => {
    // `count()` parses rows[0].count, so this query needs a result row.
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ count: '0' }],
      rowCount: 1,
    });
    await TenantContext.run(TENANT_A, () => TransactionModel.count());
    expect(lastSql()).toContain('tenant_id');
  });
});

// =============================================================================
// 9. PaymentModel — cross-tenant access prevention
// =============================================================================

describe('PaymentModel — tenant isolation', () => {
  it('findByUserId is tenant-scoped', async () => {
    await TenantContext.run(TENANT_A, () =>
      PaymentModel.findByUserId(USER_ID),
    );
    expect(lastSql()).toContain('tenant_id');
    expect(lastParams()).toContain(TENANT_A);
  });

  it('findByUserIds is tenant-scoped', async () => {
    await TenantContext.run(TENANT_A, () =>
      PaymentModel.findByUserIds([USER_ID]),
    );
    expect(lastSql()).toContain('tenant_id');
  });
});

// =============================================================================
// 10. Admin bypass — cross-tenant access allowed
// =============================================================================

describe('Admin bypass — cross-tenant queries allowed', () => {
  it('BookingModel.findById does NOT add tenant filter in admin bypass', async () => {
    await TenantContext.run(ADMIN_BYPASS_TENANT_ID, () =>
      BookingModel.findById(BOOKING_ID),
    );
    expect(lastSql()).not.toContain('tenant_id');
  });

  it('SessionModel.findById does NOT add tenant filter in admin bypass', async () => {
    await TenantContext.run(ADMIN_BYPASS_TENANT_ID, () =>
      SessionModel.findById(SESSION_ID),
    );
    expect(lastSql()).not.toContain('tenant_id');
  });

  it('WalletModel.findByUserId does NOT add tenant filter in admin bypass', async () => {
    await TenantContext.run(ADMIN_BYPASS_TENANT_ID, () =>
      WalletModel.findByUserId(USER_ID),
    );
    expect(lastSql()).not.toContain('tenant_id');
  });

  it('TransactionModel.findAll does NOT add tenant filter in admin bypass', async () => {
    await TenantContext.run(ADMIN_BYPASS_TENANT_ID, () =>
      TransactionModel.findAll(),
    );
    expect(lastSql()).not.toContain('tenant_id');
  });
});

// =============================================================================
// 11. Performance — overhead of withTenantFilter
// =============================================================================

describe('Performance — withTenantFilter overhead', () => {
  it('completes 10,000 filter operations in < 100ms (well under 5ms/query budget)', () => {
    const start = Date.now();
    for (let i = 0; i < 10_000; i++) {
      withTenantFilter(
        'SELECT * FROM bookings WHERE id = $1',
        [`booking-${i}`],
        TENANT_A,
      );
    }
    const elapsed = Date.now() - start;
    // 10,000 ops must complete in < 100ms = < 0.01ms each
    expect(elapsed).toBeLessThan(100);
  });
});
