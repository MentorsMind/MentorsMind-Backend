import Redis from "ioredis";
import { testPool } from "../../tests/setup";
import { DisputeService } from "../../services/disputes.service";

async function ensureDisputeSchema(): Promise<void> {
  await testPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}'::jsonb;

    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS booking_id UUID;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS related_transaction_id UUID;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS disputes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id UUID NOT NULL REFERENCES transactions(id),
      reporter_id UUID NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      resolution_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dispute_evidence (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
      submitter_id UUID NOT NULL REFERENCES users(id),
      text_content TEXT,
      file_url VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mentee_id UUID NOT NULL REFERENCES users(id),
      mentor_id UUID NOT NULL REFERENCES users(id),
      scheduled_at TIMESTAMPTZ NOT NULL,
      duration_minutes INTEGER NOT NULL,
      topic VARCHAR(500) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      amount DECIMAL(20,7) NOT NULL,
      payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function resetDisputeData(): Promise<void> {
  await testPool.query(`
    TRUNCATE TABLE dispute_evidence CASCADE;
    TRUNCATE TABLE disputes CASCADE;
    TRUNCATE TABLE bookings CASCADE;
    TRUNCATE TABLE transactions CASCADE;
    TRUNCATE TABLE users CASCADE;
  `);
}

describe("E2E Scenario 3: payment dispute flow", () => {
  let redis: Redis;

  beforeAll(async () => {
    await ensureDisputeSchema();
    redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    await redis.connect();
  });

  beforeEach(async () => {
    await resetDisputeData();
  });

  afterAll(async () => {
    if (redis) await redis.quit();
  });

  it(
    "creates disputed payment, resolves it, and records split settlement",
    async () => {
      const startedAt = Date.now();

      await expect(testPool.query("SELECT 1 AS ok")).resolves.toBeDefined();
      await expect(redis.ping()).resolves.toBe("PONG");

      const admin = await testPool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, role, first_name, last_name, is_active)
         VALUES ($1, $2, 'admin', 'Admin', 'Resolver', TRUE)
         RETURNING id`,
        [`admin.${Date.now()}@e2e.test`, "hash"],
      );

      const mentor = await testPool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, role, first_name, last_name, is_active)
         VALUES ($1, $2, 'mentor', 'Mentor', 'Two', TRUE)
         RETURNING id`,
        [`mentor.${Date.now()}@e2e.test`, "hash"],
      );

      const learner = await testPool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, role, first_name, last_name, is_active)
         VALUES ($1, $2, 'mentee', 'Learner', 'Two', TRUE)
         RETURNING id`,
        [`learner.${Date.now()}@e2e.test`, "hash"],
      );

      const booking = await testPool.query<{ id: string }>(
        `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, amount, payment_status)
         VALUES ($1, $2, NOW() - INTERVAL '1 day', 60, 'Disputed Session', 'completed', 120, 'paid')
         RETURNING id`,
        [learner.rows[0].id, mentor.rows[0].id],
      );

      const payment = await testPool.query<{ id: string }>(
        `INSERT INTO transactions (user_id, booking_id, amount, currency, status, type, created_at, updated_at)
         VALUES ($1, $2, 120, 'XLM', 'completed', 'payment', NOW(), NOW())
         RETURNING id`,
        [learner.rows[0].id, booking.rows[0].id],
      );

      const dispute = await DisputeService.openDispute(
        payment.rows[0].id,
        learner.rows[0].id,
        "Session quality did not match expectations",
      );

      const resolved = await DisputeService.resolveDispute(
        dispute.id,
        admin.rows[0].id,
        "partial_refund",
        "Applied policy-based 50/50 split",
      );
      expect(resolved.status).toBe("resolved");

      await testPool.query(
        `INSERT INTO transactions (user_id, booking_id, amount, currency, status, type, related_transaction_id, completed_at, created_at, updated_at)
         VALUES
           ($1, $2, 60, 'XLM', 'completed', 'refund', $3, NOW(), NOW(), NOW()),
           ($4, $2, 60, 'XLM', 'completed', 'mentor_payout', $3, NOW(), NOW(), NOW())`,
        [learner.rows[0].id, booking.rows[0].id, payment.rows[0].id, mentor.rows[0].id],
      );

      const splitRows = await testPool.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total
         FROM transactions
         WHERE related_transaction_id = $1
           AND type IN ('refund', 'mentor_payout')`,
        [payment.rows[0].id],
      );
      expect(Number(splitRows.rows[0].total)).toBe(120);

      expect(Date.now() - startedAt).toBeLessThan(60_000);
    },
    60_000,
  );
});
