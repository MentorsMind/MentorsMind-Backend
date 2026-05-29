import request from 'supertest';
import app from '../app';

describe('Health Check API', () => {
describe('GET /api/v1/health', () => {
    it('should return comprehensive health status', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.data.overall).toBe('healthy');
      expect(response.body.data.components.database.status).toBe('healthy');
      expect(response.body.data.components.stellar.status).toBe('healthy');
      expect(response.body.data.components.system.status).toBe('healthy');
      expect(response.body.data.uptime).toBeGreaterThan(0);
      expect(response.body.data.timestamp).toMatch(/\\d{4}-\\d{2}-\\d{2}T/);
    });
  });

  describe('GET /metrics', () => {
    it('should return Prometheus metrics', async () => {
      const response = await request(app).get('/metrics');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/plain/);
      expect(response.text).toContain('http_request_duration_ms');
    });
  });

  describe('GET /ready', () => {
    it('should return readiness status', async () => {
      const response = await request(app).get('/ready');
      expect(response.status).toBe(200);
      expect(response.body.data.isReady).toBe(true);
    });
  });

  describe('GET /', () => {
    it('should return API information', async () => {
      const response = await request(app).get('/');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'success',
        message: expect.any(String),
        version: expect.any(String),
        documentation: expect.any(String),
        health: expect.any(String),
      });
    });
  });
});
