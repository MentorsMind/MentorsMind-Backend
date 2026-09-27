import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';

describe('Body Size Limit Middleware (100kb default)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '100kb' }));
    app.post('/api/v1/test-endpoint', (req: Request, res: Response) => {
      res.status(200).json({ success: true });
    });
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
        return res.status(413).json({ error: 'Payload Too Large' });
      }
      return res.status(500).json({ error: err.message });
    });
  });

  it('should allow JSON payloads smaller than 100kb', async () => {
    const smallPayload = { data: 'a'.repeat(1024) };
    const res = await request(app)
      .post('/api/v1/test-endpoint')
      .send(smallPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 413 Payload Too Large when payload exceeds 100kb', async () => {
    const largePayload = { data: 'a'.repeat(105 * 1024) };
    const res = await request(app)
      .post('/api/v1/test-endpoint')
      .send(largePayload);

    expect(res.status).toBe(413);
  });
});
