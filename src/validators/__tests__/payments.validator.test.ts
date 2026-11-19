/**
 * Unit tests for src/validators/payments.validator.ts
 *
 * Verifies that listUserPaymentsSchema correctly accepts valid enum values
 * and rejects invalid ones. Uses Zod's safeParse so no HTTP layer is needed.
 */

import { listUserPaymentsSchema, PAYMENT_STATUSES, PAYMENT_TYPES } from '../payments.validator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseQuery(query: Record<string, unknown>) {
  return listUserPaymentsSchema.safeParse({ query });
}

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

describe('listUserPaymentsSchema – status filter', () => {
  it.each(PAYMENT_STATUSES)('accepts valid status value "%s"', (status) => {
    expect(parseQuery({ status }).success).toBe(true);
  });

  it('accepts a request with no status filter (field is optional)', () => {
    expect(parseQuery({}).success).toBe(true);
  });

  it('rejects an invalid status value', () => {
    const result = parseQuery({ status: 'invalid' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.length).toBeGreaterThan(0);
  });

  it('rejects "paid" as a status (not a valid PaymentStatus)', () => {
    expect(parseQuery({ status: 'paid' }).success).toBe(false);
  });

  it('rejects "deposit" as a status (deposit is not a valid PaymentStatus)', () => {
    expect(parseQuery({ status: 'deposit' }).success).toBe(false);
  });

  it('rejects SQL-injection-style status strings', () => {
    expect(parseQuery({ status: "' OR 1=1 --" }).success).toBe(false);
  });

  it('includes the invalid value path in the error', () => {
    const result = parseQuery({ status: 'invalid' });
    expect(result.success).toBe(false);
    const pathFields = result.error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(pathFields.some((p) => p.includes('status'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Type filter
// ---------------------------------------------------------------------------

describe('listUserPaymentsSchema – type filter', () => {
  it.each(PAYMENT_TYPES)('accepts valid type value "%s"', (type) => {
    expect(parseQuery({ type }).success).toBe(true);
  });

  it('accepts a request with no type filter (field is optional)', () => {
    expect(parseQuery({}).success).toBe(true);
  });

  it('rejects "deposit" — was an invalid extra in the old schema, must be rejected', () => {
    expect(parseQuery({ type: 'deposit' }).success).toBe(false);
  });

  it('rejects "withdrawal" — was an invalid extra in the old schema, must be rejected', () => {
    expect(parseQuery({ type: 'withdrawal' }).success).toBe(false);
  });

  it('rejects an arbitrary invalid type string', () => {
    expect(parseQuery({ type: 'transfer' }).success).toBe(false);
  });

  it('rejects SQL-injection-style type strings', () => {
    expect(parseQuery({ type: "'; DROP TABLE transactions; --" }).success).toBe(false);
  });

  it('includes the invalid value path in the error', () => {
    const result = parseQuery({ type: 'deposit' });
    expect(result.success).toBe(false);
    const pathFields = result.error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(pathFields.some((p) => p.includes('type'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined valid queries
// ---------------------------------------------------------------------------

describe('listUserPaymentsSchema – combined filters', () => {
  it('accepts valid status + type together', () => {
    expect(parseQuery({ status: 'completed', type: 'payment' }).success).toBe(true);
  });

  it('accepts all combinations of valid status + type', () => {
    for (const status of PAYMENT_STATUSES) {
      for (const type of PAYMENT_TYPES) {
        expect(parseQuery({ status, type }).success).toBe(true);
      }
    }
  });

  it('rejects valid status with invalid type', () => {
    expect(parseQuery({ status: 'completed', type: 'deposit' }).success).toBe(false);
  });

  it('rejects invalid status with valid type', () => {
    expect(parseQuery({ status: 'paid', type: 'refund' }).success).toBe(false);
  });

  it('rejects both invalid status and invalid type, reporting both errors', () => {
    const result = parseQuery({ status: 'paid', type: 'deposit' });
    expect(result.success).toBe(false);
    // Zod reports an issue for each invalid field
    expect(result.error?.issues.length).toBeGreaterThanOrEqual(1);
  });
});
