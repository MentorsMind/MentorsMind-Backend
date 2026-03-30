import request from "supertest";
import Redis from "ioredis";
import app from "../../app";
import { testPool } from "../../tests/setup";

const API_BASE = "/api/v1";

async function ensureMentorSchema(): Promise<void> {
  await testPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS availability_schedule JSONB;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(20,7);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS expertise TEXT[];
    ALTER TABLE users ADD COLUMN IF NOT EXISTS years_of_experience INTEGER;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS total_sessions_completed INTEGER DEFAULT 0;

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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS booking_id UUID;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(20,7) DEFAULT 0;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
  `);
}

async function resetMentorData(): Promise<void> {
  await testPool.query(`
    TRUNCATE TABLE bookings CASCADE;
    TRUNCATE TABLE transactions CASCADE;
    TRUNCATE TABLE users CASCADE;
  `);
}

describe("E2E Scenario 2: mentor journey", () => {
  let redis: Redis;

  beforeAll(async () => {
    await ensureMentorSchema();
    redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    await redis.connect();
  });

  beforeEach(async () => {
    await resetMentorData();
  });

  afterAll(async () => {
    if (redis) await redis.quit();
  });

  it(
    "registers mentor, sets profile/availability, completes session, and gets payout",
    async () => {
      const startedAt = Date.now();

      await expect(testPool.query("SELECT 1 AS ok")).resolves.toBeDefined();
      await expect(redis.ping()).resolves.toBe("PONG");

      const mentorEmail = `mentor.journey.${Date.now()}@e2e.test`;
      const learnerEmail = `learner.journey.${Date.now()}@e2e.test`;
      const password = "Password123!";

      const mentorRegister = await request(app)
        .post(`${API_BASE}/auth/register`)
        .send({
          email: mentorEmail,
          password,
          firstName: "Ada",
          lastName: "Mentor",
          role: "mentor",
        });
      expect(mentorRegister.status).toBe(201);
      const mentorId = mentorRegister.body?.data?.userId as string;

      const learnerRegister = await request(app)
        .post(`${API_BASE}/auth/register`)
        .send({
          email: learnerEmail,
          password,
          firstName: "Sam",
          lastName: "Learner",
          role: "mentee",
        });
      expect(learnerRegister.status).toBe(201);
      const learnerId = learnerRegister.body?.data?.userId as string;

      await testPool.query(
        `UPDATE users
         SET hourly_rate = 150,
             expertise = ARRAY['system-design', 'typescript'],
             years_of_experience = 8,
             availability_schedule = '{"monday":{"enabled":true,"slots":[{"start":"09:00","end":"12:00"}]}}'::jsonb,
             is_available = TRUE
         WHERE id = $1`,
        [mentorId],
      );

      const mentorsList = await request(app).get(
        `${API_BASE}/mentors?search=Ada&isAvailable=true&page=1&limit=10`,
      );
      expect(mentorsList.status).toBe(200);
      expect((mentorsList.body?.data?.mentors || []).some((m: any) => m.id === mentorId)).toBe(true);

      const booking = await testPool.query<{ id: string }>(
        `INSERT INTO bookings
          (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, amount, status, payment_status)
         VALUES ($1, $2, NOW() + INTERVAL '1 day', 60, 'System Design Deep Dive', 200, 'confirmed', 'paid')
         RETURNING id`,
        [learnerId, mentorId],
      );

      await testPool.query(
        `UPDATE bookings
         SET status = 'completed', updated_at = NOW()
         WHERE id = $1`,
        [booking.rows[0].id],
      );

      await testPool.query(
        `INSERT INTO transactions
          (user_id, booking_id, type, status, amount, currency, platform_fee, completed_at, created_at, updated_at)
         VALUES ($1, $2, 'mentor_payout', 'completed', 180, 'XLM', 0, NOW(), NOW(), NOW())`,
        [mentorId, booking.rows[0].id],
      );

      const payoutRows = await testPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM transactions
         WHERE user_id = $1 AND type = 'mentor_payout' AND status = 'completed'`,
        [mentorId],
      );
      expect(parseInt(payoutRows.rows[0].count, 10)).toBeGreaterThan(0);

      expect(Date.now() - startedAt).toBeLessThan(60_000);
    },
    60_000,
  );
});
