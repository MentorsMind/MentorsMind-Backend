import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const payload = JSON.stringify({
    mentorId: 'test-mentor-id',
    learnerId: 'test-learner-id',
    slot: '2026-04-15T10:00:00.000Z',
    duration: 60,
  });

  const headers = {
    'Content-Type': 'application/json',
  };

  const res = http.post(`${BASE_URL}/api/v1/bookings`, payload, { headers });
  check(res, {
    'booking status is 201 or 200': (r) => r.status === 200 || r.status === 201,
  });
  sleep(1);
}
