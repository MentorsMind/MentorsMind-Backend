/**
 * Unit tests for auth.validator.ts — input trimming behaviour (#1293)
 *
 * Verifies that leading/trailing whitespace is stripped from firstName,
 * lastName, and email before the values reach the service layer.
 */

import { registerSchema } from '../auth.validator';

// Minimal valid password that satisfies the password policy
const VALID_PASSWORD = 'Test@1234Secure!';

function makeBody(overrides: Record<string, unknown> = {}) {
    return {
        body: {
            email: 'user@example.com',
            password: VALID_PASSWORD,
            firstName: 'John',
            lastName: 'Doe',
            role: 'mentee' as const,
            ...overrides,
        },
    };
}

describe('registerSchema — input trimming', () => {
    it('trims leading and trailing whitespace from firstName', () => {
        const result = registerSchema.safeParse(makeBody({ firstName: '  John  ' }));
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.body.firstName).toBe('John');
        }
    });

    it('trims leading and trailing whitespace from lastName', () => {
        const result = registerSchema.safeParse(makeBody({ lastName: '  Doe  ' }));
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.body.lastName).toBe('Doe');
        }
    });

    it('trims and lowercases email', () => {
        const result = registerSchema.safeParse(makeBody({ email: '  USER@EXAMPLE.COM  ' }));
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.body.email).toBe('user@example.com');
        }
    });

    it('rejects firstName that is only whitespace (too short after trim)', () => {
        const result = registerSchema.safeParse(makeBody({ firstName: '   ' }));
        expect(result.success).toBe(false);
    });

    it('passes through already-trimmed values unchanged', () => {
        const result = registerSchema.safeParse(makeBody({ firstName: 'Alice', lastName: 'Smith' }));
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.body.firstName).toBe('Alice');
            expect(result.data.body.lastName).toBe('Smith');
        }
    });
});
