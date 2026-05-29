/**
 * Jest globalSetup — runs once in the main process before any test workers.
 *
 * 1. Spins up a real PostgreSQL container via testcontainers.
 * 2. Runs all database migrations against it.
 * 3. Spins up a real Redis container via testcontainers.
 * 4. Writes connection details into process.env so worker processes
 *    (which are forked after this function returns) inherit them.
 * 5. Stores stop callbacks in the module-level registry so
 *    globalTeardown.ts can stop the containers in the same process.
 */
import path from "path";
import { execSync } from "child_process";
import { GenericContainer, Wait } from "testcontainers";
import registry from "./containerRegistry";

export default async function globalSetup(): Promise<void> {
  console.log("\n🐘 Starting PostgreSQL container …");

  const pgContainer = await new GenericContainer("postgres:15-alpine")
    .withEnvironment({
      POSTGRES_USER: "testuser",
      POSTGRES_PASSWORD: "testpassword",
      POSTGRES_DB: "testdb",
    })
    .withExposedPorts(5432)
    .withHealthCheck({
      test: ["CMD-SHELL", "pg_isready -U testuser -d testdb"],
      interval: 1_000,
      timeout: 5_000,
      retries: 15,
      startPeriod: 0,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(120_000)
    .start();

  const dbHost = pgContainer.getHost();
  const dbPort = pgContainer.getMappedPort(5432);
  const databaseUrl = `postgresql://testuser:testpassword@${dbHost}:${dbPort}/testdb`;

  // Overwrite env vars so the app pool AND testPool both point at the container
  process.env.TEST_DB_HOST = dbHost;
  process.env.TEST_DB_PORT = String(dbPort);
  process.env.TEST_DB_NAME = "testdb";
  process.env.TEST_DB_USER = "testuser";
  process.env.TEST_DB_PASSWORD = "testpassword";
  process.env.DATABASE_URL = databaseUrl;
  process.env.DB_HOST = dbHost;
  process.env.DB_PORT = String(dbPort);
  process.env.DB_NAME = "testdb";
  process.env.DB_USER = "testuser";
  process.env.DB_PASSWORD = "testpassword";

  console.log(`   ✅ PostgreSQL ready at ${dbHost}:${dbPort}`);
  console.log("   🔄 Running migrations …");

  runMigrations(databaseUrl);

  console.log("   ✅ Migrations applied");

  registry.stopPg = () => pgContainer.stop();

  // ─── Redis ──────────────────────────────────────────────────────────────────

  console.log("🔴 Starting Redis container …");

  const redisContainer = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .withHealthCheck({
      test: ["CMD", "redis-cli", "ping"],
      interval: 1_000,
      timeout: 3_000,
      retries: 10,
      startPeriod: 0,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(60_000)
    .start();

  const redisHost = redisContainer.getHost();
  const redisPort = redisContainer.getMappedPort(6379);
  const redisUrl = `redis://${redisHost}:${redisPort}`;

  process.env.TEST_REDIS_HOST = redisHost;
  process.env.TEST_REDIS_PORT = String(redisPort);
  process.env.REDIS_URL = redisUrl;

  console.log(`   ✅ Redis ready at ${redisHost}:${redisPort}`);

  registry.stopRedis = () => redisContainer.stop();
}

/**
 * Run database migrations via the node-pg-migrate CLI that is already
 * installed as a dev dependency.  Using the CLI sidesteps any uncertainty
 * about the programmatic API across versions.
 */
function runMigrations(databaseUrl: string): void {
  const bin = path.resolve(
    process.cwd(),
    "node_modules",
    ".bin",
    "node-pg-migrate",
  );
  const migrationsDir = path.resolve(process.cwd(), "database", "migrations");

  try {
    execSync(
      `"${bin}" up --database-url-var _TEST_DB_URL --migrations-dir "${migrationsDir}"`,
      {
        env: { ...process.env, _TEST_DB_URL: databaseUrl },
        stdio: "pipe",
        cwd: process.cwd(),
      },
    );
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    console.error("Migration stdout:", e.stdout?.toString());
    console.error("Migration stderr:", e.stderr?.toString());
    throw new Error(`node-pg-migrate failed: ${e.message}`);
  }
}
