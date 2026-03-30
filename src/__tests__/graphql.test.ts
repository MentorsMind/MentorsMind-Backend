import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app';
import { createUser } from '../tests/factories/user.factory';
import { env } from '../config/env';

describe('GraphQL API', () => {
  it('should resolve the current authenticated user via me query', async () => {
    const user = await createUser({ role: 'user', firstName: 'Graph', lastName: 'QL' });
    const token = jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: '1h' });

    const query = `
      query {
        me {
          id
          role
          firstName
          lastName
        }
      }
    `;

    const response = await request(app)
      .post('/api/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.me).toMatchObject({
      id: user.id,
      role: user.role,
      firstName: 'Graph',
      lastName: 'QL',
    });
  });

  it('should reject the me query when no token is provided', async () => {
    const query = `
      query {
        me {
          id
          role
        }
      }
    `;

    const response = await request(app).post('/api/graphql').send({ query });

    expect(response.status).toBe(200);
    expect(response.body.data.me).toBeNull();
    expect(response.body.errors[0].message).toContain('Authentication required');
  });
});
