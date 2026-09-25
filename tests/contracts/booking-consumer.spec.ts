import { PactV3, Matchers } from '@pact-foundation/pact';
import axios from 'axios';
import * as path from 'path';

// Define the Pact contract between MentorsMind-Frontend and MentorsMind-Backend
const provider = new PactV3({
  consumer: 'MentorsMind-Frontend',
  provider: 'MentorsMind-Backend',
  dir: path.resolve(process.cwd(), 'pact/pacts'),
});

describe('Booking API Contract — Consumer Test', () => {
  describe('GET /api/v1/mentors', () => {
    it('returns a list of mentors filtered by expertise', async () => {
      // 1. Define interaction
      provider
        .uponReceiving('a request to list mentors with expertise filter')
        .withRequest({
          method: 'GET',
          path: '/api/v1/mentors',
          query: { expertise: 'Stellar' },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            status: 'success',
            data: {
              mentors: Matchers.eachLike({
                id: Matchers.uuid(),
                firstName: Matchers.like('Alice'),
                lastName: Matchers.like('Developer'),
                expertise: Matchers.eachLike('Stellar'),
                hourly_rate: Matchers.like('75.00'),
              }),
            },
          },
        });

      // 2. Run test execution against the mock provider service
      await provider.executeTest(async (mockServer) => {
        const response = await axios.get(`${mockServer.url}/api/v1/mentors`, {
          params: { expertise: 'Stellar' },
        });

        expect(response.status).toBe(200);
        expect(response.data.status).toBe('success');
        expect(response.data.data.mentors).toBeInstanceOf(Array);
        expect(response.data.data.mentors[0].firstName).toBe('Alice');
      });
    });
  });
});
