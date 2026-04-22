import request from 'supertest';
import app from '../../src/app';
import { testPool, initializeTestDatabase, truncateAllTables } from '../../src/tests/setup';
import { createSession } from '../../src/tests/factories/session.factory';
import { createUser } from '../../src/tests/factories/user.factory';

describe('Booking Confirmation Flow', () => {
  let authToken: string;
  let mentorId: string;
  let menteeId: string;

  beforeAll(async () => {
    await initializeTestDatabase();
  });

  beforeEach(async () => {
    await truncateAllTables();

    // Create test users
    const mentor = await createUser({
      email: 'mentor@test.com',
      role: 'mentor',
    });

    const mentee = await createUser({
      email: 'mentee@test.com',
      role: 'mentee',
    });

    mentorId = mentor.id;
    menteeId = mentee.id;

    // Login as mentee to get auth token
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'mentee@test.com',
        password: 'password123',
      });

    authToken = loginResponse.body.data.token;
  });

  describe('POST /api/v1/bookings/:id/confirm', () => {
    it('should confirm booking and generate meeting URL (Jitsi)', async () => {
      // Set Jitsi as provider for tests
      process.env.MEETING_PROVIDER = 'jitsi';

      // Create a pending session
      const session = await createSession({
        mentorId,
        menteeId,
        status: 'pending',
      });

      // Confirm the booking
      const response = await request(app)
        .post(`/api/v1/bookings/${session.id}/confirm`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.data.session.status).toBe('confirmed');
      expect(response.body.data.session.meeting_url).toBeDefined();
      expect(response.body.data.session.meeting_provider).toBe('jitsi');
      expect(response.body.data.session.meeting_expires_at).toBeDefined();
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      
      const response = await request(app)
        .post(`/api/v1/bookings/${fakeId}/confirm`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });

    it('should return 400 if already confirmed', async () => {
      const session = await createSession({
        mentorId,
        menteeId,
        status: 'confirmed',
      });

      const response = await request(app)
        .post(`/api/v1/bookings/${session.id}/confirm`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already confirmed');
    });

    it('should mark session for manual intervention on failure', async () => {
      // Set invalid provider to trigger failure
      process.env.MEETING_PROVIDER = 'invalid_provider';

      const session = await createSession({
        mentorId,
        menteeId,
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/v1/bookings/${session.id}/confirm`)
        .set('Authorization', `Bearer ${authToken}`);

      // Should still return 200 but with warning
      expect(response.status).toBe(200);
      expect(response.body.data.warning).toBeDefined();
      expect(response.body.data.warning).toContain('Manual intervention required');

      // Verify session is marked for manual intervention
      const dbResult = await testPool.query(
        'SELECT needs_manual_intervention FROM sessions WHERE id = $1',
        [session.id]
      );
      expect(dbResult.rows[0].needs_manual_intervention).toBe(true);
    });
  });

  describe('GET /api/v1/bookings/:id', () => {
    it('should include meeting URL for confirmed sessions', async () => {
      const session = await createSession({
        mentorId,
        menteeId,
        status: 'confirmed',
        meetingUrl: 'https://meet.jit.si/MentorMinds-test123',
      });

      const response = await request(app)
        .get(`/api/v1/bookings/${session.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.session.meeting_url).toBe('https://meet.jit.si/MentorMinds-test123');
    });

    it('should hide meeting URL for unconfirmed sessions', async () => {
      const session = await createSession({
        mentorId,
        menteeId,
        status: 'pending',
        meetingUrl: 'https://meet.jit.si/MentorMinds-test123',
      });

      const response = await request(app)
        .get(`/api/v1/bookings/${session.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.session.meeting_url).toBeNull();
    });
  });

  describe('GET /api/v1/bookings', () => {
    it('should list user sessions with filtered meeting URLs', async () => {
      await createSession({
        mentorId,
        menteeId,
        status: 'confirmed',
        meetingUrl: 'https://meet.jit.si/confirmed-session',
      });

      await createSession({
        mentorId,
        menteeId,
        status: 'pending',
        meetingUrl: 'https://meet.jit.si/pending-session',
      });

      const response = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.sessions).toHaveLength(2);

      const confirmedSession = response.body.data.sessions.find(
        (s: any) => s.status === 'confirmed'
      );
      const pendingSession = response.body.data.sessions.find(
        (s: any) => s.status === 'pending'
      );

      expect(confirmedSession.meeting_url).toBeDefined();
      expect(pendingSession.meeting_url).toBeNull();
    });
  });
});
