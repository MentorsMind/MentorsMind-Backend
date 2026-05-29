/**
 * Unit tests for src/config/env.ts
 *
 * We test the Zod schema directly rather than calling validateEnv()
 * (which would call process.exit on failure). This keeps tests safe
 * and fast without needing any real environment variables.
 */

import { z } from 'zod';

// ─── Re-define the schema here so we can test it in isolation ─────────────────
// (Mirrors the schema in src/config/env.ts exactly)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().regex(/^\d+$/, 'PORT must be a number').default('5000'),
  API_VERSION: z.string().default('v1'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().regex(/^\d+$/, 'DB_PORT must be a number').default('5432'),
  DB_NAME: z.string().default('mentorminds'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  STELLAR_HORIZON_URL: z.string().url('STELLAR_HORIZON_URL must be a valid URL'),
  PLATFORM_PUBLIC_KEY: z.string().optional(),
  PLATFORM_SECRET_KEY: z.string().optional(),

  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:5173'),

  RATE_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().regex(/^\d+$/).default('100'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().regex(/^\d+$/).default('587'),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  GMAIL_USER: z.string().optional(),
  GMAIL_PASS: z.string().optional(),
  FROM_EMAIL: z.string().email().default('noreply@mentorminds.com'),

  REDIS_URL: z.string().url('REDIS_URL must be a valid URL').optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  BCRYPT_ROUNDS: z.string().regex(/^\d+$/).default('10'),

  PLATFORM_FEE_PERCENTAGE: z.string().regex(/^\d+$/).default('5'),
});

// ─── Minimal valid env for use in passing tests ───────────────────────────────

const validBase = {
  DATABASE_URL: 'postgresql://postgres:password@localhost:5432/mentorminds',
  DB_PASSWORD: 'secret',
  JWT_SECRET: 'a-very-secure-secret-that-is-at-least-32-chars',
  JWT_REFRESH_SECRET: 'another-very-secure-secret-at-least-32-chars!!',
  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('env schema — valid configuration', () => {
  it('accepts a minimal valid environment', () => {
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('applies correct defaults when optional vars are absent', () => {
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.NODE_ENV).toBe('development');
    expect(result.data.PORT).toBe('5000');
    expect(result.data.API_VERSION).toBe('v1');
    expect(result.data.LOG_LEVEL).toBe('info');
    expect(result.data.BCRYPT_ROUNDS).toBe('10');
    expect(result.data.PLATFORM_FEE_PERCENTAGE).toBe('5');
    expect(result.data.STELLAR_NETWORK).toBe('testnet');
  });

  it('accepts all three NODE_ENV values', () => {
    for (const env of ['development', 'test', 'production'] as const) {
      const result = envSchema.safeParse({ ...validBase, NODE_ENV: env });
      expect(result.success).toBe(true);
    }
  });

  it('accepts both stellar networks', () => {
    const testnet = envSchema.safeParse({ ...validBase, STELLAR_NETWORK: 'testnet' });
    const mainnet = envSchema.safeParse({ ...validBase, STELLAR_NETWORK: 'mainnet' });
    expect(testnet.success).toBe(true);
    expect(mainnet.success).toBe(true);
  });
});

describe('env schema — missing required variables', () => {
  it('fails when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _, ...rest } = validBase;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('DATABASE_URL');
  });

  it('fails when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _, ...rest } = validBase;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('JWT_SECRET');
  });

  it('fails when JWT_REFRESH_SECRET is missing', () => {
    const { JWT_REFRESH_SECRET: _, ...rest } = validBase;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('JWT_REFRESH_SECRET');
  });

  it('fails when STELLAR_HORIZON_URL is missing', () => {
    const { STELLAR_HORIZON_URL: _, ...rest } = validBase;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('STELLAR_HORIZON_URL');
  });

  it('fails when DB_PASSWORD is empty string', () => {
    const result = envSchema.safeParse({ ...validBase, DB_PASSWORD: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('DB_PASSWORD');
  });

  it('reports multiple missing vars in one parse', () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('DATABASE_URL');
    expect(paths).toContain('JWT_SECRET');
    expect(paths).toContain('JWT_REFRESH_SECRET');
    expect(paths).toContain('STELLAR_HORIZON_URL');
  });
});

describe('env schema — invalid value types', () => {
  it('rejects DATABASE_URL that is not a valid URL', () => {
    const result = envSchema.safeParse({ ...validBase, DATABASE_URL: 'not-a-url' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'DATABASE_URL');
    expect(issue).toBeDefined();
  });

  it('rejects PORT that contains non-numeric characters', () => {
    const result = envSchema.safeParse({ ...validBase, PORT: 'abc' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('PORT');
  });

  it('rejects JWT_SECRET shorter than 32 characters', () => {
    const result = envSchema.safeParse({ ...validBase, JWT_SECRET: 'too-short' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('JWT_SECRET');
  });

  it('rejects JWT_REFRESH_SECRET shorter than 32 characters', () => {
    const result = envSchema.safeParse({ ...validBase, JWT_REFRESH_SECRET: 'short' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('JWT_REFRESH_SECRET');
  });

  it('rejects invalid NODE_ENV value', () => {
    const result = envSchema.safeParse({ ...validBase, NODE_ENV: 'staging' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('NODE_ENV');
  });

  it('rejects invalid LOG_LEVEL value', () => {
    const result = envSchema.safeParse({ ...validBase, LOG_LEVEL: 'verbose' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('LOG_LEVEL');
  });

  it('rejects STELLAR_HORIZON_URL that is not a valid URL', () => {
    const result = envSchema.safeParse({ ...validBase, STELLAR_HORIZON_URL: 'not-a-url' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('STELLAR_HORIZON_URL');
  });

  it('accepts valid optional REDIS_URL', () => {
    const result = envSchema.safeParse({ ...validBase, REDIS_URL: 'redis://localhost:6379' });
    expect(result.success).toBe(true);
  });

  it('rejects malformed REDIS_URL', () => {
    const result = envSchema.safeParse({ ...validBase, REDIS_URL: 'not-a-url' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('REDIS_URL');
  });

  it('rejects non-numeric BCRYPT_ROUNDS', () => {
    const result = envSchema.safeParse({ ...validBase, BCRYPT_ROUNDS: 'ten' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid FROM_EMAIL', () => {
    const result = envSchema.safeParse({ ...validBase, FROM_EMAIL: 'not-an-email' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('FROM_EMAIL');
  });
});
