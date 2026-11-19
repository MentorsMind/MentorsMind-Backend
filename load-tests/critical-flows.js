import http from 'k6/http';
import { check, sleep } from 'k6';

// ─── Load Test Configuration ──────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '10s', target: 10 }, // Ramp up
    { duration: '20s', target: 10 }, // Stay constant
    { duration: '10s', target: 0 },  // Ramp down
  ],
  thresholds: {
    // 95% of requests must complete within 500ms
    http_req_duration: ['p(95)<500'],
    // Error rate must be less than 1%
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:5001/api/v1';

// ─── Helper function to generate unique emails ──────────────────────────────
function generateUniqueEmail() {
  const rand = Math.random().toString(36).substring(2, 10);
  return `load-user-${rand}@loadtest.local`;
}

export default function () {
  const email = generateUniqueEmail();
  const password = 'LoadTestPass123!';
  const headers = { 'Content-Type': 'application/json' };

  // ── Step 1: User Registration ─────────────────────────────────────────────
  const registerPayload = JSON.stringify({
    email: email,
    password: password,
    firstName: 'Load',
    lastName: 'Tester',
    role: 'mentee',
  });

  const registerRes = http.post(`${BASE_URL}/auth/register`, registerPayload, { headers });
  const registerOk = check(registerRes, {
    'register status is 201': (r) => r.status === 201,
    'register has access token': (r) => r.json('data.accessToken') !== undefined,
  });

  if (!registerOk) {
    // If registration fails, skip rest of the iteration
    sleep(1);
    return;
  }

  const token = registerRes.json('data.accessToken');
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // Sleep between operations to simulate real user behavior
  sleep(1);

  // ── Step 2: Get Current User Profile ──────────────────────────────────────
  const meRes = http.get(`${BASE_URL}/users/me`, { headers: authHeaders });
  check(meRes, {
    'get me status is 200': (r) => r.status === 200,
    'profile email matches': (r) => r.json('data.email') === email,
  });

  sleep(1);

  // ── Step 3: List Mentors ──────────────────────────────────────────────────
  const mentorsRes = http.get(`${BASE_URL}/mentors`, { headers: authHeaders });
  check(mentorsRes, {
    'list mentors status is 200': (r) => r.status === 200,
  });

  sleep(1);

  // ── Step 4: Create a Booking ──────────────────────────────────────────────
  // We need a mentor ID to create a booking. Let's find one from the list.
  const mentors = mentorsRes.json('data.mentors') || mentorsRes.json('data.items') || [];
  if (mentors.length > 0) {
    const mentorId = mentors[0].id || mentors[0].user_id;
    const scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week out

    const bookingPayload = JSON.stringify({
      mentorId: mentorId,
      scheduledAt: scheduledAt.toISOString(),
      durationMinutes: 60,
      topic: 'Load Testing Review',
      notes: 'Automated performance test request',
    });

    const bookingRes = http.post(`${BASE_URL}/bookings`, bookingPayload, { headers: authHeaders });
    check(bookingRes, {
      'create booking status is 201': (r) => r.status === 201,
      'booking has id': (r) => r.json('data.id') !== undefined,
    });
  }

  sleep(1);
}
