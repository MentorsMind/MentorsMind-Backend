import { createUser } from '../../tests/factories/user.factory';
import {
  generateTestToken,
  authenticatedPost,
  authenticatedGet,
  authenticatedPut,
} from '../../tests/helpers/request.helper';

const CONSENT_PAYLOAD = {
  analytics_consent: true,
  marketing_consent: false,
  functional_consent: true,
};

describe('Consent API', () => {
  describe('POST /consent', () => {
    it('records consent and returns 201', async () => {
      const user = await createUser({ role: 'user' });
      const token = generateTestToken({ userId: user.id, email: user.email, role: user.role });

      const res = await authenticatedPost('/consent', CONSENT_PAYLOAD, token);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        analytics_consent: true,
        marketing_consent: false,
        functional_consent: true,
      });
    });

    it('returns 401 without auth', async () => {
      const res = await import('supertest').then(({ default: request }) =>
        request((await import('../../app')).default)
          .post('/api/v1/consent')
          .send(CONSENT_PAYLOAD),
      );
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid payload', async () => {
      const user = await createUser({ role: 'user' });
      const token = generateTestToken({ userId: user.id, email: user.email, role: user.role });

      const res = await authenticatedPost('/consent', { analytics_consent: 'yes' }, token);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /consent', () => {
    it('retrieves the latest consent record', async () => {
      const user = await createUser({ role: 'user' });
      const token = generateTestToken({ userId: user.id, email: user.email, role: user.role });

      await authenticatedPost('/consent', CONSENT_PAYLOAD, token);
      const res = await authenticatedGet('/consent', token);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        analytics_consent: true,
        marketing_consent: false,
        functional_consent: true,
      });
    });

    it('returns null data when no consent record exists', async () => {
      const user = await createUser({ role: 'user' });
      const token = generateTestToken({ userId: user.id, email: user.email, role: user.role });

      const res = await authenticatedGet('/consent', token);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  });

  describe('PUT /consent', () => {
    it('appends a new consent record', async () => {
      const user = await createUser({ role: 'user' });
      const token = generateTestToken({ userId: user.id, email: user.email, role: user.role });

      await authenticatedPost('/consent', CONSENT_PAYLOAD, token);
      const res = await authenticatedPut(
        '/consent',
        { analytics_consent: false, marketing_consent: false, functional_consent: false },
        token,
      );

      expect(res.status).toBe(201);
      expect(res.body.data.analytics_consent).toBe(false);
    });
  });

  describe('GET /consent/stats (admin)', () => {
    it('returns aggregate consent stats for admin', async () => {
      const admin = await createUser({ role: 'admin' });
      const adminToken = generateTestToken({ userId: admin.id, email: admin.email, role: 'admin' });

      const res = await authenticatedGet('/consent/stats', adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        total_unique_users: expect.any(Number),
        analytics: expect.objectContaining({ opt_in_count: expect.any(Number) }),
        marketing: expect.objectContaining({ opt_in_count: expect.any(Number) }),
        functional: expect.objectContaining({ opt_in_count: expect.any(Number) }),
      });
    });

    it('returns 403 for non-admin', async () => {
      const user = await createUser({ role: 'user' });
      const token = generateTestToken({ userId: user.id, email: user.email, role: user.role });

      const res = await authenticatedGet('/consent/stats', token);
      expect(res.status).toBe(403);
    });
  });
});
