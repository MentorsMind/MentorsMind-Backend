import express from 'express';
import request from 'supertest';
import { securityMiddleware } from '../security.middleware';

describe('security middleware HSTS', () => {
  it('sets Strict-Transport-Security to at least one year', async () => {
    const app = express();
    app.use(securityMiddleware);
    app.get('/health', (_req, res) => res.sendStatus(200));

    const response = await request(app).get('/health');

    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d{8,}/);
    expect(Number(response.headers['strict-transport-security'].match(/max-age=(\d+)/)?.[1])).toBeGreaterThanOrEqual(31536000);
  });
});
