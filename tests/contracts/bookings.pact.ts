import { PactV3, Matchers } from '@pact-foundation/pact';
import axios from 'axios';
import * as path from 'path';

// Define the Pact contract between MentorsMind-Frontend and MentorsMind-Backend
const provider = new PactV3({
  consumer: 'MentorsMind-Frontend',
  provider: 'MentorsMind-Backend',
  dir: path.resolve(process.cwd(), 'pact/pacts'),
});

describe('Booking API Contract — POST /api/v1/bookings', () => {
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
      expect(response.data.data.id).toBeDefined();
      expect(response.data.data.status).toBe('pending');
      expect(response.data.data.payment_status).toBe('pending');
      expect(response.data.data.topic).toBe('Smart Contract Review');
    });
  });
});
