import request from "supertest";
import Redis from "ioredis";
import app from "../../app";
import { testPool } from "../../tests/setup";

const API_BASE = "/api/v1";
const STELLAR_ADDR_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const STELLAR_ADDR_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBR3";

function extractAccessToken(body: any): string {
  return (
    body?.data?.tokens?.accessToken ||
    body?.data?.accessToken ||
    body?.data?.token ||
    ""
  );
}

async function ensureJourneySchema(): Promise<void> {
  await testPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(20,7);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS expertise TEXT[];
    ALTER TABLE users ADD COLUMN IF NOT EXISTS availability_schedule JSONB;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS average_rating NUMERIC(4,2) DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

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
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS from_address VARCHAR(56);
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_address VARCHAR(56);
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(20,7) DEFAULT 0;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS asset_type VARCHAR(20) DEFAULT 'native';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS related_transaction_id UUID;

    CREATE TABLE IF NOT EXISTS reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reviewee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
      helpful_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (booking_id, reviewer_id)
    );
  `);
}

async function resetJourneyData(): Promise<void> {
  await testPool.query(`
    TRUNCATE TABLE reviews CASCADE;
    TRUNCATE TABLE bookings CASCADE;
    TRUNCATE TABLE transactions CASCADE;
    TRUNCATE TABLE users CASCADE;
  `);
}

describe("E2E Scenario 1: learner journey", () => {
  let redis: Redis;

  beforeAll(async () => {
    await ensureJourneySchema();
    redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    await redis.connect();
  });

  beforeEach(async () => {
    await resetJourneyData();
  });

  afterAll(async () => {
    if (redis) await redis.quit();
  });

  it(
    "registers learner, searches mentor, books/pays/completes, and leaves a review",
    async () => {
      const startedAt = Date.now();

      await expect(testPool.query("SELECT 1 AS ok")).resolves.toBeDefined();
      await expect(redis.ping()).resolves.toBe("PONG");

      const mentorEmail = `mentor.${Date.now()}@e2e.test`;
      const learnerEmail = `learner.${Date.now()}@e2e.test`;
      const password = "Password123!";

      const mentorRegister = await request(app)
        .post(`${API_BASE}/auth/register`)
        .send({
          email: mentorEmail,
          password,
          firstName: "Mentor",
          lastName: "One",
          role: "mentor",
        });
      expect(mentorRegister.status).toBe(201);

      const learnerRegister = await request(app)
        .post(`${API_BASE}/auth/register`)
        .send({
          email: learnerEmail,
          password,
          firstName: "Learner",
          lastName: "One",
          role: "mentee",
        });
      expect(learnerRegister.status).toBe(201);

      const mentorId = mentorRegister.body?.data?.userId as string;
      const learnerId = learnerRegister.body?.data?.userId as string;
      expect(mentorId).toBeTruthy();
      expect(learnerId).toBeTruthy();

      await testPool.query(
        `UPDATE users
         SET email_verified = TRUE,
             hourly_rate = 120,
             expertise = ARRAY['nodejs', 'payments'],
             is_available = TRUE
         WHERE id = $1`,
        [mentorId],
      );
      await testPool.query(
        `UPDATE users SET email_verified = TRUE WHERE id = $1`,
        [learnerId],
      );

      const learnerLogin = await request(app)
        .post(`${API_BASE}/auth/login`)
        .send({ email: learnerEmail, password });
      expect(learnerLogin.status).toBe(200);
      const learnerAccessToken = extractAccessToken(learnerLogin.body);

      const mentorSearch = await request(app).get(
        `${API_BASE}/mentors?search=Mentor&limit=10&page=1`,
      );
      expect(mentorSearch.status).toBe(200);
      const mentors = mentorSearch.body?.data?.mentors || [];
      expect(Array.isArray(mentors)).toBe(true);
      expect(mentors.some((m: any) => m.id === mentorId)).toBe(true);

      const bookingInsert = await testPool.query<{ id: string }>(
        `INSERT INTO bookings
          (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, amount, currency, status, payment_status)
         VALUES ($1, $2, NOW() + INTERVAL '2 days', 60, 'Node.js mentorship', 100, 'XLM', 'confirmed', 'pending')
         RETURNING id`,
        [learnerId, mentorId],
      );
      const bookingId = bookingInsert.rows[0].id;

      const paymentInsert = await testPool.query<{ id: string }>(
        `INSERT INTO transactions
          (user_id, booking_id, type, status, amount, currency, from_address, to_address, platform_fee, description, created_at, updated_at)
         VALUES ($1, $2, 'payment', 'pending', 100, 'XLM', $3, $4, 10, 'Session payment', NOW(), NOW())
         RETURNING id`,
        [learnerId, bookingId, STELLAR_ADDR_A, STELLAR_ADDR_B],
      );
      const paymentId = paymentInsert.rows[0].id;

      const paymentWebhook = await request(app)
        .post(`${API_BASE}/payments/webhook`)
        .send({
          type: "payment.confirmed",
          transaction_hash: "A".repeat(64),
          to: STELLAR_ADDR_B,
          amount: "100",
        });
      expect(paymentWebhook.status).toBe(200);

      await testPool.query(
        `UPDATE bookings
         SET status = 'completed', payment_status = 'paid', transaction_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [paymentId, bookingId],
      );

      await testPool.query(
        `INSERT INTO reviews (booking_id, reviewer_id, reviewee_id, rating, comment)
         VALUES ($1, $2, $3, 5, 'Great session and practical guidance')`,
        [bookingId, learnerId, mentorId],
      );

      const mentorReviews = await request(app).get(
        `${API_BASE}/reviews/mentor/${mentorId}?page=1&limit=10`,
      );
      expect(mentorReviews.status).toBe(200);
      expect((mentorReviews.body?.data?.reviews || []).length).toBeGreaterThan(0);

      expect(learnerAccessToken).toBeTruthy();
      expect(Date.now() - startedAt).toBeLessThan(60_000);
    },
    60_000,
  );
});
