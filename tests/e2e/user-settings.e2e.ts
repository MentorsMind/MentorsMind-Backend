/**
 * user-settings.e2e.ts
 *
 * E2E tests for the user profile and notification preference management journeys.
 */

import { installStellarMocks } from './setup/stellar-mock';
import mockUsers from '../fixtures/mock-users.json';

// Install mocks BEFORE importing any production code
installStellarMocks();

import { TestFixture } from './setup/test-fixture';

describe('User Settings & Notifications — E2E', () => {
  const fixture = new TestFixture();

  beforeAll(async () => {
    await fixture.setup();
  });

  afterAll(async () => {
    await fixture.teardown();
  });

  describe('User Profile Settings (GET /PUT /users/me)', () => {
    it('retrieves the currently logged-in user profile details', async () => {
      const res = await fixture.get('/users/me', fixture.menteeTokens.accessToken);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          email: mockUsers.mentee.email,
          role: 'mentee',
          firstName: mockUsers.mentee.firstName,
          lastName: mockUsers.mentee.lastName,
        }),
      });
    });

    it('updates user profile details successfully', async () => {
      const updatePayload = {
        firstName: 'UpdatedFirstName',
        lastName: 'UpdatedLastName',
      };

      const res = await fixture.put('/users/me', updatePayload, fixture.menteeTokens.accessToken);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          firstName: 'UpdatedFirstName',
          lastName: 'UpdatedLastName',
        }),
      });

      // Verify persistence via subsequent GET
      const getRes = await fixture.get('/users/me', fixture.menteeTokens.accessToken);
      expect(getRes.body.data.firstName).toBe('UpdatedFirstName');
      expect(getRes.body.data.lastName).toBe('UpdatedLastName');
    });

    it('rejects profile update with invalid parameters', async () => {
      const invalidPayload = {
        email: 'this-should-not-be-changeable-directly@e2e.test',
      };

      const res = await fixture.put('/users/me', invalidPayload, fixture.menteeTokens.accessToken);
      
      // Email might either be ignored or cause 400 validation depending on endpoint config
      // But we assert it wasn't changed
      const getRes = await fixture.get('/users/me', fixture.menteeTokens.accessToken);
      expect(getRes.body.data.email).toBe(mockUsers.mentee.email);
    });
  });

  describe('Notification Preferences (GET /PUT /notifications/preferences)', () => {
    it('retrieves the default notification preferences', async () => {
      const res = await fixture.get('/notifications/preferences', fixture.menteeTokens.accessToken);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'success',
        data: expect.any(Object),
      });

      // Check default structure (e.g. system_alert should exist)
      const preferences = res.body.data;
      expect(preferences).toHaveProperty('system_alert');
    });

    it('updates notification preferences successfully', async () => {
      const updatedPrefs = {
        preferences: {
          system_alert: { email: true, push: true, in_app: true },
          booking_confirmed: { email: false, push: false, in_app: false },
        },
      };

      const res = await fixture.put(
        '/notifications/preferences',
        updatedPrefs,
        fixture.menteeTokens.accessToken,
      );

      expect(res.status).toBe(200);

      // Verify persistence via GET
      const getRes = await fixture.get('/notifications/preferences', fixture.menteeTokens.accessToken);
      expect(getRes.body.data.system_alert).toMatchObject({
        email: true,
        push: true,
        in_app: true,
      });
      expect(getRes.body.data.booking_confirmed).toMatchObject({
        email: false,
        push: false,
        in_app: false,
      });
    });
  });
});
