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

  describe('POST /api/v1/bookings', () => {
    it('creates a new booking slot successfully', async () => {
      const newBookingPayload = {
        mentorId: 'c2da9f92-5d9c-4933-bf40-9a3d752df11e',
        scheduledAt: '2026-09-10T14:00:00.000Z',
        durationMinutes: 60,
        topic: 'Smart Contract Review',
        notes: 'Reviewing Pact tests implementation',
      };

      // 1. Define interaction
      provider
        .uponReceiving('a request to create a booking slot')
        .withRequest({
          method: 'POST',
          path: '/api/v1/bookings',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': Matchers.like('Bearer token123'),
          },
          body: newBookingPayload,
        })
        .willRespondWith({
          status: 201,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: {
            status: 'success',
            data: {
              id: Matchers.uuid(),
              mentee_id: Matchers.uuid(),
              mentor_id: 'c2da9f92-5d9c-4933-bf40-9a3d752df11e',
              status: 'pending',
              payment_status: 'pending',
              topic: 'Smart Contract Review',
              duration_minutes: 60,
              scheduled_at: '2026-09-10T14:00:00.000Z',
            },
          },
        });

      // 2. Run test execution
      await provider.executeTest(async (mockServer) => {
        const response = await axios.post(
          `${mockServer.url}/api/v1/bookings`,
          newBookingPayload,
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer token123',
            },
          },
        );

        expect(response.status).toBe(201);
        expect(response.data.status).toBe('success');
        expect(response.data.data.id).not.toBeNull();
        expect(response.data.data.topic).toBe('Smart Contract Review');
      });
    });
  });
});
