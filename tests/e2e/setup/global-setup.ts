/**
 * global-setup.ts
 *
 * Jest globalSetup — runs ONCE before any test suite in the E2E run.
 * Responsibilities:
 *   1. Start a PostgreSQL testcontainer
 *   2. Start a Redis testcontainer
 *   3. Run all DB migrations against the containerised Postgres
 *   4. Write connection strings to process.env so all test processes can read them
 *   5. Store container references in a temp file for global-teardown to stop them
 */

import { PostgreSqlContainer, RedisContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Temp file that records container IDs for global-teardown
const CONTAINER_STATE_FILE = path.join(__dirname, '.container-state.json');

export default async function globalSetup(): Promise<void> {
  console.log('\n🐳  [E2E] Starting testcontainers...');

  const startTime = Date.now();

  // ─── Start PostgreSQL container ───────────────────────────────────────────
  const postgres = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('mentorminds_e2e')
    .withUsername('postgres')
    .withPassword('postgres')
    // Optimise for test throughput — no durability needed
    .withCommand([
      'postgres',
      '-c', 'fsync=off',
      '-c', 'synchronous_commit=off',
      '-c', 'full_page_writes=off',
      '-c', 'max_connections=100',
    ])
    .start();

  // ─── Start Redis container ────────────────────────────────────────────────
  const redis = await new RedisContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  const pgUrl = postgres.getConnectionUri();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  console.log(`✅  [E2E] PostgreSQL ready: ${pgUrl}`);
  console.log(`✅  [E2E] Redis ready:      ${redisUrl}`);

  // ─── Write env vars for test processes ───────────────────────────────────
  // Jest runs each test file in its own worker; env vars set here propagate
  // through process.env because globalSetup runs in the main process and
  // Jest serialises globals to all worker contexts.
  process.env.DATABASE_URL = pgUrl;
  process.env.DB_HOST = postgres.getHost();
  process.env.DB_PORT = String(postgres.getMappedPort(5432));
  process.env.DB_NAME = 'mentorminds_e2e';
  process.env.DB_USER = 'postgres';
  process.env.DB_PASSWORD = 'postgres';
  process.env.REDIS_URL = redisUrl;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // Use a random port; supertest binds to 0
  process.env.JWT_SECRET = 'e2e-test-jwt-secret-at-least-32-characters-long!!!';
  process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret-at-least-32-char!!!!';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.ENCRYPTION_KEY = 'e2e-test-encryption-key-exactly-32b!!';
  process.env.FILE_SIGNING_SECRET = 'e2e-test-file-signing-secret-32b!!!!';
  process.env.SECRETS_PROVIDER = 'env';
  process.env.LOG_LEVEL = 'silent';
  process.env.STELLAR_NETWORK = 'testnet';
  process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
  process.env.CORS_ORIGIN = '*';
  process.env.APP_BASE_URL = 'http://localhost:5001';
  process.env.APP_CLIENT_URL = 'http://localhost:3000';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  process.env.MEETING_PROVIDER = 'jitsi';
  process.env.AWS_S3_BUCKET = 'e2e-test-bucket';
  process.env.AWS_ACCESS_KEY_ID = 'test-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  process.env.AWS_REGION = 'us-east-1';
  process.env.SENTRY_DSN = '';
  process.env.API_VERSION = 'v1';

  // ─── Run migrations ───────────────────────────────────────────────────────
  console.log('🔄  [E2E] Running database migrations...');
  try {
    const migrateCmd = process.platform === 'win32'
      ? 'pnpm run migrate:up'
      : `DATABASE_URL="${pgUrl}" pnpm run migrate:up`;
    execSync(
      migrateCmd,
      {
        cwd: path.join(__dirname, '../../..'),
        env: { ...process.env, DATABASE_URL: pgUrl },
        stdio: process.env.E2E_VERBOSE ? 'inherit' : 'pipe',
      },
    );
    console.log('✅  [E2E] Migrations complete.');
  } catch (error) {
    console.error('❌  [E2E] Migration failed:', error);
    // Stop containers before throwing so they don't leak
    await postgres.stop();
    await redis.stop();
    throw error;
  }

  // ─── Persist container IDs for global-teardown ───────────────────────────
  const state = {
    postgresContainerId: postgres.getId(),
    redisContainerId: redis.getId(),
    pgUrl,
    redisUrl,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONTAINER_STATE_FILE, JSON.stringify(state, null, 2));

  // Also stash references in global so test fixtures can reuse them
  (global as any).__E2E_CONTAINERS__ = { postgres, redis };
  (global as any).__E2E_PG_URL__ = pgUrl;
  (global as any).__E2E_REDIS_URL__ = redisUrl;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`🚀  [E2E] Global setup complete in ${elapsed}s\n`);
}
