/**
 * mentor-search.e2e.ts
 *
 * E2E tests for the mentor onboarding and mentor search/filter journeys.
 */

import { installStellarMocks } from './setup/stellar-mock';
import mockUsers from '../fixtures/mock-users.json';

// Install mocks BEFORE importing any production code
installStellarMocks();

import { TestFixture } from './setup/test-fixture';

describe('Mentor Onboarding & Search — E2E', () => {
  const fixture = new TestFixture();

  beforeAll(async () => {
    await fixture.setup();
  });

  afterAll(async () => {
    await fixture.teardown();
  });

  describe('Mentor Onboarding (POST /mentors)', () => {
    it('successfully creates a mentor profile', async () => {
      // Register a new mentor user first to avoid conflicts with seeded mentor
      const regRes = await fixture.post('/auth/register', {
        email: 'new-mentor@e2e.test',
        password: 'MentorPass123!',
        firstName: 'Expert',
        lastName: 'Developer',
        role: 'mentor',
      });

      expect(regRes.status).toBe(201);
      const mentorToken = regRes.body.data.accessToken;

      const profilePayload = {
        bio: 'Expert in Stellar Smart Contracts and Rust programming.',
        hourlyRate: 150.00,
        expertise: ['Stellar', 'Rust', 'Smart Contracts'],
        yearsOfExperience: 8,
        timezone: 'UTC',
      };

      const profileRes = await fixture.post('/mentors', profilePayload, mentorToken);

      expect(profileRes.status).toBe(201);
      expect(profileRes.body).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          bio: 'Expert in Stellar Smart Contracts and Rust programming.',
          hourly_rate: '150.00', // DB returns numeric as string
          expertise: expect.arrayContaining(['Stellar', 'Rust', 'Smart Contracts']),
        }),
      });
    });

    it('rejects mentor profile creation with invalid parameters', async () => {
      // Register another mentor
      const regRes = await fixture.post('/auth/register', {
        email: 'invalid-mentor@e2e.test',
        password: 'MentorPass123!',
        firstName: 'Invalid',
        lastName: 'Mentor',
        role: 'mentor',
      });

      const mentorToken = regRes.body.data.accessToken;

      // Missing hourlyRate (required)
      const invalidPayload = {
        bio: 'No hourly rate.',
        expertise: ['Stellar'],
      };

      const profileRes = await fixture.post('/mentors', invalidPayload, mentorToken);
      expect(profileRes.status).toBe(400);
    });
  });

  describe('Mentor Search & Filtering (GET /mentors)', () => {
    it('lists all active mentors', async () => {
      const res = await fixture.get('/mentors', fixture.menteeTokens.accessToken);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'success',
        data: expect.any(Object),
      });

      const items = res.body.data.mentors || res.body.data.items || [];
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('filters mentors by expertise', async () => {
      const res = await fixture.get('/mentors?expertise=Rust', fixture.menteeTokens.accessToken);

      expect(res.status).toBe(200);
      const items = res.body.data.mentors || res.body.data.items || [];
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0]).toMatchObject({
        expertise: expect.arrayContaining(['Rust']),
      });
    });

    it('filters mentors by rate range', async () => {
      // Find expensive mentor (rate = 150)
      const resExpensive = await fixture.get(
        '/mentors?minRate=100&maxRate=200',
        fixture.menteeTokens.accessToken,
      );
      expect(resExpensive.status).toBe(200);
      const expensiveItems = resExpensive.body.data.mentors || resExpensive.body.data.items || [];
      expect(expensiveItems.length).toBeGreaterThanOrEqual(1);
      expect(parseFloat(expensiveItems[0].hourly_rate)).toBeLessThanOrEqual(200);
      expect(parseFloat(expensiveItems[0].hourly_rate)).toBeGreaterThanOrEqual(100);

      // Find cheap mentor (rate = 50)
      const resCheap = await fixture.get(
        '/mentors?minRate=30&maxRate=80',
        fixture.menteeTokens.accessToken,
      );
      expect(resCheap.status).toBe(200);
      const cheapItems = resCheap.body.data.mentors || resCheap.body.data.items || [];
      expect(cheapItems.length).toBeGreaterThanOrEqual(1);
      expect(parseFloat(cheapItems[0].hourly_rate)).toBeLessThanOrEqual(80);
    });

    it('searches mentors by text search query', async () => {
      const res = await fixture.get(
        '/mentors?search=Contracts',
        fixture.menteeTokens.accessToken,
      );

      expect(res.status).toBe(200);
      const items = res.body.data.mentors || res.body.data.items || [];
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0].bio).toContain('Contracts');
    });
  });
});
