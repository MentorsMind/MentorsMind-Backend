/**
 * test-fixture.ts
 *
 * TestFixture — per-suite helper that:
 *   1. Gets the already-started containers from globalSetup
 *   2. Truncates all tables (for isolation between suites)
 *   3. Seeds minimal data: 1 admin, 1 mentor, 1 mentee + their wallets
 *   4. Provides a ready-to-use supertest `app` reference
 *   5. Tears down open DB/Redis connections after the suite
 *
 * Usage:
 *   ```ts
 *   const fixture = new TestFixture();
 *   beforeAll(async () => fixture.setup());
 *   afterAll(async () => fixture.teardown());
 *   ```
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';

// ─── Seed data types ──────────────────────────────────────────────────────────

export interface SeedUser {
  id: string;
  email: string;
  password: string; // plaintext, for use in login requests
  role: 'admin' | 'mentor' | 'mentee';
  firstName: string;
  lastName: string;
  walletPublicKey: string;
}

export interface TestSeedData {
  admin: SeedUser;
  mentor: SeedUser;
  mentee: SeedUser;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// ─── Tables to truncate between suites ───────────────────────────────────────
// Listed in dependency order (children before parents) to avoid FK violations.
const TRUNCATE_TABLES = [
  'review_responses',
  'reviews',
  'escrows',
  'disputes',
  'bookings',
  'transactions',
  'refresh_tokens',
  'audit_logs',
  'notifications',
  'wallets',
  'users',
].join(', ');

// ─── TestFixture class ────────────────────────────────────────────────────────

export class TestFixture {
  public pool!: Pool;
  public redis!: Redis;
  public app!: Express.Application;
  public request!: SuperTest<Test>;
  public seeds!: TestSeedData;

  // Tokens seeded by setup() for convenience
  public adminTokens!: AuthTokens;
  public mentorTokens!: AuthTokens;
  public menteeTokens!: AuthTokens;

  /**
   * Call in `beforeAll()`.
   * Connects to containers, truncates tables, seeds users, initialises the app.
   */
  async setup(): Promise<void> {
    const pgUrl = process.env.DATABASE_URL!;
    const redisUrl = process.env.REDIS_URL!;

    if (!pgUrl || !redisUrl) {
      throw new Error(
        '[TestFixture] DATABASE_URL or REDIS_URL not set. ' +
          'Ensure global-setup.ts ran first.',
      );
    }

    // ── DB pool ────────────────────────────────────────────────────────────
    this.pool = new Pool({ connectionString: pgUrl, max: 5 });

    // ── Redis client ───────────────────────────────────────────────────────
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    await this.redis.connect();

    // ── Flush Redis so BullMQ queues start clean ───────────────────────────
    await this.redis.flushdb();

    // ── Truncate tables ────────────────────────────────────────────────────
    await this.pool.query(`TRUNCATE TABLE ${TRUNCATE_TABLES} RESTART IDENTITY CASCADE`);

    // ── Seed test users ────────────────────────────────────────────────────
    this.seeds = await this._seedUsers(this.pool);

    // ── Initialise Express app ─────────────────────────────────────────────
    // Require fresh module instances (Jest module cache is per-worker, but
    // we reset env vars in globalSetup, so we can safely re-require here).
    jest.resetModules();
    const { default: expressApp } = await import('../../../src/app');
    this.app = expressApp;
    this.request = supertest(this.app);

    // ── Issue JWT tokens for each seed user ────────────────────────────────
    this.adminTokens = await this._issueTokens(this.seeds.admin);
    this.mentorTokens = await this._issueTokens(this.seeds.mentor);
    this.menteeTokens = await this._issueTokens(this.seeds.mentee);
  }

  /**
   * Call in `afterAll()`.
   * Closes DB pool and Redis connection.
   */
  async teardown(): Promise<void> {
    try {
      await this.pool?.end();
    } catch (_err) {
      // ignore
    }
    try {
      await this.redis?.quit();
    } catch (_err) {
      // ignore
    }
  }

  /**
   * Truncate only specific tables between individual tests within a suite.
   * Keeps users/wallets intact; useful when a test creates bookings/escrows.
   */
  async resetTransactionalData(): Promise<void> {
    await this.pool.query(`
      TRUNCATE TABLE review_responses, reviews, escrows, disputes, bookings, transactions, refresh_tokens, audit_logs, notifications
      RESTART IDENTITY CASCADE
    `);
    await this.redis.flushdb();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async _seedUsers(pool: Pool): Promise<TestSeedData> {
    const salt = await bcrypt.genSalt(10);

    const adminPassword = 'AdminPass123!';
    const mentorPassword = 'MentorPass123!';
    const menteePassword = 'MenteePass123!';

    const adminId = uuidv4();
    const mentorId = uuidv4();
    const menteeId = uuidv4();

    const defaultPreferences = JSON.stringify({
      booking_confirmed: { email: true, push: false, in_app: true },
      payment_processed: { email: true, push: false, in_app: true },
      session_reminder: { email: true, push: false, in_app: true },
      dispute_created: { email: true, push: false, in_app: true },
      system_alert: { email: true, push: false, in_app: true },
      meeting_confirmed: { email: true, push: false, in_app: true },
      message_received: { email: false, push: false, in_app: true },
      session_cancelled: { email: true, push: false, in_app: true },
    });

    // Insert users
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, notification_preferences, user_tier, is_active)
       VALUES
         ($1, 'admin@e2e.test', $4, 'E2E', 'Admin', 'admin', $7, 'pro', true),
         ($2, 'mentor@e2e.test', $5, 'E2E', 'Mentor', 'mentor', $7, 'pro', true),
         ($3, 'mentee@e2e.test', $6, 'E2E', 'Mentee', 'mentee', $7, 'free', true)`,
      [
        adminId,
        mentorId,
        menteeId,
        await bcrypt.hash(adminPassword, salt),
        await bcrypt.hash(mentorPassword, salt),
        await bcrypt.hash(menteePassword, salt),
        defaultPreferences,
      ],
    );

    // Deterministic "Stellar" public keys for tests — random 56-char G... format
    // We use fake keys; real wallet activation is mocked.
    const adminKey = 'GADMIN00000000000000000000000000000000000000000000000000000';
    const mentorKey = 'GMENTOR0000000000000000000000000000000000000000000000000000';
    const menteeKey = 'GMENTEE0000000000000000000000000000000000000000000000000000';

    // Insert wallets
    await pool.query(
      `INSERT INTO wallets (id, user_id, stellar_public_key, balance, currency, is_active)
       VALUES
         ($1, $4, $7, 0, 'XLM', true),
         ($2, $5, $8, 0, 'XLM', true),
         ($3, $6, $9, 0, 'XLM', true)`,
      [
        uuidv4(), uuidv4(), uuidv4(),
        adminId, mentorId, menteeId,
        adminKey, mentorKey, menteeKey,
      ],
    );

    // Insert mentor profile row (required for bookings FK)
    await pool.query(
      `INSERT INTO mentor_profiles (user_id, bio, hourly_rate, currency, is_verified, years_of_experience)
       VALUES ($1, 'E2E test mentor', 50.00, 'USD', true, 5)
       ON CONFLICT (user_id) DO NOTHING`,
      [mentorId],
    ).catch(() => {
      // mentor_profiles table might not exist in all migration versions — skip gracefully
    });

    // Update mentor user record with mentor profile columns
    await pool.query(
      `UPDATE users
       SET hourly_rate = 50.00,
           bio = 'E2E test mentor',
           expertise = ARRAY['TypeScript', 'Stellar'],
           years_of_experience = 5
       WHERE id = $1`,
      [mentorId],
    );

    return {
      admin: {
        id: adminId,
        email: 'admin@e2e.test',
        password: adminPassword,
        role: 'admin',
        firstName: 'E2E',
        lastName: 'Admin',
        walletPublicKey: adminKey,
      },
      mentor: {
        id: mentorId,
        email: 'mentor@e2e.test',
        password: mentorPassword,
        role: 'mentor',
        firstName: 'E2E',
        lastName: 'Mentor',
        walletPublicKey: mentorKey,
      },
      mentee: {
        id: menteeId,
        email: 'mentee@e2e.test',
        password: menteePassword,
        role: 'mentee',
        firstName: 'E2E',
        lastName: 'Mentee',
        walletPublicKey: menteeKey,
      },
    };
  }

  private async _issueTokens(user: SeedUser): Promise<AuthTokens> {
    // Import TokenService lazily (after env vars are set)
    const { TokenService } = await import('../../../src/services/token.service');

    const tokens = await TokenService.issueTokens(
      user.id,
      user.email,
      user.role,
      'free',
      undefined,
      { deviceName: 'e2e-test', ipAddress: '127.0.0.1' },
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Helper: issue a POST request with JSON body and Bearer auth.
   */
  post(url: string, body: unknown, token?: string, headers?: Record<string, string>): supertest.Test {
    const req = this.request.post(`/api/v1${url}`).send(body as object);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (headers) {
      for (const [key, val] of Object.entries(headers)) {
        req.set(key, val);
      }
    }
    return req;
  }

  /**
   * Helper: issue a GET request with Bearer auth.
   */
  get(url: string, token?: string, headers?: Record<string, string>): supertest.Test {
    const req = this.request.get(`/api/v1${url}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (headers) {
      for (const [key, val] of Object.entries(headers)) {
        req.set(key, val);
      }
    }
    return req;
  }

  /**
   * Helper: issue a PATCH request with JSON body and Bearer auth.
   */
  patch(url: string, body: unknown, token?: string, headers?: Record<string, string>): supertest.Test {
    const req = this.request.patch(`/api/v1${url}`).send(body as object);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (headers) {
      for (const [key, val] of Object.entries(headers)) {
        req.set(key, val);
      }
    }
    return req;
  }

  /**
   * Helper: issue a PUT request with JSON body and Bearer auth.
   */
  put(url: string, body: unknown, token?: string, headers?: Record<string, string>): supertest.Test {
    const req = this.request.put(`/api/v1${url}`).send(body as object);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (headers) {
      for (const [key, val] of Object.entries(headers)) {
        req.set(key, val);
      }
    }
    return req;
  }

  /**
   * Helper: issue a DELETE request with Bearer auth.
   */
  delete(url: string, token?: string, headers?: Record<string, string>): supertest.Test {
    const req = this.request.delete(`/api/v1${url}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (headers) {
      for (const [key, val] of Object.entries(headers)) {
        req.set(key, val);
      }
    }
    return req;
  }

  /**
   * Wait for a BullMQ job to reach completed or failed state.
   * Uses polling against Redis directly.
   */
  async waitForJob(
    queueName: string,
    jobId: string,
    timeoutMs = 30_000,
  ): Promise<'completed' | 'failed'> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // BullMQ stores job state in Redis hash `bull:{queue}:{jobId}`
      const stateKey = `bull:${queueName}:${jobId}`;
      const state = await this.redis.hget(stateKey, 'returnvalue');
      const failedKey = `bull:${queueName}:failed`;
      const inFailed = await this.redis.zscore(failedKey, jobId);

      if (inFailed !== null) return 'failed';
      if (state !== null) return 'completed';

      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
      `[TestFixture.waitForJob] Timed out waiting for job ${jobId} in queue ${queueName}`,
    );
  }

  /**
   * Directly query the DB — useful for assertions without going through the API.
   */
  async dbQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const { rows } = await this.pool.query(sql, params);
    return rows as T[];
  }
}
