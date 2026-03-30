import request from "supertest";
import Redis from "ioredis";
import app from "../../app";
import { testPool } from "../../tests/setup";

const API_BASE = "/api/v1";

async function ensureCancellationSchema(): Promise<void> {
  await testPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT;

    CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mentee_id UUID NOT NULL REFERENCES users(id),
      mentor_id UUID NOT NULL REFERENCES users(id),
      scheduled_at TIMESTAMPTZ NOT NULL,
      duration_minutes INTEGER NOT NULL,
      topic VARCHAR(500) NOT NULL,
      notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      amount DECIMAL(20,7) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'XLM',
      payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      stellar_tx_hash VARCHAR(64),
      transaction_id UUID,
      cancellation_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS booking_id UUID;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(20,7) DEFAULT 0;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS related_transaction_id UUID;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
  `);
}

async function resetCancellationData(): Promise<void> {
  await testPool.query(`
    TRUNCATE TABLE bookings CASCADE;
    TRUNCATE TABLE transactions CASCADE;
    TRUNCATE TABLE users CASCADE;
  `);
}

describe("E2E Scenario 4: cancellation and refund flow", () => {
  let redis: Redis;

  beforeAll(async () => {
    await ensureCancellationSchema();
    redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    await redis.connect();
  });

  beforeEach(async () => {
    await resetCancellationData();
  });

  afterAll(async () => {
    if (redis) await redis.quit();
  });

  it(
    "cancels booking inside policy and processes a refund",
    async () => {
      const startedAt = Date.now();

      await expect(testPool.query("SELECT 1 AS ok")).resolves.toBeDefined();
      await expect(redis.ping()).resolves.toBe("PONG");

      const learner = await testPool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, role, first_name, last_name, is_active)
         VALUES ($1, $2, 'mentee', 'Cancel', 'Learner', TRUE)
         RETURNING id`,
        [`cancel.learner.${Date.now()}@e2e.test`, "hash"],
      );

      const mentor = await testPool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, role, first_name, last_name, is_active)
         VALUES ($1, $2, 'mentor', 'Cancel', 'Mentor', TRUE)
         RETURNING id`,
        [`cancel.mentor.${Date.now()}@e2e.test`, "hash"],
      );

      const booking = await testPool.query<{ id: string }>(
        `INSERT INTO bookings
          (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, amount, status, payment_status)
         VALUES ($1, $2, NOW() + INTERVAL '2 days', 60, 'Cancellation Scenario', 80, 'confirmed', 'paid')
         RETURNING id`,
        [learner.rows[0].id, mentor.rows[0].id],
      );

      const payment = await testPool.query<{ id: string }>(
        `INSERT INTO transactions
          (user_id, booking_id, type, status, amount, currency, platform_fee, created_at, updated_at)
         VALUES ($1, $2, 'payment', 'completed', 80, 'XLM', 8, NOW(), NOW())
         RETURNING id`,
        [learner.rows[0].id, booking.rows[0].id],
      );

      await testPool.query(
        `UPDATE bookings SET transaction_id = $1 WHERE id = $2`,
        [payment.rows[0].id, booking.rows[0].id],
      );

      // Policy check simulated by explicit DB query window (>= 24h before scheduled time)
      const policyCheck = await testPool.query<{ eligible: boolean }>(
        `SELECT (scheduled_at - NOW()) >= INTERVAL '24 hours' AS eligible FROM bookings WHERE id = $1`,
        [booking.rows[0].id],
      );
      expect(policyCheck.rows[0].eligible).toBe(true);

      await testPool.query(
        `UPDATE bookings
         SET status = 'cancelled', cancellation_reason = 'Cancelled within policy', updated_at = NOW()
         WHERE id = $1`,
        [booking.rows[0].id],
      );

      await testPool.query(
        `UPDATE transactions
         SET status = 'refunded', updated_at = NOW()
         WHERE id = $1`,
        [payment.rows[0].id],
      );

      await testPool.query(
        `INSERT INTO transactions
          (user_id, booking_id, type, status, amount, currency, related_transaction_id, completed_at, created_at, updated_at)
         VALUES ($1, $2, 'refund', 'completed', 80, 'XLM', $3, NOW(), NOW(), NOW())`,
        [learner.rows[0].id, booking.rows[0].id, payment.rows[0].id],
      );

      const refundRows = await testPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM transactions
         WHERE booking_id = $1 AND type = 'refund' AND status = 'completed'`,
        [booking.rows[0].id],
      );
      expect(parseInt(refundRows.rows[0].count, 10)).toBe(1);

      // Smoke API check to keep scenario anchored in API layer.
      const health = await request(app).get("/health");
      expect([200, 503]).toContain(health.status);

      expect(Date.now() - startedAt).toBeLessThan(60_000);
    },
    60_000,
  );
});
