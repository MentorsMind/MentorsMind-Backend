/**
 * booking-lifecycle.e2e.ts
 *
 * Full End-to-End Test for the Complete Mentorship Booking Lifecycle:
 *   1. Register Mentee + Mentor (and issue JWT auth tokens)
 *   2. Mentee creates a booking via API (POST /api/v1/bookings)
 *   3. Payment initiated & confirmed (POST /api/v1/payments + confirm)
 *   4. Mentor confirms booking via API (POST /api/v1/bookings/:id/confirm)
 *   5. Both participants join the session (POST /api/v1/bookings/:id/join)
 *   6. Booking marked complete via API (PATCH /api/v1/bookings/:id/complete)
 *   7. Mentee posts a review for the session (POST /api/v1/reviews)
 *   8. Review verified to appear on mentor's profile (GET /api/v1/reviews/mentor/:id)
 *
 * Payment status transitions and booking status transitions are verified at every step.
 * Only external services (Stellar Horizon, Soroban RPC, email) are mocked.
 */

import { v4 as uuidv4 } from 'uuid';
import { installStellarMocks, setMockPaymentOperation } from './setup/stellar-mock';
import { installSorobanMocks, clearMockEscrows } from './setup/soroban-mock';

// Install external service mocks before any application code is imported
installStellarMocks();
installSorobanMocks();

import { TestFixture } from './setup/test-fixture';
import { createTestMentor, createTestMentee, issueUserTokens, TestUser } from '../fixtures/user-helpers';

describe('Booking Lifecycle — Full End-to-End Flow', () => {
  const fixture = new TestFixture();

  beforeAll(async () => {
    await fixture.setup();
  });

  afterAll(async () => {
    await fixture.teardown();
  });

  beforeEach(async () => {
    await fixture.resetTransactionalData();
    clearMockEscrows();
    setMockPaymentOperation(null);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Primary Critical Path: Full Lifecycle Sequence
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Happy Path: register → create → pay → confirm → join → complete → review → profile', () => {
    let menteeUser: TestUser;
    let mentorUser: TestUser;
    let bookingId: string;
    let paymentId: string;
    let hourlyRate: number;
    let bookingAmount: string;

    it('Step 1: registers mentee and mentor, and configures mentor profile with hourly rate', async () => {
      // 1a. Register mentee via public register API
      const menteeEmail = `mentee-${Date.now()}@e2e.test`;
      const menteePassword = 'MenteeSecure123!';
      const menteeRes = await fixture.post('/auth/register', {
        email: menteeEmail,
        password: menteePassword,
        firstName: 'Alice',
        lastName: 'Mentee',
        role: 'mentee',
      });

      expect(menteeRes.status).toBe(201);
      expect(menteeRes.body.data).toHaveProperty('accessToken');
      expect(menteeRes.body.data).toHaveProperty('userId');

      const menteeId = menteeRes.body.data.userId;
      const menteeTokens = {
        accessToken: menteeRes.body.data.accessToken,
        refreshToken: menteeRes.body.data.refreshToken,
      };

      menteeUser = {
        id: menteeId,
        email: menteeEmail,
        password: menteePassword,
        role: 'mentee',
        firstName: 'Alice',
        lastName: 'Mentee',
        hourlyRate: null,
        walletPublicKey: 'GMENTEE000000000000000000000000000000000000000000000000',
        tokens: menteeTokens,
      };

      // 1b. Register mentor via public register API
      const mentorEmail = `mentor-${Date.now()}@e2e.test`;
      const mentorPassword = 'MentorSecure123!';
      const mentorRes = await fixture.post('/auth/register', {
        email: mentorEmail,
        password: mentorPassword,
        firstName: 'Bob',
        lastName: 'Mentor',
        role: 'mentor',
      });

      expect(mentorRes.status).toBe(201);
      expect(mentorRes.body.data).toHaveProperty('accessToken');
      expect(mentorRes.body.data).toHaveProperty('userId');

      const mentorId = mentorRes.body.data.userId;
      const mentorTokens = {
        accessToken: mentorRes.body.data.accessToken,
        refreshToken: mentorRes.body.data.refreshToken,
      };

      // 1c. Configure mentor profile via PUT /api/v1/mentors/:id
      hourlyRate = 75.0;
      const profileUpdateRes = await fixture.put(
        `/mentors/${mentorId}`,
        {
          hourlyRate,
          bio: 'Principal Distributed Systems & Stellar Engineer',
          expertise: ['Stellar', 'Soroban', 'TypeScript', 'PostgreSQL'],
          yearsOfExperience: 8,
          isAvailable: true,
        },
        mentorTokens.accessToken,
      );

      expect(profileUpdateRes.status).toBe(200);

      mentorUser = {
        id: mentorId,
        email: mentorEmail,
        password: mentorPassword,
        role: 'mentor',
        firstName: 'Bob',
        lastName: 'Mentor',
        hourlyRate,
        walletPublicKey: 'GMENTOR000000000000000000000000000000000000000000000000',
        tokens: mentorTokens,
      };

      // Verify mentor in DB has hourly_rate set
      const [mentorRow] = await fixture.dbQuery<{ hourly_rate: string; role: string }>(
        'SELECT hourly_rate, role FROM users WHERE id = $1',
        [mentorId],
      );
      expect(mentorRow.role).toBe('mentor');
      expect(parseFloat(mentorRow.hourly_rate)).toBeCloseTo(hourlyRate, 2);
    });

    it('Step 2: mentee creates booking (status=pending, payment_status=pending)', async () => {
      const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
      const durationMinutes = 60;
      const idempotencyKey = uuidv4();

      const res = await fixture.post(
        '/bookings',
        {
          mentorId: mentorUser.id,
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes,
          topic: 'Stellar Smart Contract Architecture Review',
          notes: 'Deep dive into Soroban escrow implementation',
        },
        menteeUser.tokens.accessToken,
        { 'Idempotency-Key': idempotencyKey },
      );

      expect(res.status).toBe(201);
      const bookingData = res.body.data?.booking ?? res.body.data;
      expect(bookingData).toBeDefined();
      expect(bookingData.id).toBeDefined();

      bookingId = bookingData.id;
      bookingAmount = bookingData.amount;

      // Status assertions on response
      expect(bookingData.mentor_id).toBe(mentorUser.id);
      expect(bookingData.mentee_id).toBe(menteeUser.id);
      expect(bookingData.status).toBe('pending');
      expect(['pending', 'unpaid']).toContain(bookingData.payment_status);

      // Verify in DB
      const [row] = await fixture.dbQuery<{ status: string; payment_status: string; amount: string }>(
        'SELECT status, payment_status, amount FROM bookings WHERE id = $1',
        [bookingId],
      );
      expect(row.status).toBe('pending');
      expect(['pending', 'unpaid']).toContain(row.payment_status);
      expect(parseFloat(row.amount)).toBeCloseTo(hourlyRate, 2);
    });

    it('Step 3: mentee initiates and confirms payment (status=pending, payment_status=paid)', async () => {
      // 3a. Initiate payment
      const paymentRes = await fixture.post(
        '/payments',
        {
          bookingId,
          amount: bookingAmount || '75.0000000',
          currency: 'XLM',
          description: 'Payment for mentorship session',
          toAddress: mentorUser.walletPublicKey,
        },
        menteeUser.tokens.accessToken,
        { 'Idempotency-Key': uuidv4() },
      );

      expect([200, 201]).toContain(paymentRes.status);
      const paymentData = paymentRes.body.data?.payment ?? paymentRes.body.data;
      expect(paymentData).toBeDefined();
      paymentId = paymentData.id;
      expect(['pending', 'processing']).toContain(paymentData.status);

      // Configure Stellar mock operation matching this payment
      setMockPaymentOperation({
        amount: bookingAmount || '75.0000000',
        to: mentorUser.walletPublicKey,
      });

      // 3b. Confirm payment with transaction hash
      const stellarTxHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const confirmPaymentRes = await fixture.post(
        `/payments/${paymentId}/confirm`,
        { stellarTxHash },
        menteeUser.tokens.accessToken,
        { 'Idempotency-Key': uuidv4() },
      );

      expect([200, 201]).toContain(confirmPaymentRes.status);

      // 3c. Verify payment status transition in bookings table
      const [bookingRow] = await fixture.dbQuery<{ status: string; payment_status: string; stellar_tx_hash: string }>(
        'SELECT status, payment_status, stellar_tx_hash FROM bookings WHERE id = $1',
        [bookingId],
      );

      // Status should still be pending confirmation, but payment_status must now be paid
      expect(bookingRow.status).toBe('pending');
      expect(bookingRow.payment_status).toBe('paid');
      expect(bookingRow.stellar_tx_hash).toBe(stellarTxHash);
    });

    it('Step 4: mentor confirms booking (status=confirmed, payment_status=paid)', async () => {
      const confirmRes = await fixture.post(
        `/bookings/${bookingId}/confirm`,
        {},
        mentorUser.tokens.accessToken,
        { 'Idempotency-Key': uuidv4() },
      );

      expect([200, 201]).toContain(confirmRes.status);
      const confirmedData = confirmRes.body.data?.booking ?? confirmRes.body.data?.session ?? confirmRes.body.data;
      expect(confirmedData.status).toBe('confirmed');

      // Verify in DB: status transitioned to 'confirmed' and payment_status remains 'paid'
      const [row] = await fixture.dbQuery<{ status: string; payment_status: string; escrow_id: string }>(
        'SELECT status, payment_status, escrow_id FROM bookings WHERE id = $1',
        [bookingId],
      );
      expect(row.status).toBe('confirmed');
      expect(row.payment_status).toBe('paid');
    });

    it('Step 5: both participants join the session (join timestamps recorded, status=confirmed)', async () => {
      // 5a. Mentee joins session
      const menteeJoinRes = await fixture.post(
        `/bookings/${bookingId}/join`,
        {},
        menteeUser.tokens.accessToken,
      );
      expect(menteeJoinRes.status).toBe(200);
      expect(menteeJoinRes.body).toMatchObject({
        success: true,
        data: expect.objectContaining({
          role: 'mentee',
          isFirstJoin: true,
        }),
      });

      // 5b. Mentor joins session
      const mentorJoinRes = await fixture.post(
        `/bookings/${bookingId}/join`,
        {},
        mentorUser.tokens.accessToken,
      );
      expect(mentorJoinRes.status).toBe(200);
      expect(mentorJoinRes.body).toMatchObject({
        success: true,
        data: expect.objectContaining({
          role: 'mentor',
          isFirstJoin: true,
        }),
      });

      // 5c. Verify presence endpoint reflects both online
      const presenceRes = await fixture.get(
        `/bookings/${bookingId}/presence`,
        menteeUser.tokens.accessToken,
      );
      expect(presenceRes.status).toBe(200);
      expect(presenceRes.body.data).toBeDefined();
      expect(presenceRes.body.data.mentor?.joinedAt).toBeDefined();
      expect(presenceRes.body.data.mentee?.joinedAt).toBeDefined();

      // Verify in DB: join timestamps set, status is still confirmed, payment is paid
      const [bookingRow] = await fixture.dbQuery<{
        status: string;
        payment_status: string;
        mentor_joined_at: Date | null;
        mentee_joined_at: Date | null;
      }>(
        'SELECT status, payment_status, mentor_joined_at, mentee_joined_at FROM bookings WHERE id = $1',
        [bookingId],
      );
      expect(bookingRow.status).toBe('confirmed');
      expect(bookingRow.payment_status).toBe('paid');
      expect(bookingRow.mentor_joined_at).not.toBeNull();
      expect(bookingRow.mentee_joined_at).not.toBeNull();
    });

    it('Step 6: booking is marked complete (status=completed, payment_status=paid)', async () => {
      const completeRes = await fixture.patch(
        `/bookings/${bookingId}/complete`,
        {},
        mentorUser.tokens.accessToken,
      );

      expect(completeRes.status).toBe(200);
      const completedData = completeRes.body.data?.booking ?? completeRes.body.data?.session ?? completeRes.body.data;
      expect(completedData.status).toBe('completed');

      // Verify in DB: status transitioned to 'completed', payment_status remains 'paid'
      const [row] = await fixture.dbQuery<{ status: string; payment_status: string }>(
        'SELECT status, payment_status FROM bookings WHERE id = $1',
        [bookingId],
      );
      expect(row.status).toBe('completed');
      expect(row.payment_status).toBe('paid');
    });

    it('Step 7: mentee posts a review for the completed booking', async () => {
      const reviewPayload = {
        session_id: bookingId,
        rating: 5,
        comment: 'Outstanding session! Clear architecture explanations and hands-on guidance on Soroban.',
      };

      const reviewRes = await fixture.post(
        '/reviews',
        reviewPayload,
        menteeUser.tokens.accessToken,
      );

      expect(reviewRes.status).toBe(201);
      const reviewData = reviewRes.body.data;
      expect(reviewData).toMatchObject({
        id: expect.any(String),
        booking_id: bookingId,
        reviewer_id: menteeUser.id,
        reviewee_id: mentorUser.id,
        rating: 5,
        comment: reviewPayload.comment,
      });

      // Verify in DB: review row inserted
      const [dbReview] = await fixture.dbQuery<{
        rating: number;
        comment: string;
        reviewer_id: string;
        reviewee_id: string;
      }>(
        'SELECT rating, comment, reviewer_id, reviewee_id FROM reviews WHERE booking_id = $1',
        [bookingId],
      );
      expect(dbReview.rating).toBe(5);
      expect(dbReview.comment).toBe(reviewPayload.comment);
      expect(dbReview.reviewer_id).toBe(menteeUser.id);
      expect(dbReview.reviewee_id).toBe(mentorUser.id);
    });

    it('Step 8: verify review appears on mentor profile and reviews list', async () => {
      // 8a. Check GET /api/v1/reviews/mentor/:id
      const reviewsListRes = await fixture.get(
        `/reviews/mentor/${mentorUser.id}`,
      );

      expect(reviewsListRes.status).toBe(200);
      const reviews = reviewsListRes.body.data?.reviews ?? reviewsListRes.body.data ?? [];
      expect(Array.isArray(reviews)).toBe(true);
      expect(reviews.length).toBeGreaterThanOrEqual(1);

      const matchingReview = reviews.find((r: any) => r.booking_id === bookingId);
      expect(matchingReview).toBeDefined();
      expect(matchingReview.rating).toBe(5);
      expect(matchingReview.reviewer_id).toBe(menteeUser.id);
      expect(matchingReview.comment).toContain('Soroban');

      // 8b. Check GET /api/v1/mentors/:id (or DB rating aggregate)
      const mentorProfileRes = await fixture.get(
        `/mentors/${mentorUser.id}`,
      );
      expect([200, 304]).toContain(mentorProfileRes.status);
      if (mentorProfileRes.status === 200) {
        expect(mentorProfileRes.body.data).toBeDefined();
        expect(parseFloat(mentorProfileRes.body.data.average_rating)).toBe(5);
        expect(parseInt(mentorProfileRes.body.data.total_reviews, 10)).toBeGreaterThanOrEqual(1);
      }

      // Verify mentor in DB has updated rating and review count
      const [updatedMentor] = await fixture.dbQuery<{ average_rating: string; total_reviews: number }>(
        'SELECT average_rating, total_reviews FROM users WHERE id = $1',
        [mentorUser.id],
      );
      expect(parseFloat(updatedMentor.average_rating)).toBe(5);
      expect(updatedMentor.total_reviews).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Critical Regression & Gatekeeper Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Gatekeeper validations & regressions', () => {
    let testMentor: TestUser;
    let testMentee: TestUser;

    beforeEach(async () => {
      // Create fresh test users using fixtures
      testMentor = await createTestMentor(fixture.pool);
      testMentee = await createTestMentee(fixture.pool);
    });

    it('rejects mentor confirmation when booking has not been paid', async () => {
      const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const createRes = await fixture.post(
        '/bookings',
        {
          mentorId: testMentor.id,
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes: 60,
          topic: 'Unpaid confirmation test',
        },
        testMentee.tokens.accessToken,
        { 'Idempotency-Key': uuidv4() },
      );
      expect(createRes.status).toBe(201);
      const unpaidBookingId = createRes.body.data?.booking?.id ?? createRes.body.data?.id;

      // Attempt to confirm without paying
      const confirmRes = await fixture.post(
        `/bookings/${unpaidBookingId}/confirm`,
        {},
        testMentor.tokens.accessToken,
        { 'Idempotency-Key': uuidv4() },
      );

      // Must be rejected with 400 (payment required before confirmation)
      expect(confirmRes.status).toBe(400);

      // Status must remain pending and unpaid in DB
      const [row] = await fixture.dbQuery<{ status: string; payment_status: string }>(
        'SELECT status, payment_status FROM bookings WHERE id = $1',
        [unpaidBookingId],
      );
      expect(row.status).toBe('pending');
      expect(['pending', 'unpaid']).toContain(row.payment_status);
    });

    it('rejects session completion if booking is not confirmed', async () => {
      // Insert a pending booking
      const { rows } = await fixture.pool.query(
        `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, payment_status, amount, currency)
         VALUES ($1, $2, NOW() - INTERVAL '1 hour', 60, 'Unconfirmed completion', 'pending', 'pending', '50.00', 'XLM')
         RETURNING id`,
        [testMentee.id, testMentor.id],
      );
      const pendingBookingId = rows[0].id;

      const completeRes = await fixture.patch(
        `/bookings/${pendingBookingId}/complete`,
        {},
        testMentor.tokens.accessToken,
      );

      // Should be rejected with 400 (booking not confirmed)
      expect(completeRes.status).toBe(400);
    });

    it('rejects review submission for a booking that is not completed', async () => {
      // Insert a confirmed (not completed) booking
      const { rows } = await fixture.pool.query(
        `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, payment_status, amount, currency)
         VALUES ($1, $2, NOW() + INTERVAL '2 hours', 60, 'Confirmed session', 'confirmed', 'paid', '50.00', 'XLM')
         RETURNING id`,
        [testMentee.id, testMentor.id],
      );
      const confirmedBookingId = rows[0].id;

      const reviewRes = await fixture.post(
        '/reviews',
        {
          session_id: confirmedBookingId,
          rating: 4,
          comment: 'Premature review attempt',
        },
        testMentee.tokens.accessToken,
      );

      // Must be rejected (only completed sessions can be reviewed)
      expect(reviewRes.status).toBe(403);
    });

    it('rejects duplicate reviews for the same completed booking', async () => {
      // Insert a completed booking
      const { rows } = await fixture.pool.query(
        `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, payment_status, amount, currency)
         VALUES ($1, $2, NOW() - INTERVAL '2 hours', 60, 'Completed session for duplicate review', 'completed', 'paid', '50.00', 'XLM')
         RETURNING id`,
        [testMentee.id, testMentor.id],
      );
      const completedBookingId = rows[0].id;

      // First review succeeds
      const firstRes = await fixture.post(
        '/reviews',
        {
          session_id: completedBookingId,
          rating: 5,
          comment: 'First valid review',
        },
        testMentee.tokens.accessToken,
      );
      expect(firstRes.status).toBe(201);

      // Second review for the same booking must fail with 409 Conflict
      const secondRes = await fixture.post(
        '/reviews',
        {
          session_id: completedBookingId,
          rating: 3,
          comment: 'Duplicate review attempt',
        },
        testMentee.tokens.accessToken,
      );
      expect(secondRes.status).toBe(409);
    });

    it('rejects non-participant from joining the session', async () => {
      // Insert a confirmed booking
      const { rows } = await fixture.pool.query(
        `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, status, payment_status, amount, currency)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour', 60, 'Participant check', 'confirmed', 'paid', '50.00', 'XLM')
         RETURNING id`,
        [testMentee.id, testMentor.id],
      );
      const bookingId = rows[0].id;

      // Create an outsider user
      const outsider = await createTestMentee(fixture.pool, {
        email: `outsider-${Date.now()}@e2e.test`,
      });

      // Outsider attempts to join
      const joinRes = await fixture.post(
        `/bookings/${bookingId}/join`,
        {},
        outsider.tokens.accessToken,
      );

      // Must be rejected with 403 Forbidden
      expect(joinRes.status).toBe(403);
    });
  });
});
